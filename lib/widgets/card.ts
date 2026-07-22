// Versão: 1.1 | Data: 20/07/2026
// v1.1 (20/07/2026): sem o param do mapa global de unificados — runWidget e
//   runCalculatedWidget montam o mapa POR PERNA a partir das correspondências
//   cruas (o mapa global misturava o membro da sub no coalesce da pai).
// Modos novos do Card (ex-KPI): resolvidos no SERVIDOR (RSC do dashboard e
// viewer de snapshot — o client injetado decide o dataset) e entregues via
// WidgetData.card + rows. Modos:
//  - record: campo X do registro com maior/menor campo Y (argmax/argmin client-
//    side sobre runRecordList — cobre "cliente de maior valor" e "data mais
//    recente" sem min/max de data no RPC; ordenar custom_fields no PostgREST é
//    lexicográfico, então o rank numérico é feito aqui).
//  - topn: ranking rótulo+métrica via runWidget (herda moeda, rótulos FK,
//    fórmulas e __cmp da comparação — variação no ranking de graça).
//  - list: valores distintos de um campo (rótulos resolvidos) em ordem
//    alfabética.
//  - formula: mesma engine do widget "calculado" (runCalculatedWidget), com
//    moeda automática e funções ANTERIOR/VARPCT/VARABS.
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isPercentFieldRef,
  type FieldDefinition,
  type RecordRow,
} from "@/lib/records/types";
import { isCoreDef } from "@/lib/records/core-defs";
import {
  unifiedMemberRef,
  type Correspondence,
} from "@/lib/correspondences";
import { BUILTIN_SOURCES, type SourceDef } from "@/lib/sources";
import { loadNonWorkingDays } from "@/lib/config/non-working-days";
import { todayBrasiliaIso } from "@/lib/date/today";
import { comparisonLabel, comparisonSpec } from "./comparison";
import { fetchFkLabels, runWidget } from "./engine";
import { runCalculatedWidget } from "./formula-metric";
import { runRecordList } from "./record-list";
import { fracDigits } from "./appearance";
import { formatMoney, yearQuarterOf, type CurrencyRates } from "./currency";
import { DEFAULT_DATE_FORMAT, formatDateValue, formatPercent } from "./format";
import { fieldFk, fieldLabel, type AvailableField } from "./fields";
import type { DashboardPeriod } from "./period";
import type {
  CardConfig,
  WidgetConfig,
  WidgetData,
  WidgetSettings,
} from "./types";

/** O widget usa um modo NOVO do Card? (meta/razão/data_atual têm precedência.) */
export function isCardModeWidget(w: {
  visual_type: string;
  settings?: WidgetSettings;
}): boolean {
  const mode = w.settings?.card?.mode;
  return (
    w.visual_type === "kpi" &&
    mode != null &&
    mode !== "value" &&
    !w.settings?.mode
  );
}

const fmt = (n: number, decimals?: number): string =>
  n.toLocaleString("pt-BR", fracDigits(decimals));

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Ref de campo do registro casado: match:<fonte>:<ref> (ref pode conter ':').
function parseMatchField(field: string): { src: string; ref: string } | null {
  if (!field.startsWith("match:")) return null;
  const rest = field.slice(6);
  const i = rest.indexOf(":");
  if (i < 0) return null;
  return { src: rest.slice(0, i), ref: rest.slice(i + 1) };
}

// Valor cru de um campo num RecordRow (unified resolvido pela fonte do
// registro; match via __match anexado por runRecordList; custom/núcleo).
function rawFieldValue(
  field: string,
  record: RecordRow,
  available: AvailableField[]
): unknown {
  const ref = field.startsWith("unified:")
    ? unifiedMemberRef(
        available.find((a) => a.field === field)?.unifiedMembers,
        record.record_type
      )
    : field;
  if (!ref) return undefined;
  const mm = parseMatchField(ref);
  if (mm) {
    const mrec =
      record.__match?.[mm.src as keyof NonNullable<RecordRow["__match"]>];
    if (!mrec) return undefined;
    return mm.ref.startsWith("custom:")
      ? mrec.custom_fields?.[mm.ref.slice(7)]
      : (mrec as unknown as Record<string, unknown>)[mm.ref];
  }
  if (ref.startsWith("custom:")) return record.custom_fields?.[ref.slice(7)];
  return (record as unknown as Record<string, unknown>)[ref];
}

