// Versão: 1.1 | Data: 09/07/2026
// v1.1 (09/07/2026): Fase 8 — filtra por fontes (record_type in ...), quebra por
//   fonte (dimensão record_type rotulada) e passa p_correspondences ao RPC para
//   os campos unificados (unified:<key>).
// Executa a config de um widget via o RPC run_widget_query (client do usuário
// → RLS) e resolve os rótulos das dimensões FK (responsible/operation/lead:
// id→nome). Razões/derivados (TM, valor/conta) e comparação com meta ficam na
// Fase 6B (widget KPI estendido).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { FieldDefinition } from "@/lib/records/types";
import {
  AGG_LABELS,
  TRANSFORM_LABELS,
  type Dimension,
  type Metric,
  type WidgetConfig,
  type WidgetData,
  type WidgetFilter,
  type WidgetRow,
} from "./types";
import {
  fieldFk,
  fieldLabel,
  type AvailableField,
  type FkKind,
} from "./fields";
import {
  convertToBRL,
  emptyBreakdown,
  formatMoney,
  formatMoneyAggregate,
  resolveCurrencyCode,
  toReferenceUSD,
  yearQuarterOf,
  type CurrencyRates,
  type MoneyBreakdown,
} from "./currency";
import { formatBucketLabel, isLabelTransform } from "./date-buckets";
import { applyPeriodToFilters, type DashboardPeriod } from "./period";
import { resolveGoal } from "@/lib/metas/resolve";
import {
  RECORD_TYPE_SOURCE,
  SOURCE_LABELS,
  SOURCE_RECORD_TYPE,
  type SourceKey,
} from "@/lib/sources";

// Resolve tokens de período (@month_start, @year_start, ...) para datas ISO,
// deixando os presets "do mês/ano" relativos ao momento da consulta.
function resolveToken(v: unknown): unknown {
  if (typeof v !== "string" || !v.startsWith("@")) return v;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  switch (v) {
    case "@today":
      return iso(now);
    case "@month_start":
      return iso(new Date(y, m, 1));
    case "@month_end":
      return iso(new Date(y, m + 1, 0));
    case "@year_start":
      return iso(new Date(y, 0, 1));
    case "@year_end":
      return iso(new Date(y, 11, 31));
    default:
      return v;
  }
}

export function resolveFilters(filters: WidgetFilter[]): WidgetFilter[] {
  return filters.map((f) => ({
    ...f,
    value: Array.isArray(f.value)
      ? f.value.map(resolveToken)
      : resolveToken(f.value),
  }));
}

function metricForMeta(metric: string): Metric {
  if (metric === "clientes") return { field: "*", agg: "count" };
  return { field: metric, agg: "sum" };
}

// Filtro implícito das fontes selecionadas (record_type in ...). Vazio = todas.
export function sourceFilters(sources?: SourceKey[]): WidgetFilter[] {
  if (!sources || sources.length === 0) return [];
  const rts = sources.map((s) => SOURCE_RECORD_TYPE[s]);
  return [{ field: "record_type", op: "in", value: rts }];
}

