// Versão: 1.3 | Data: 15/07/2026
// v1.3 (15/07/2026): filtros segmentados por fonte — applyFilterSourceTargets
//   converte WidgetFilter.sources em record_types (wrapper pass-through no RPC,
//   migração 0054) antes do @period/sourceFilters.
// v1.2 (15/07/2026): exibição percentual — carimba percent em data.metrics
//   (isPercentFieldRef; contagem nunca) e KPI razão com KpiSettings.percent.
// v1.1 (09/07/2026): Fase 8 — filtra por fontes (record_type in ...), quebra por
//   fonte (dimensão record_type rotulada) e passa p_correspondences ao RPC para
//   os campos unificados (unified:<key>).
// Executa a config de um widget via o RPC run_widget_query (client do usuário
// → RLS) e resolve os rótulos das dimensões FK (responsible/operation/lead:
// id→nome). Razões/derivados (TM, valor/conta) e comparação com meta ficam na
// Fase 6B (widget KPI estendido).
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isPercentFieldRef,
  type FieldDefinition,
  type RecordRow,
} from "@/lib/records/types";
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
import {
  basisKeysFor,
  basisMetric,
  condFilters,
  evalCalcMoney,
  isCalcMetric,
  isCondBasisKey,
  isMoneyOperandField,
  parseCondBasisKey,
  recordMatchesConds,
  resolveCalcMetric,
  type BasisKey,
  type BasisValues,
  type CalcMoneyMeta,
  type ResolvedCalcMetric,
} from "./calc-metrics";
import { applyFilterSourceTargets } from "./filter-sources";
import { runRecordList } from "./record-list";
import {
  buildRecordBreakdown,
  calcCurrencyKey,
  convertToBRL,
  emptyBreakdown,
  formatMoney,
  formatMoneyAggregate,
  resolveCurrencyCode,
  resolveFieldMoneyFromRecord,
  resolveRate,
  toReferenceUSD,
  validCurrencyStamp,
  yearQuarterOf,
  type CurrencyRates,
  type MoneyBreakdown,
} from "./currency";
import { formatBucketLabel, isLabelTransform } from "./date-buckets";
import { applyPeriodToFilters, type DashboardPeriod } from "./period";
import { DEFAULT_DATE_FORMAT, formatDateValue, formatPercent } from "./format";
import { todayBrasiliaIso } from "@/lib/date/today";
import { unifiedMemberRef } from "@/lib/correspondences";
import { resolveGoal } from "@/lib/metas/resolve";
import {
  SOURCE_LABELS,
  toRecordType,
  toSourceKey,
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
  const rts = sources.map((s) => toRecordType(s));
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
  fixedCode: string | null; // moeda fixa do campo, ou null = moeda por registro
  // Dimensão que dá a moeda de cada valor quando não há moeda fixa: 'currency'
  // (moeda do registro) ou o carimbo por valor de um 'calculado'-automático
  // ('custom:<key>__cur'), com coalesce p/ 'currency' quando vazio.
  currencyField: string;
}

function isMoneyMetric(metric: Metric, available: AvailableField[]): boolean {
  return available.find((a) => a.field === metric.field)?.isMoney ?? false;
}

// Origem da moeda de uma métrica/operando monetário: moeda FIXA do campo
// ('moeda' ou 'calculado'-fixo) ou a coluna/dimensão que carrega a moeda por
// valor — 'currency' (registro) ou o carimbo 'custom:<key>__cur' do
// 'calculado'-automático (a moeda do resultado pode diferir da do registro).
function moneyCurrencyInfo(
  field: string,
  fieldByKey: Map<string, FieldDefinition>
): { fixedCode: string | null; currencyField: string } {
  if (field.startsWith("custom:")) {
    const f = fieldByKey.get(field.slice(7));
    if (f) {
      if (f.data_type === "moeda") {
        // 'inherit' (padrão) segue a moeda do registro, como value/mrr.
        if (f.currency_mode === "inherit") {
          return { fixedCode: null, currencyField: "currency" };
        }
        return {
          fixedCode: resolveCurrencyCode(f.currency_code),
          currencyField: "currency",
        };
      }
      if (f.data_type === "calculado") {
        if (f.currency_mode === "fixed") {
          return {
            fixedCode: resolveCurrencyCode(f.currency_code),
            currencyField: "currency",
          };
        }
        if (f.currency_mode === "inherit") {
          return {
            fixedCode: null,
            currencyField: `custom:${calcCurrencyKey(f.field_key)}`,
          };
        }
      }
    }
  }
  return { fixedCode: null, currencyField: "currency" };
}

