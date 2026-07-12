// Versão: 1.1 | Data: 09/07/2026
// v1.1 (09/07/2026): Fase 8 — filtra por fontes (record_type in ...), quebra por
//   fonte (dimensão record_type rotulada) e passa p_correspondences ao RPC para
//   os campos unificados (unified:<key>).
// Executa a config de um widget via o RPC run_widget_query (client do usuário
// → RLS) e resolve os rótulos das dimensões FK (responsible/operation/lead:
// id→nome). Razões/derivados (TM, valor/conta) e comparação com meta ficam na
// Fase 6B (widget KPI estendido).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import {
  AGG_LABELS,
  DATE_AGG_LABELS,
  TRANSFORM_LABELS,
  type DateAgg,
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
import { bucketRecordDate } from "./date-buckets";
import { runRecordList } from "./record-list";
import {
  buildRecordBreakdown,
  convertToBRL,
  emptyBreakdown,
  formatMoney,
  formatMoneyAggregate,
  resolveCurrencyCode,
  resolveFieldMoney,
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
  const auxMetrics: Metric[] = infos.flatMap((info) => [
    { field: info.metric.field, agg: "sum" },
    { field: info.metric.field, agg: "count" },
  ]);

  // Consulta auxiliar quebrada por moeda (e, quando `useRateDate`, também pela
  // data-da-taxa sintética `@rate_date`, que exige a migração 0039).
  const runAux = async (
    useRateDate: boolean
  ): Promise<Record<string, unknown>[]> => {
    const auxDims: Dimension[] = [...dims, { field: "currency" }];
    if (useRateDate) {
      auxDims.push({ field: "@rate_date", transform: "year" });
      auxDims.push({ field: "@rate_date", transform: "quarter" });
    }
    const { data, error } = await supabase.rpc("run_widget_query", {
      p_source: "records",
      p_dimensions: auxDims,
      p_metrics: auxMetrics,
      p_filters: filters,
      p_correspondences: correspondencesMap,
    });
    if (error) throw new Error(error.message);
    return (Array.isArray(data) ? data : []) as Record<string, unknown>[];
  };

  // Precisão de taxa por registro depende do `@rate_date` (migração 0039). Quando
  // o RPC não o conhece (0039 não aplicada), a aux falha e caímos para o
  // agrupamento SÓ por moeda — a moeda continua sendo formatada/convertida, mas a
  // taxa passa a ser a do período do dashboard (aproximação), em vez de por
  // registro. Assim a config de moeda funciona em widgets agregados sem migração.
  let withRateDate = needRecordDate;
  let auxRows: Record<string, unknown>[];
  try {
    auxRows = await runAux(needRecordDate);
  } catch (e) {
    if (!needRecordDate) throw e;
    auxRows = await runAux(false);
    withRateDate = false;
  }

  const curKey = `dim_${nLead + 1}`;
  const yearKey = `dim_${nLead + 2}`;
  const quarterKey = `dim_${nLead + 3}`;
  const out: Record<string, MoneyBreakdown[]> = {};

  for (const row of auxRows) {
    const tuple: unknown[] = [];
    for (let i = 1; i <= nLead; i++) tuple.push(row[`dim_${i}`] ?? null);
    const gk = JSON.stringify(tuple);
    const arr = (out[gk] ??= infos.map(() => emptyBreakdown()));

    const recYear = withRateDate ? parseRateYear(row[yearKey]) : null;
    const recQuarter = withRateDate ? parseRateQuarter(row[quarterKey]) : null;

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
      if (info.metric.conversionBasis?.source === "period" || !withRateDate) {
        // Base "período", OU base "registro" sem `@rate_date` disponível: usa a
        // data-da-taxa do período do dashboard (igual p/ todos os registros).
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

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function mode(nums: number[]): number {
  if (nums.length === 0) return 0;
  const count = new Map<number, number>();
  let best = nums[0];
  let bestCount = 0;
  for (const n of nums) {
    const c = (count.get(n) ?? 0) + 1;
    count.set(n, c);
    if (c > bestCount || (c === bestCount && n < best)) {
      best = n;
      bestCount = c;
    }
  }
  return best;
}

// "Agrupar período": quando uma dimensão de data tem `dateAgg` definido, o widget
// agregado é computado POR REGISTRO no app (o RPC não faz mediana/moda e o
// "individual" é 1 ponto por registro). Espelha a agregação do record-list para os
// números baterem entre os modos; agrupa pelo bucket do formato e agrega as
// métricas com a função escolhida. Como este caminho já tem os registros crus,
// monta `__money` client-side (igual ao modo registros individuais), formatando a
// moeda pelos charts sem depender do RPC/migração.
async function runWidgetByPeriod(
  supabase: SupabaseClient,
  config: WidgetConfig,
  available: AvailableField[],
  period: DashboardPeriod | null | undefined,
  fieldByKey: Map<string, FieldDefinition>,
  rates: CurrencyRates,
  conversionPeriod: ConversionYQ
): Promise<WidgetData> {
  const dims: Dimension[] = config.splitBySource
    ? [{ field: "record_type" }, ...config.dimensions]
    : config.dimensions;
  const dateIdx = dims.findIndex((d) => d.dateAgg != null && d.transform);
  const dateDim = dims[dateIdx];
  const fn = dateDim.dateAgg as DateAgg;
  // TODA dimensão com transform é bucketizada pelo próprio formato (não só a 1ª):
  // p. ex. duas "Data da assinatura (Nome do mês)" viram ambas "Janeiro". A função
  // de agregação das métricas (fn) segue a 1ª data (dateDim).
  const isDateBucket = (d: Dimension) =>
    d.transform != null && d.transform !== "none";

  const records = (await runRecordList(supabase, config, period)) as RecordRow[];

  const rawValue = (field: string, r: RecordRow): unknown =>
    field.startsWith("custom:")
      ? r.custom_fields?.[field.slice(7)]
      : (r as unknown as Record<string, unknown>)[field];
  const isMoney = (field: string) =>
    available.find((a) => a.field === field)?.isMoney ?? false;

  // Moeda efetiva de um registro p/ uma métrica: campo 'moeda'/calc-fixo tem moeda
  // própria; value/mrr e calc-herda usam a moeda do registro (mesma regra do
  // record-list-table).
  const metricCurrency = (field: string, r: RecordRow): string => {
    if (field.startsWith("custom:")) {
      const f = fieldByKey.get(field.slice(7));
      return f
        ? resolveFieldMoney(f, r.currency).code
        : resolveCurrencyCode(r.currency);
    }
    return resolveCurrencyCode(r.currency);
  };
  // Ano/trimestre da taxa: base "período" usa o período do dashboard; base
  // "registro" usa a data do registro (fechamento → abertura → criação).
  const recYQ = (r: RecordRow, m: Metric): { year: number; quarter: number } => {
    const isQuarter = m.conversionBasis?.granularity === "quarter";
    if (m.conversionBasis?.source === "period") {
      return {
        year: conversionPeriod.year,
        quarter: isQuarter ? conversionPeriod.quarter : 0,
      };
    }
    const { year, quarter } = yearQuarterOf(
      r.closed_at ?? r.opened_at ?? r.source_created_at
    );
    return { year, quarter: isQuarter ? quarter : 0 };
  };

  const aggMetricNum = (m: Metric, rs: RecordRow[]): number => {
    if (fn === "count" || m.field === "*") return rs.length;
    const nums = rs
      .map((r) => Number(rawValue(m.field, r)))
      .filter((n) => Number.isFinite(n));
    switch (fn) {
      case "sum":
        return nums.reduce((s, n) => s + n, 0);
      case "avg":
        return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
      case "median":
        return median(nums);
      case "mode":
        return mode(nums);
      default:
        return 0;
    }
  };

  type DV = { key: string; label: string; sort: number };
  const dimValue = (d: Dimension, r: RecordRow): DV => {
    if (isDateBucket(d)) {
      const b = bucketRecordDate(rawValue(d.field, r), d.transform!, d.weekMode);
      return { key: b.key, label: b.label, sort: b.sort };
    }
    const v = rawValue(d.field, r);
    return { key: String(v ?? ""), label: v == null ? "—" : String(v), sort: 0 };
  };

  // Agrupa: "individual" = 1 grupo por registro; senão pela tupla das dimensões.
  const groups = new Map<string, { dv: DV[]; records: RecordRow[] }>();
  for (const r of records) {
    const dvs = dims.map((d) => dimValue(d, r));
    const gkey = fn === "individual" ? r.id : dvs.map((x) => x.key).join("");
    let g = groups.get(gkey);
    if (!g) {
      g = { dv: dvs, records: [] };
      groups.set(gkey, g);
    }
    g.records.push(r);
  }

  // Resolve rótulos das dimensões não-data (fonte e FK id→nome).
  for (let di = 0; di < dims.length; di++) {
    if (isDateBucket(dims[di])) continue;
    const d = dims[di];
    if (d.field === "record_type") {
      for (const g of groups.values()) {
        const src = RECORD_TYPE_SOURCE[g.dv[di].key];
        g.dv[di] = { ...g.dv[di], label: src ? SOURCE_LABELS[src] : g.dv[di].label };
      }
      continue;
    }
    const fk = fieldFk(d.field, available);
    if (!fk) continue;
    const ids = Array.from(
      new Set([...groups.values()].map((g) => g.dv[di].key).filter(Boolean))
    );
    if (ids.length === 0) continue;
    const labels = await fetchFkLabels(supabase, fk, ids);
    for (const g of groups.values()) {
      const id = g.dv[di].key;
      if (id) g.dv[di] = { ...g.dv[di], label: labels[id] ?? id };
    }
  }

  // Ordena cronologicamente por TODAS as dimensões de data (na ordem em que
  // aparecem); com uma só data, equivale ao comportamento anterior.
  const dateIdxs = dims
    .map((d, i) => (isDateBucket(d) ? i : -1))
    .filter((i) => i >= 0);
  const groupList = [...groups.values()].sort((a, b) => {
    for (const di of dateIdxs) {
      const diff = a.dv[di].sort - b.dv[di].sort;
      if (diff !== 0) return diff;
    }
    return 0;
  });

  const rows: WidgetRow[] = groupList.map((g) => {
    const row: WidgetRow = {};
    dims.forEach((d, di) => {
      row[`dim_${di + 1}`] = g.dv[di].label;
    });
    const money: Record<string, MoneyBreakdown> = {};
    config.metrics.forEach((m, mi) => {
      let val: number;
      if (fn === "individual") {
        if (m.field === "*") val = 1;
        else {
          const n = Number(rawValue(m.field, g.records[0]));
          val = Number.isFinite(n) ? n : 0;
        }
      } else {
        val = aggMetricNum(m, g.records);
      }
      row[`metric_${mi + 1}`] = val;
      // Métrica monetária: detalhamento por moeda dos registros do grupo, montado
      // client-side (mesma lógica do modo registros). Os charts formatam pelo
      // MESMO `formatMoneyAggregate`, dando paridade entre os dois modos.
      if (m.field !== "*" && isMoney(m.field)) {
        money[`metric_${mi + 1}`] = buildRecordBreakdown(
          g.records,
          (r) => rawValue(m.field, r),
          (r) => metricCurrency(m.field, r),
          (r) => recYQ(r, m),
          rates
        );
      }
    });
    if (Object.keys(money).length > 0) row.__money = money;
    return row;
  });

  const dimensions = dims.map((d, i) => {
    const base = d.field === "record_type" ? "Fonte" : fieldLabel(d.field, available);
    const suffix =
      d.transform && d.transform !== "none"
        ? ` (${TRANSFORM_LABELS[d.transform]})`
        : "";
    return { key: `dim_${i + 1}`, label: d.label?.trim() || `${base}${suffix}` };
  });
  const metrics = config.metrics.map((m, i) => ({
    key: `metric_${i + 1}`,
    label:
      m.label?.trim() ||
      (fn === "individual"
        ? fieldLabel(m.field, available)
        : `${DATE_AGG_LABELS[fn]} · ${fieldLabel(m.field, available)}`),
    isMoney: isMoney(m.field),
  }));

  return { rows, dimensions, metrics };
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
  if (period) filters = applyPeriodToFilters(filters, period, config.sources);
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

  // "Agrupar período" numa dimensão de data → agrega por registro no app (mediana/
  // moda/individual; soma/contagem/média também, p/ bater com o modo registros).
  if (config.dimensions.some((d) => d.dateAgg != null && d.transform)) {
    return runWidgetByPeriod(
      supabase,
      config,
      available,
      period,
      fieldByKey,
      rates,
      conversionPeriod
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