export async function aggregate(
  supabase: SupabaseClient,
  metrics: Metric[],
  filters: WidgetFilter[],
  correspondencesMap: Record<string, string[]> = {}
): Promise<number[]> {
  const { data, error } = await supabase.rpc("run_widget_query", {
    p_source: "records",
    p_dimensions: [],
    p_metrics: metrics,
    p_filters: filters,
    p_correspondences: correspondencesMap,
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data : [])[0] ?? {};
  return metrics.map((_, i) => Number(row[`metric_${i + 1}`] ?? 0));
}

// ===================== Agregação monetária com moeda ==========================
// Os widgets agregados vão ao RPC, que soma value/mrr/custom-moeda MISTURANDO as
// moedas dos registros. Para honrar a config de moeda (igual ao modo registros),
// rodamos uma consulta AUXILIAR quebrada por moeda + data-da-taxa, e convertemos
// cada subtotal no cliente com a MESMA matemática do metricAggText. Como conversão
// é linear, converter subtotais por (grupo, moeda, ano, trimestre) = converter
// registro a registro.

type ConversionYQ = { year: number; quarter: number };
interface MoneyInfo {
  metric: Metric;
  fixedCode: string | null; // moeda fixa do campo, ou null = moeda do registro
}

function isMoneyMetric(metric: Metric, available: AvailableField[]): boolean {
  return available.find((a) => a.field === metric.field)?.isMoney ?? false;
}

// Moeda FIXA de uma métrica monetária custom ('moeda' ou 'calculado'-fixo). null
// = moeda derivada do registro (value/mrr, 'calculado'-herda, unificado).
function moneyFixedCode(
  field: string,
  fieldByKey: Map<string, FieldDefinition>
): string | null {
  if (!field.startsWith("custom:")) return null;
  const f = fieldByKey.get(field.slice(7));
  if (!f) return null;
  if (f.data_type === "moeda") return resolveCurrencyCode(f.currency_code);
  if (f.data_type === "calculado" && f.currency_mode === "fixed")
    return resolveCurrencyCode(f.currency_code);
  return null; // 'calculado'-inherit → moeda do registro
}

// Ano do bucket date_trunc('year', ...) (ISO "2026-..." → 2026).
function parseRateYear(v: unknown): number | null {
  const m = String(v ?? "").match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}
// Trimestre do bucket date_trunc('quarter', ...) (mês do início do trimestre).
function parseRateQuarter(v: unknown): number | null {
  const m = String(v ?? "").match(/^\d{4}-(\d{2})/);
  if (!m) return null;
  return Math.floor((Number(m[1]) - 1) / 3) + 1;
}

/**
 * Consulta auxiliar + fold: retorna, por grupo (tupla das dims líderes, chave
 * JSON), um array de detalhamentos alinhado a `infos`. Reusa o RPC agrupando
 * também por `currency` e, quando alguma métrica usa base "registro", pela
 * data-da-taxa sintética `@rate_date` (year/quarter).
 */
async function buildMoneyBreakdowns(
  supabase: SupabaseClient,
  dims: Dimension[],
  filters: WidgetFilter[],
  correspondencesMap: Record<string, string[]>,
  infos: MoneyInfo[],
  rates: CurrencyRates,
  conversionPeriod: ConversionYQ,
  today: ConversionYQ
): Promise<Record<string, MoneyBreakdown[]>> {
  const nLead = dims.length;
  const needRecordDate = infos.some(
    (info) => info.metric.conversionBasis?.source !== "period"
  );
  const auxDims: Dimension[] = [...dims, { field: "currency" }];
  if (needRecordDate) {
    auxDims.push({ field: "@rate_date", transform: "year" });
    auxDims.push({ field: "@rate_date", transform: "quarter" });
  }
  const auxMetrics: Metric[] = infos.flatMap((info) => [
    { field: info.metric.field, agg: "sum" },
    { field: info.metric.field, agg: "count" },
  ]);

  const { data, error } = await supabase.rpc("run_widget_query", {
    p_source: "records",
    p_dimensions: auxDims,
    p_metrics: auxMetrics,
    p_filters: filters,
    p_correspondences: correspondencesMap,
  });
  if (error) throw new Error(error.message);
  const auxRows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];

  const curKey = `dim_${nLead + 1}`;
  const yearKey = `dim_${nLead + 2}`;
  const quarterKey = `dim_${nLead + 3}`;
  const out: Record<string, MoneyBreakdown[]> = {};

  for (const row of auxRows) {
    const tuple: unknown[] = [];
    for (let i = 1; i <= nLead; i++) tuple.push(row[`dim_${i}`] ?? null);
    const gk = JSON.stringify(tuple);
    const arr = (out[gk] ??= infos.map(() => emptyBreakdown()));

    const recYear = needRecordDate ? parseRateYear(row[yearKey]) : null;
    const recQuarter = needRecordDate ? parseRateQuarter(row[quarterKey]) : null;

    infos.forEach((info, k) => {
      const raw = Number(row[`metric_${2 * k + 1}`]);
      const cnt = Number(row[`metric_${2 * k + 2}`]);
      const bd = arr[k];
      if (Number.isFinite(cnt)) bd.count += cnt;
      if (!Number.isFinite(raw)) return;
      const code = info.fixedCode ?? resolveCurrencyCode(row[curKey] as string);
      const isQuarter = info.metric.conversionBasis?.granularity === "quarter";
      let year: number;
      let quarter: number;
      if (info.metric.conversionBasis?.source === "period") {
        year = conversionPeriod.year;
        quarter = isQuarter ? conversionPeriod.quarter : 0;
      } else {
        year = recYear ?? today.year;
        quarter = isQuarter ? (recQuarter ?? today.quarter) : 0;
      }
      bd.perCurrency[code] = (bd.perCurrency[code] ?? 0) + raw;
      const b = convertToBRL(raw, code, rates, year, quarter);
      if (b != null) bd.brl += b;
      const u = toReferenceUSD(raw, code, rates, year, quarter);
      if (u != null) bd.usd += u;
    });
  }
  return out;
}