// Meta de moeda de uma métrica calculada de agregados (evalCalcMoney): modo
// automático preserva a moeda dos operandos; fixo converte, com a taxa do
// período do dashboard pré-resolvida — o client reavalia subtotais sem as taxas.
function calcMoneyMeta(
  rc: ResolvedCalcMetric,
  rates: CurrencyRates,
  conversionPeriod: ConversionYQ
): CalcMoneyMeta {
  return {
    mode: rc.mode,
    code: rc.code,
    fixedRate:
      rc.mode === "fixed" && rc.code
        ? resolveRate(
            rates,
            rc.code,
            conversionPeriod.year,
            conversionPeriod.quarter
          )
        : null,
    allowNegative: rc.allowNegative,
  };
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
  // Dimensões extras de moeda por valor (carimbo 'custom:<key>__cur' dos campos
  // 'calculado'-automáticos), além da coluna `currency` (sempre presente como
  // fallback p/ carimbo vazio/registros pré-recálculo).
  const stampFields = [
    ...new Set(
      infos
        .map((info) => info.currencyField)
        .filter((f) => f !== "currency")
    ),
  ];

  // Consulta auxiliar quebrada por moeda (e, quando `useRateDate`, também pela
  // data-da-taxa sintética `@rate_date`, que exige a migração 0039).
  const runAux = async (
    useRateDate: boolean
  ): Promise<Record<string, unknown>[]> => {
    const auxDims: Dimension[] = [
      ...dims,
      { field: "currency" },
      ...stampFields.map((f) => ({ field: f })),
    ];
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
  const stampKeyOf = new Map(
    stampFields.map((f, i) => [f, `dim_${nLead + 2 + i}`])
  );
  const yearKey = `dim_${nLead + 2 + stampFields.length}`;
  const quarterKey = `dim_${nLead + 3 + stampFields.length}`;
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
      // Moeda do valor: fixa do campo > carimbo por valor (calculado-automático,
      // com fallback p/ a moeda do registro) > moeda do registro.
      const stampKey = stampKeyOf.get(info.currencyField);
      const code =
        info.fixedCode ??
        (stampKey ? validCurrencyStamp(row[stampKey]) : null) ??
        resolveCurrencyCode(row[curKey] as string);
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

/**
 * Detalhamento monetário de métricas sobre TODO o recorte (sem dimensões) —
 * wrapper exportado p/ o KPI "Métrica calculada" do dashboard resolver seus
 * operandos monetários com moeda. Alinhado a `metrics`; null = aux indisponível
 * (degrada p/ o número cru do aggregate).
 */
export async function aggregateMoneyBreakdowns(
  supabase: SupabaseClient,
  metrics: Metric[],
  filters: WidgetFilter[],
  correspondencesMap: Record<string, string[]>,
  fieldByKey: Map<string, FieldDefinition>,
  rates: CurrencyRates,
  conversionPeriod: ConversionYQ
): Promise<MoneyBreakdown[] | null> {
  const infos: MoneyInfo[] = metrics.map((m) => ({
    metric: m,
    ...moneyCurrencyInfo(m.field, fieldByKey),
  }));
  try {
    const map = await buildMoneyBreakdowns(
      supabase,
      [],
      filters,
      correspondencesMap,
      infos,
      rates,
      conversionPeriod,
      yearQuarterOf(null)
    );
    return map["[]"] ?? metrics.map(() => emptyBreakdown());
  } catch {
    return null;
  }
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

  // KPI "Data atual": mostra o dia de hoje em Brasília. Sintético — não consulta
  // o banco; o valor é sempre live (resolvido a cada render no servidor).
  if (s.mode === "data_atual") {
    return {
      ...empty,
      kpi: {
        mode: "data_atual",
        label: s.label ?? "Data atual",
        valueText: formatDateValue(todayBrasiliaIso(), DEFAULT_DATE_FORMAT),
      },
    };
  }
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
      { metric: m, ...moneyCurrencyInfo(m.field, fieldByKey) },
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
        // `percent` (não-monetário): razão exibida ×100 + "%" (0.35 → "35%").
        ...(numConverted && value != null
          ? { valueText: formatMoney(value, "BRL") }
          : s.percent && value != null
            ? { valueText: formatPercent(value, true) }
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

  const records = (await runRecordList(
    supabase,
    config,
    period,
    available
  )) as RecordRow[];

  // Campo unificado: resolve o MEMBRO da fonte do registro (espelha o coalesce
  // que o RPC monta); fonte sem membro → undefined (fica fora do bucket/soma).
  const resolveRef = (field: string, r: RecordRow): string | null =>
    field.startsWith("unified:")
      ? unifiedMemberRef(
          available.find((a) => a.field === field)?.unifiedMembers,
          r.record_type
        )
      : field;
  const rawValue = (field: string, r: RecordRow): unknown => {
    const ref = resolveRef(field, r);
    if (!ref) return undefined;
    return ref.startsWith("custom:")
      ? r.custom_fields?.[ref.slice(7)]
      : (r as unknown as Record<string, unknown>)[ref];
  };
  const isMoney = (field: string) =>
    available.find((a) => a.field === field)?.isMoney ?? false;

  // Moeda efetiva de um registro p/ uma métrica: campo 'moeda'/calc-fixo tem
  // moeda própria; calc-automático usa o carimbo por valor (fallback: moeda do
  // registro); value/mrr usam a moeda do registro (mesma regra do
  // record-list-table).
  const metricCurrency = (field: string, r: RecordRow): string => {
    // Unificado de moeda: a moeda segue o membro da fonte do registro.
    const ref = resolveRef(field, r) ?? field;
    if (ref.startsWith("custom:")) {
      const f = fieldByKey.get(ref.slice(7));
      return f
        ? resolveFieldMoneyFromRecord(f, r).code
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
        const src = toSourceKey(g.dv[di].key);
        g.dv[di] = { ...g.dv[di], label: SOURCE_LABELS[src] ?? g.dv[di].label };
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

  // Métricas calculadas de agregados: basis (somas/contagens) computada dos
  // registros do grupo e fórmula avaliada por grupo. A função de agregação do
  // "Agrupar período" (fn) NÃO se aplica a elas — a fórmula manda; com
  // 'individual' o grupo é 1 registro (basis do próprio registro).
  const calcResolved = new Map<number, ResolvedCalcMetric>();
  config.metrics.forEach((m, mi) => {
    if (isCalcMetric(m, fieldByKey)) calcResolved.set(mi, resolveCalcMetric(m, fieldByKey));
  });
  const calcBasisKeys = [
    ...new Set(
      [...calcResolved.values()].flatMap((rc) =>
        rc.formula ? basisKeysFor(rc.formula) : []
      )
    ),
  ];
  const calcMeta = (rc: ResolvedCalcMetric): CalcMoneyMeta =>
    calcMoneyMeta(rc, rates, conversionPeriod);
  const basisFromRecords = (rs: RecordRow[]): BasisValues => {
    const out: BasisValues = {};
    for (const key of calcBasisKeys) {
      // Chave condicional (SOMASE/CONT.SE/MÉDIASE): restringe os registros do
      // grupo às condições e reusa a mesma lógica de contagem/soma/moeda.
      const cond = parseCondBasisKey(key);
      const recs = cond
        ? rs.filter((r) => recordMatchesConds((ref) => rawValue(ref, r), cond.conds))
        : rs;
      const bm = cond ? cond.metric : basisMetric(key);
      if (bm.agg === "count") {
        out[key] =
          bm.field === "*"
            ? recs.length
            : recs.filter((r) => rawValue(bm.field, r) != null).length;
      } else if (isMoneyOperandField(bm.field, fieldByKey)) {
        // Operando monetário: detalhamento por moeda (+ convertido pela taxa do
        // período de cada registro, granularidade anual) p/ o evalCalcMoney
        // preservar a moeda única ou operar em Real quando misturar.
        out[key] = buildRecordBreakdown(
          recs,
          (r) => rawValue(bm.field, r),
          (r) => metricCurrency(bm.field, r),
          (r) => ({
            year: yearQuarterOf(
              r.closed_at ?? r.opened_at ?? r.source_created_at
            ).year,
            quarter: 0,
          }),
          rates
        );
      } else {
        const nums = recs
          .map((r) => Number(rawValue(bm.field, r)))
          .filter((n) => Number.isFinite(n));
        out[key] = nums.length ? nums.reduce((s, n) => s + n, 0) : null;
      }
    }
    return out;
  };

  const rows: WidgetRow[] = groupList.map((g) => {
    const row: WidgetRow = {};
    dims.forEach((d, di) => {
      row[`dim_${di + 1}`] = g.dv[di].label;
    });
    const basis = calcResolved.size > 0 ? basisFromRecords(g.records) : null;
    if (basis) row.__calcOps = basis;
    const money: Record<string, MoneyBreakdown> = {};
    config.metrics.forEach((m, mi) => {
      const rc = calcResolved.get(mi);
      if (rc) {
        row[`metric_${mi + 1}`] =
          rc.formula && basis
            ? evalCalcMoney(rc.formula, basis, calcMeta(rc)).value
            : null;
        return;
      }
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
  const metrics = config.metrics.map((m, i) => {
    const rc = calcResolved.get(i);
    if (rc) {
      const meta = calcMeta(rc);
      return {
        key: `metric_${i + 1}`,
        label:
          m.label?.trim() ||
          (m.field.startsWith("custom:")
            ? fieldLabel(m.field, available)
            : "Fórmula"),
        percent: rc.percent,
        calc: {
          formula: rc.formula ?? { tokens: [] },
          currency: rc.code,
          allowNegative: rc.allowNegative,
          mode: meta.mode,
          fixedRate: meta.fixedRate,
        },
      };
    }
    return {
      key: `metric_${i + 1}`,
      label:
        m.label?.trim() ||
        (fn === "individual"
          ? fieldLabel(m.field, available)
          : `${DATE_AGG_LABELS[fn]} · ${fieldLabel(m.field, available)}`),
      isMoney: isMoney(m.field),
      // Percentual: sum/avg/median/mode/individual de campo percentual exibem
      // ×100 + "%"; contagem nunca (contagem é contagem).
      percent:
        fn !== "count" &&
        m.field !== "*" &&
        isPercentFieldRef(m.field, fieldByKey),
    };
  });

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
  // Segmentação por fonte ANTES do @period/sourceFilters: os filtros
  // sintéticos e o record_type in (...) implícito nunca ganham alvo.
  let filters = applyFilterSourceTargets(
    resolveFilters(config.filters ?? []),
    config.sources
  );
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

  // Métricas calculadas de agregados (14/07/2026): NUNCA vão ao RPC — vão seus
  // OPERANDOS (basis de somas/contagens; ver lib/widgets/calc-metrics.ts). O RPC
  // recebe as métricas normais + as basis que ainda não estejam pedidas (dedup),
  // e cada linha é remapeada de volta para a ordem de config.metrics, com a
  // métrica calculada avaliada da basis do grupo (gravada em row.__calcOps para
  // os subtotais/Total geral reavaliarem no cliente). Sem métrica calculada,
  // rpcMetrics === config.metrics e nada muda.
  const calcResolved = new Map<number, ResolvedCalcMetric>();
  config.metrics.forEach((m, i) => {
    if (isCalcMetric(m, fieldByKey)) calcResolved.set(i, resolveCalcMetric(m, fieldByKey));
  });
  const rpcMetrics: Metric[] = [];
  const rpcIdxOfConfig = new Map<number, number>(); // idx config → idx rpc (normais)
  config.metrics.forEach((m, i) => {
    if (calcResolved.has(i)) return;
    rpcIdxOfConfig.set(i, rpcMetrics.length);
    rpcMetrics.push(m);
  });
  const rpcIdxOfBasis = new Map<string, number>(); // basis key → idx rpc
  // Chaves condicionais (SOMASE/CONT.SE/MÉDIASE): NUNCA entram na consulta
  // principal (o filtro da condição valeria para a consulta inteira) — cada
  // conjunto de condições vira uma consulta auxiliar própria, adiante.
  const condBasisKeys: BasisKey[] = [];
  for (const rc of calcResolved.values()) {
    if (!rc.formula) continue;
    for (const key of basisKeysFor(rc.formula)) {
      if (isCondBasisKey(key)) {
        if (!condBasisKeys.includes(key)) condBasisKeys.push(key);
        continue;
      }
      if (rpcIdxOfBasis.has(key)) continue;
      const bm = basisMetric(key);
      // Reusa uma métrica normal idêntica (mesma coluna do RPC) quando houver.
      const existing = rpcMetrics.findIndex(
        (m) => m.field === bm.field && m.agg === bm.agg && !m.formula
      );
      if (existing >= 0) {
        rpcIdxOfBasis.set(key, existing);
      } else {
        rpcIdxOfBasis.set(key, rpcMetrics.length);
        rpcMetrics.push(bm);
      }
    }
  }
  // Toda métrica é calculada e sem operando (ex.: campo deletado): o RPC não
  // aceita SELECT vazio — pede uma contagem descartada só p/ a consulta valer.
  if (calcResolved.size > 0 && rpcMetrics.length === 0 && dims.length === 0) {
    rpcMetrics.push({ field: "*", agg: "count" });
  }

  const { data, error } = await supabase.rpc("run_widget_query", {
    p_source: config.source,
    p_dimensions: dims,
    p_metrics: rpcMetrics,
    p_filters: filters,
    p_correspondences: correspondencesMap,
  });
  if (error) throw new Error(error.message);

  const rows = (Array.isArray(data) ? data : []) as WidgetRow[];

  // Chaves condicionais: uma consulta auxiliar por conjunto DISTINTO de
  // condições (mesmas dims; filtros da condição anexados aos do widget),
  // casada por tupla de dims como a consulta de moeda. Falha da auxiliar
  // degrada a chave para null (operando ausente → "—"), nunca para o número
  // sem condição (que seria um valor errado).
  const condValueByKey = new Map<BasisKey, Record<string, number | null>>();
  if (condBasisKeys.length > 0) {
    const condGroups = new Map<
      string,
      { filters: WidgetFilter[]; keys: BasisKey[] }
    >();
    for (const key of condBasisKeys) {
      const parsed = parseCondBasisKey(key);
      if (!parsed) continue;
      const extra = condFilters(parsed.conds);
      const gk = JSON.stringify(extra);
      const g = condGroups.get(gk) ?? { filters: extra, keys: [] };
      g.keys.push(key);
      condGroups.set(gk, g);
    }
    await Promise.all(
      [...condGroups.values()].map(async (g) => {
        try {
          const { data: condData, error: condError } = await supabase.rpc(
            "run_widget_query",
            {
              p_source: config.source,
              p_dimensions: dims,
              p_metrics: g.keys.map(basisMetric),
              p_filters: [...filters, ...g.filters],
              p_correspondences: correspondencesMap,
            }
          );
          if (condError) throw new Error(condError.message);
          const condRows = (Array.isArray(condData) ? condData : []) as WidgetRow[];
          for (const key of g.keys) condValueByKey.set(key, {});
          for (const r of condRows) {
            const tuple: unknown[] = [];
            for (let i = 1; i <= dims.length; i++) tuple.push(r[`dim_${i}`] ?? null);
            const tk = JSON.stringify(tuple);
            g.keys.forEach((key, ki) => {
              const v = r[`metric_${ki + 1}`];
              const n = Number(v);
              condValueByKey.get(key)![tk] =
                v == null || !Number.isFinite(n) ? null : n;
            });
          }
        } catch {
          for (const key of g.keys) condValueByKey.delete(key);
        }
      })
    );
  }

  // Consulta auxiliar por moeda + data-da-taxa (uma só): cobre as métricas
  // monetárias normais (`__money`) E os operandos monetários das métricas
  // calculadas (basis como MoneyBreakdown — preserva a moeda única do recorte
  // ou opera nos valores convertidos p/ Real quando misturar).
  // min/max ficam fora: o breakdown por moeda assume agregação linear (somar
  // parcelas por moeda) — min/max monetário exibe o agregado cru do RPC.
  const moneyEntries = config.metrics
    .map((m, i) => ({ m, i }))
    .filter(
      ({ m }) =>
        isMoneyMetric(m, available) && m.agg !== "min" && m.agg !== "max"
    );
  // Chaves condicionais ficam de fora: a consulta de moeda não aplica os
  // filtros da condição (o detalhamento sairia sem condição — valor errado);
  // o operando condicional segue numérico (soma crua, degradação v1).
  const basisMoneyKeys = [
    ...new Set(
      [...calcResolved.values()].flatMap((rc) =>
        rc.formula && rc.mode !== "none"
          ? basisKeysFor(rc.formula).filter(
              (key) =>
                !isCondBasisKey(key) &&
                basisMetric(key).agg === "sum" &&
                isMoneyOperandField(basisMetric(key).field, fieldByKey)
            )
          : []
      )
    ),
  ];
  const metricInfos: MoneyInfo[] = moneyEntries.map(({ m }) => ({
    metric: m,
    ...moneyCurrencyInfo(m.field, fieldByKey),
  }));
  const basisInfos: MoneyInfo[] = basisMoneyKeys.map((key) => {
    const bm = basisMetric(key);
    return { metric: bm, ...moneyCurrencyInfo(bm.field, fieldByKey) };
  });
  // Degrada com elegância se a consulta auxiliar falhar (ex.: migração 0039
  // ainda não aplicada): sem `__money`, os charts caem no número puro; a basis
  // calculada fica numérica (soma crua, comportamento v1).
  let bdMap: Record<string, MoneyBreakdown[]> = {};
  if (metricInfos.length + basisInfos.length > 0 && rows.length > 0) {
    try {
      bdMap = await buildMoneyBreakdowns(
        supabase,
        dims,
        filters,
        correspondencesMap,
        [...metricInfos, ...basisInfos],
        rates,
        conversionPeriod,
        today
      );
    } catch {
      bdMap = {};
    }
  }
  const hasBd = Object.keys(bdMap).length > 0;

  // Remapeia metric_<n> do RPC para a ordem de config.metrics e avalia as
  // métricas calculadas — ANTES de attachMoney/rotulagem, que mutam os dim_*
  // usados como chave de grupo.
  if (calcResolved.size > 0) {
    for (const row of rows) {
      const src: Record<string, unknown> = {};
      rpcMetrics.forEach((_, ri) => {
        src[`metric_${ri + 1}`] = row[`metric_${ri + 1}`];
      });
      // Chave do grupo desta linha na consulta auxiliar (dims cruas do RPC).
      const tuple: unknown[] = [];
      for (let i = 1; i <= dims.length; i++) tuple.push(row[`dim_${i}`] ?? null);
      const bdArr = hasBd ? bdMap[JSON.stringify(tuple)] : undefined;
      const basis: BasisValues = {};
      for (const [key, ri] of rpcIdxOfBasis) {
        const n = Number(src[`metric_${ri + 1}`]);
        basis[key] =
          src[`metric_${ri + 1}`] == null || !Number.isFinite(n) ? null : n;
      }
      // Sobrepõe os operandos monetários com o detalhamento por moeda do grupo
      // (quando a aux respondeu); sem aux, ficam os números crus do RPC.
      basisMoneyKeys.forEach((key, k) => {
        const bd = bdArr?.[metricInfos.length + k];
        if (bd) basis[key] = bd;
      });
      // Valores condicionais do grupo (consulta auxiliar por condição). Grupo
      // ausente na auxiliar = nenhum registro casou → contagem 0, soma null.
      // Auxiliar indisponível → null (operando ausente).
      for (const key of condBasisKeys) {
        const byTuple = condValueByKey.get(key);
        if (!byTuple) {
          basis[key] = null;
          continue;
        }
        const tk = JSON.stringify(tuple);
        if (tk in byTuple) {
          basis[key] = byTuple[tk];
        } else {
          basis[key] =
            parseCondBasisKey(key)?.metric.agg === "count" ? 0 : null;
        }
      }
      config.metrics.forEach((_, i) => {
        const rc = calcResolved.get(i);
        if (rc) {
          row[`metric_${i + 1}`] = rc.formula
            ? evalCalcMoney(
                rc.formula,
                basis,
                calcMoneyMeta(rc, rates, conversionPeriod)
              ).value
            : null;
        } else {
          row[`metric_${i + 1}`] = src[`metric_${rpcIdxOfConfig.get(i)! + 1}`];
        }
      });
      for (let k = config.metrics.length; k < rpcMetrics.length; k++) {
        delete row[`metric_${k + 1}`];
      }
      row.__calcOps = basis;
    }
  }

  // Métricas monetárias: anexa `__money` a cada linha (ANTES da rotulagem, que
  // muta os dim_* usados como chave de grupo). Charts plotam `metric_<n>`
  // numérico. bdMap vazio = degradação (aux falhou): não anexa __money nem
  // sobrescreve os valores, deixando o número cru do RPC — melhor que zerar.
  if (moneyEntries.length > 0 && rows.length > 0 && hasBd) {
    attachMoney(rows, dims, moneyEntries, bdMap);
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
          const src = toSourceKey(String(v));
          r[key] = SOURCE_LABELS[src] ?? String(v);
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

  const metrics = config.metrics.map((m, i) => {
    const rc = calcResolved.get(i);
    if (rc) {
      const meta = calcMoneyMeta(rc, rates, conversionPeriod);
      return {
        key: `metric_${i + 1}`,
        label:
          m.label?.trim() ||
          (m.field.startsWith("custom:")
            ? fieldLabel(m.field, available)
            : "Fórmula"),
        percent: rc.percent,
        calc: {
          formula: rc.formula ?? { tokens: [] },
          currency: rc.code,
          allowNegative: rc.allowNegative,
          mode: meta.mode,
          fixedRate: meta.fixedRate,
        },
      };
    }
    return {
      key: `metric_${i + 1}`,
      label: m.label?.trim() || `${AGG_LABELS[m.agg]} · ${fieldLabel(m.field, available)}`,
      isMoney: isMoneyMetric(m, available),
      // Percentual: soma/média de campo percentual exibem ×100 + "%"; contagem
      // nunca (contagem é contagem).
      percent:
        m.agg !== "count" &&
        m.field !== "*" &&
        isPercentFieldRef(m.field, fieldByKey),
    };
  });

  return { rows, dimensions, metrics };
}