export async function runCardWidget(
  supabase: SupabaseClient,
  config: WidgetConfig,
  period: DashboardPeriod | null | undefined,
  available: AvailableField[],
  fields: FieldDefinition[] = [],
  rates: CurrencyRates = {},
  conversionPeriod: { year: number; quarter: number } = yearQuarterOf(null),
  // Viewer de snapshot: partner rows (match) nunca são candidatas do modo
  // record — mesmo pós-filtro das listas de registros.
  opts: { excludeRecordIds?: Set<string> } = {},
  // SUB-FONTES (0078): catálogo + correspondências CRUAS — runWidget e
  // runCalculatedWidget montam o mapa de unificados por perna a partir delas.
  catalog: SourceDef[] = BUILTIN_SOURCES,
  correspondences: Correspondence[] = []
): Promise<WidgetData> {
  const card: CardConfig = config.settings?.card ?? {};
  const mode = card.mode ?? "value";
  const empty: WidgetData = { rows: [], dimensions: [], metrics: [] };
  // Linhas core (0086) fora: refs custom:<key> nunca apontam p/ coluna núcleo.
  const fieldByKey = new Map(
    fields.filter((f) => !isCoreDef(f)).map((f) => [f.field_key, f])
  );
  const wrap = (t: string) => `${card.prefix ?? ""}${t}${card.suffix ?? ""}`;
  const af = (f: string) => available.find((a) => a.field === f);
  // Casas decimais do widget (aparência) — aplicadas aos textos do servidor.
  const decimals = config.settings?.appearance?.decimals;

  // Exibição de um valor cru na escala do campo (moeda do registro, data,
  // percentual, FK via rótulo — resolvido pelo chamador).
  const displayValue = async (
    field: string,
    record: RecordRow
  ): Promise<string> => {
    const v = rawFieldValue(field, record, available);
    if (v == null || v === "") return "—";
    const meta = af(field);
    const fk = fieldFk(field, available);
    if (fk) {
      const labels = await fetchFkLabels(supabase, fk, [String(v)]);
      return labels[String(v)] ?? String(v);
    }
    if (meta?.isMoney) return formatMoney(v, record.currency, decimals);
    if (meta?.isDate) return formatDateValue(v, DEFAULT_DATE_FORMAT);
    if (isPercentFieldRef(field, fieldByKey))
      return formatPercent(v, true, decimals);
    const n = numOrNull(v);
    return n != null ? fmt(n, decimals) : String(v);
  };

  if (mode === "record") {
    const rankField = card.rankField || card.showField;
    const showField = card.showField || card.rankField;
    if (!rankField || !showField) {
      return { ...empty, error: "Configure os campos do Card (registro)." };
    }
    const listConfig: WidgetConfig = {
      ...config,
      settings: { ...config.settings, limit: undefined },
    };
    let records = await runRecordList(supabase, listConfig, period, available);
    if (opts.excludeRecordIds && opts.excludeRecordIds.size > 0) {
      records = records.filter((r) => !opts.excludeRecordIds!.has(r.id));
    }
    const rankMeta = af(rankField);
    const dir = card.rankDir === "min" ? -1 : 1;
    let best: RecordRow | null = null;
    let bestKey: number | string | null = null;
    for (const r of records) {
      const v = rawFieldValue(rankField, r, available);
      if (v == null || v === "") continue;
      // Números comparam numericamente; datas/texto pelo prefixo ISO/string
      // (datas ISO ordenam lexicograficamente).
      const key: number | string | null = rankMeta?.isNumeric
        ? numOrNull(v)
        : String(v);
      if (key == null) continue;
      if (
        bestKey == null ||
        (typeof key === "number" && typeof bestKey === "number"
          ? (key - bestKey) * dir > 0
          : String(key).localeCompare(String(bestKey)) * dir > 0)
      ) {
        best = r;
        bestKey = key;
      }
    }
    if (!best) {
      return { ...empty, card: { mode, valueText: "—" } };
    }
    const valueText = wrap(await displayValue(showField, best));
    const rankText = await displayValue(rankField, best);
    const subText =
      card.secondaryText ??
      `${card.rankDir === "min" ? "Menor" : "Maior"} ${fieldLabel(
        rankField,
        available
      )}: ${rankText}`;
    return { ...empty, card: { mode, valueText, subText } };
  }

  if (mode === "topn" || mode === "list") {
    const labelField = card.labelField;
    if (!labelField || (mode === "topn" && !card.metric?.field)) {
      return { ...empty, error: "Configure o campo do Card (ranking/lista)." };
    }
    const derived: WidgetConfig = {
      ...config,
      splitBySource: false,
      dimensions: [{ field: labelField }],
      metrics:
        mode === "topn" ? [card.metric!] : [{ field: "*", agg: "count" }],
    };
    const data = await runWidget(
      supabase,
      derived,
      available,
      period,
      fields,
      rates,
      conversionPeriod,
      catalog,
      correspondences
    );
    if (mode === "topn") {
      const asc = card.rankDir === "min";
      data.rows.sort((a, b) => {
        const av = numOrNull(a.metric_1);
        const bv = numOrNull(b.metric_1);
        if (av == null && bv == null) return 0;
        if (av == null) return 1; // nulos por último
        if (bv == null) return -1;
        return asc ? av - bv : bv - av;
      });
      data.rows = data.rows.slice(0, card.limit ?? 5);
    } else {
      data.rows.sort((a, b) =>
        String(a.dim_1 ?? "").localeCompare(String(b.dim_1 ?? ""), "pt-BR")
      );
      data.rows = data.rows.slice(0, card.limit ?? 10);
    }
    return { ...data, card: { mode, subText: card.secondaryText } };
  }

  if (mode === "formula") {
    if (!card.formula || card.formula.tokens.length === 0) {
      return { ...empty, error: "Configure a fórmula do Card." };
    }
    const calcInput = {
      formula: card.formula,
      sources: config.sources ?? [],
      sourceDefs: catalog,
      filters: config.filters ?? [],
      period,
      correspondences,
      currencyMode: "auto" as const,
      fields,
      rates,
      conversionPeriod,
    };
    // Comparação (settings.comparison): a MESMA fórmula roda sob o range
    // deslocado — padrão do runComparison do engine; runCalculatedWidget
    // rejanela operandos escopados pela data da própria sub. Bases de janela
    // (window_*) ficam de fora: o card é um escalar único e fórmulas típicas
    // são razões (intensivas) — média/mediana por bucket não se aplica.
    const cmp = config.settings?.comparison;
    const cmpBase = cmp?.base ?? "previous_period";
    let cmpSpec =
      cmp?.enabled && cmpBase !== "window_avg" && cmpBase !== "window_median"
        ? comparisonSpec(period, cmp)
        : null;
    if (cmpSpec?.base === "previous_period_bd") {
      // Mesmo dia útil: recomputa com feriados + hoje (espelha o engine);
      // falha ao carregar feriados mantém o range cheio já resolvido.
      try {
        cmpSpec = comparisonSpec(period, cmp, {
          holidays: await loadNonWorkingDays(supabase),
          todayIso: todayBrasiliaIso(),
        });
      } catch {
        // mantém o spec degradado
      }
    }
    const cmpPeriod: DashboardPeriod | null =
      cmpSpec && period
        ? {
            field: period.field,
            from: cmpSpec.from,
            to: cmpSpec.to,
            fieldBySource: period.fieldBySource,
          }
        : null;
    // Perna de comparação falhou → sem meta (o card renderiza como hoje);
    // value null de uma perna OK ainda anexa meta (badge exibe "—").
    const [res, cmpRes] = await Promise.all([
      runCalculatedWidget(supabase, calcInput),
      cmpPeriod
        ? runCalculatedWidget(supabase, { ...calcInput, period: cmpPeriod }).catch(
            () => undefined
          )
        : Promise.resolve(undefined),
    ]);
    const fmtCalc = (r: {
      value: number | null;
      currency: string | null;
      text?: string;
    }): string =>
      r.text ??
      (r.value == null
        ? "—"
        : r.currency
          ? formatMoney(r.value, r.currency, decimals)
          : fmt(r.value, decimals));
    return {
      ...empty,
      ...(cmpSpec && cmp && cmpRes !== undefined
        ? {
            comparison: {
              base: cmpSpec.base,
              from: cmpSpec.from,
              to: cmpSpec.to,
              label: comparisonLabel(cmp, cmpSpec),
              settings: cmp,
            },
          }
        : {}),
      card: {
        mode,
        valueText: wrap(fmtCalc(res)),
        subText: card.secondaryText,
        value: res.value,
        cmpValue: cmpRes ? cmpRes.value : undefined,
        cmpValueText: cmpRes ? wrap(fmtCalc(cmpRes)) : undefined,
        currency: res.currency,
      },
    };
  }

  // "value" não passa por aqui (caminho agregado normal do runWidget).
  return empty;
}