// Valor numérico a plotar num gráfico para um detalhamento, conforme a decisão de
// série `keepForeign` (mantém a moeda estrangeira única) ou converte p/ R$. `avg`
// divide pela contagem. Coerente com o texto de formatMoneyAggregate.
function plotAmount(bd: MoneyBreakdown, agg: string, foreignCode: string | null): number {
  const div = (v: number) => (agg === "avg" && bd.count > 0 ? v / bd.count : v);
  return foreignCode ? div(bd.perCurrency[foreignCode] ?? 0) : div(bd.brl);
}

// Anexa `__money` a cada linha (por grupo) e reescreve `metric_<n>` com o valor
// numérico a plotar. A moeda de plotagem é decidida por SÉRIE: mantém a moeda
// estrangeira quando toda a série é de uma única moeda estrangeira e a exibição é
// "original"; senão converte p/ R$. Mantém o número coerente com o rótulo.
function attachMoney(
  rows: WidgetRow[],
  dims: Dimension[],
  moneyEntries: { m: Metric; i: number }[],
  bdMap: Record<string, MoneyBreakdown[]>
): void {
  for (const row of rows) {
    const tuple: unknown[] = [];
    for (let i = 1; i <= dims.length; i++) tuple.push(row[`dim_${i}`] ?? null);
    const arr = bdMap[JSON.stringify(tuple)];
    const money: Record<string, MoneyBreakdown> = {};
    moneyEntries.forEach(({ i }, k) => {
      money[`metric_${i + 1}`] = arr?.[k] ?? emptyBreakdown();
    });
    row.__money = money;
  }
  for (const { m, i } of moneyEntries) {
    const metricKey = `metric_${i + 1}`;
    let single = true;
    let code: string | null = null;
    for (const row of rows) {
      const codes = Object.keys(row.__money![metricKey].perCurrency);
      if (codes.length === 0) continue;
      if (codes.length > 1) {
        single = false;
        break;
      }
      if (code == null) code = codes[0];
      else if (code !== codes[0]) {
        single = false;
        break;
      }
    }
    const disp = m.currencyDisplay ?? "original";
    const foreign =
      single && code != null && code !== "BRL" && disp === "original"
        ? code
        : null;
    for (const row of rows) {
      row[metricKey] = plotAmount(row.__money![metricKey], m.agg, foreign);
    }
  }
}

async function fetchFkLabels(
  supabase: SupabaseClient,
  fk: FkKind,
  ids: string[]
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  if (ids.length === 0) return map;

  if (fk === "responsible") {
    const { data } = await supabase
      .from("responsibles")
      .select("id, display_name")
      .in("id", ids);
    for (const r of data ?? []) map[r.id as string] = (r.display_name as string) ?? "—";
  } else if (fk === "operation") {
    const { data } = await supabase
      .from("operations")
      .select("id, name")
      .in("id", ids);
    for (const r of data ?? []) map[r.id as string] = (r.name as string) ?? "—";
  } else {
    const { data } = await supabase
      .from("records")
      .select("id, title")
      .in("id", ids);
    for (const r of data ?? []) map[r.id as string] = (r.title as string) ?? "—";
  }
  return map;
}

// KPI com meta ou razão (Fase 6B). Retorna WidgetData.kpi.
async function runKpi(
  supabase: SupabaseClient,
  config: WidgetConfig,
  filters: WidgetFilter[],
  correspondencesMap: Record<string, string[]>,
  available: AvailableField[],
  fieldByKey: Map<string, FieldDefinition>,
  rates: CurrencyRates,
  conversionPeriod: ConversionYQ,
  today: ConversionYQ,
  period?: DashboardPeriod | null
): Promise<WidgetData> {
  const s = config.settings ?? {};
  const empty = { rows: [], dimensions: [], metrics: [] };
  // Config de moeda do KPI (mesma semântica dos campos de Metric).
  const kpiCfg = (agg: string) => ({
    agg,
    currencyDisplay: s.currencyDisplay,
    currencyMultiMode: s.currencyMultiMode,
    grandTotalMode: s.grandTotalMode,
  });
  // Detalhamento monetário de UMA métrica sobre todo o recorte (sem dimensões).
  const moneyBreakdown = async (m: Metric): Promise<MoneyBreakdown | null> => {
    const infos: MoneyInfo[] = [
      { metric: m, fixedCode: moneyFixedCode(m.field, fieldByKey) },
    ];
    // Degrada com elegância se a aux falhar (migração 0039 ausente): null =
    // cai no número cru do aggregate.
    try {
      const map = await buildMoneyBreakdowns(
        supabase,
        [],
        filters,
        correspondencesMap,
        infos,
        rates,
        conversionPeriod,
        today
      );
      return map["[]"]?.[0] ?? emptyBreakdown();
    } catch {
      return null;
    }
  };

  if (s.mode === "ratio") {
    const num = s.numerator ?? { field: "mrr", agg: "sum" };
    const den = s.denominator ?? { field: "*", agg: "count" };
    const numMoney = isMoneyMetric(num, available);
    const denMoney = isMoneyMetric(den, available);
    const [nRaw, dRaw] = await aggregate(supabase, [num, den], filters, correspondencesMap);
    let n = nRaw;
    let d = dRaw;
    let numConverted = false;
    // Money → usa o valor convertido (R$); numerador em R$ dá razão em R$.
    if (numMoney) {
      const bd = await moneyBreakdown(num);
      if (bd) {
        n = num.agg === "avg" && bd.count > 0 ? bd.brl / bd.count : bd.brl;
        numConverted = true;
      }
    }
    if (denMoney) {
      const bd = await moneyBreakdown(den);
      if (bd) d = den.agg === "avg" && bd.count > 0 ? bd.brl / bd.count : bd.brl;
    }
    const value = d ? n / d : null;
    return {
      ...empty,
      kpi: {
        mode: "ratio",
        label: s.label ?? "Razão",
        value,
        // A razão de um numerador monetário é uma cifra em R$ (ex.: ticket médio).
        ...(numConverted && value != null
          ? { valueText: formatMoney(value, "BRL") }
          : {}),
      },
    };
  }

  // modo meta
  const metric = s.metric ?? "mrr";
  const metaMetric = metricForMeta(metric);
  const metaMoney = isMoneyMetric(metaMetric, available);
  let realizado: number;
  let realizadoText: string | undefined;
  const metaBd = metaMoney ? await moneyBreakdown(metaMetric) : null;
  if (metaBd) {
    // Realizado numérico em R$ (compara com a meta, também em R$).
    realizado =
      metaMetric.agg === "avg" && metaBd.count > 0
        ? metaBd.brl / metaBd.count
        : metaBd.brl;
    realizadoText = formatMoneyAggregate(metaBd, kpiCfg(metaMetric.agg));
  } else {
    [realizado] = await aggregate(supabase, [metaMetric], filters, correspondencesMap);
  }
  const now = new Date();
  let year = now.getFullYear();
  let month: number | null = s.period === "year" ? null : now.getMonth() + 1;
  // Com período global ativo, a meta acompanha o período: meta do mês quando o
  // intervalo cabe num único mês; senão, meta anual do ano da data inicial.
  if (period?.from) {
    const from = new Date(`${period.from}T00:00:00`);
    const to = period.to ? new Date(`${period.to}T00:00:00`) : null;
    year = from.getFullYear();
    const sameMonth =
      to != null &&
      to.getFullYear() === from.getFullYear() &&
      to.getMonth() === from.getMonth();
    month = sameMonth ? from.getMonth() + 1 : null;
  }
  const goal = await resolveGoal(supabase, {
    scope: s.scope ?? "global",
    operationId: s.operationId ?? null,
    responsibleId: s.responsibleId ?? null,
    year,
    month,
    metric,
  });
  const meta = goal.target;
  return {
    ...empty,
    kpi: {
      mode: "meta",
      label: s.label ?? metric.toUpperCase(),
      realizado,
      meta,
      pct: meta ? realizado / meta : null,
      falta: meta != null ? meta - realizado : null,
      // Textos monetários (realizado honra a config; meta/falta são sempre R$).
      ...(metaMoney
        ? {
            realizadoText,
            metaText: meta != null ? formatMoney(meta, "BRL") : undefined,
            faltaText:
              meta != null ? formatMoney(meta - realizado, "BRL") : undefined,
          }
        : {}),
    },
  };
}

export async function runWidget(
  supabase: SupabaseClient,
  config: WidgetConfig,
  available: AvailableField[],
  period?: DashboardPeriod | null,
  correspondencesMap: Record<string, string[]> = {},
  fields: FieldDefinition[] = [],
  rates: CurrencyRates = {},
  conversionPeriod: ConversionYQ = yearQuarterOf(null)
): Promise<WidgetData> {
  let filters = resolveFilters(config.filters ?? []);
  if (period) filters = applyPeriodToFilters(filters, period);
  // Fonte(s) selecionada(s) viram um filtro record_type in (...).
  filters = [...sourceFilters(config.sources), ...filters];

  const fieldByKey = new Map(fields.map((f) => [f.field_key, f]));
  const today = yearQuarterOf(null);

  if (config.visual_type === "kpi" && config.settings?.mode) {
    return runKpi(
      supabase,
      config,
      filters,
      correspondencesMap,
      available,
      fieldByKey,
      rates,
      conversionPeriod,
      today,
      period
    );
  }

  // "Quebrar por fonte": record_type entra como dimensão líder (série por fonte).
  const dims: Dimension[] = config.splitBySource
    ? [{ field: "record_type" }, ...config.dimensions]
    : config.dimensions;

  const { data, error } = await supabase.rpc("run_widget_query", {
    p_source: config.source,
    p_dimensions: dims,
    p_metrics: config.metrics,
    p_filters: filters,
    p_correspondences: correspondencesMap,
  });
  if (error) throw new Error(error.message);

  const rows = (Array.isArray(data) ? data : []) as WidgetRow[];

  // Métricas monetárias: consulta auxiliar por moeda + data-da-taxa e fold no
  // cliente, anexando `__money` a cada linha (ANTES da rotulagem, que muta os
  // dim_* usados como chave de grupo). Charts plotam `metric_<n>` numérico.
  const moneyEntries = config.metrics
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => isMoneyMetric(m, available));
  if (moneyEntries.length > 0 && rows.length > 0) {
    const infos: MoneyInfo[] = moneyEntries.map(({ m }) => ({
      metric: m,
      fixedCode: moneyFixedCode(m.field, fieldByKey),
    }));
    // Degrada com elegância se a consulta auxiliar falhar (ex.: migração
    // 0039 ainda não aplicada): sem `__money`, os charts caem no número puro.
    let bdMap: Record<string, MoneyBreakdown[]> = {};
    try {
      bdMap = await buildMoneyBreakdowns(
        supabase,
        dims,
        filters,
        correspondencesMap,
        infos,
        rates,
        conversionPeriod,
        today
      );
    } catch {
      bdMap = {};
    }
    // bdMap vazio = degradação (aux falhou): não anexa __money nem sobrescreve os
    // valores, deixando o número cru do RPC (fmt) — melhor que zerar tudo.
    if (Object.keys(bdMap).length > 0) {
      attachMoney(rows, dims, moneyEntries, bdMap);
    }
  }

  // Transforms de data "por nome" (mês/semana): o RPC devolve um bucket ISO. Antes
  // de rotular, reordena cronologicamente pelo bucket cru (as linhas do RPC não
  // têm ORDER BY) usando as dimensões de rótulo na ordem em que aparecem.
  const labelDimKeys = dims
    .map((d, i) => ({ i, d }))
    .filter(({ d }) => isLabelTransform(d.transform))
    .map(({ i }) => `dim_${i + 1}`);
  if (labelDimKeys.length > 0) {
    rows.sort((a, b) => {
      for (const key of labelDimKeys) {
        const av = String(a[key] ?? "");
        const bv = String(b[key] ?? "");
        if (av !== bv) return av < bv ? -1 : 1;
      }
      return 0;
    });
  }

  // Resolve rótulos das dimensões: FK (id→nome), fonte (record_type→label) e os
  // transforms de data "por nome" (bucket ISO → Janeiro / 1ª semana de Janeiro).
  for (let i = 0; i < dims.length; i++) {
    const dim = dims[i];
    const key = `dim_${i + 1}`;
    if (isLabelTransform(dim.transform)) {
      for (const r of rows) {
        if (r[key] != null)
          r[key] = formatBucketLabel(dim.transform!, r[key], dim.weekMode);
      }
      continue;
    }
    if (dim.field === "record_type") {
      for (const r of rows) {
        const v = r[key];
        if (v != null) {
          const src = RECORD_TYPE_SOURCE[String(v)];
          r[key] = src ? SOURCE_LABELS[src] : String(v);
        }
      }
      continue;
    }
    const fk = fieldFk(dim.field, available);
    if (!fk) continue;
    const ids = Array.from(
      new Set(rows.map((r) => r[key]).filter(Boolean) as string[])
    );
    if (ids.length === 0) continue;
    const labels = await fetchFkLabels(supabase, fk, ids);
    for (const r of rows) {
      const v = r[key];
      if (v != null) r[key] = labels[String(v)] ?? String(v);
    }
  }

  const dimensions = dims.map((d, i) => {
    const base = d.field === "record_type" ? "Fonte" : fieldLabel(d.field, available);
    const suffix =
      d.transform && d.transform !== "none"
        ? ` (${TRANSFORM_LABELS[d.transform]})`
        : "";
    // Nome exibido editável (estético) tem precedência sobre o rótulo padrão.
    return { key: `dim_${i + 1}`, label: d.label?.trim() || `${base}${suffix}` };
  });

  const metrics = config.metrics.map((m, i) => ({
    key: `metric_${i + 1}`,
    label: m.label?.trim() || `${AGG_LABELS[m.agg]} · ${fieldLabel(m.field, available)}`,
    isMoney: isMoneyMetric(m, available),
  }));

  return { rows, dimensions, metrics };
}
