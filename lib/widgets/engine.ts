// Versão: 1.4 | Data: 18/07/2026
// v1.4 (18/07/2026): fontes por MÉTRICA (Metric.sources) — métricas com fontes
//   próprias viram "pernas": chamadas RPC separadas com o pipeline de filtros
//   (segmentação + @period + record_type in) reconstruído para AQUELAS fontes,
//   mescladas às linhas da principal por tupla de dims. A basis das calculadas
//   de perna vai em row.__calcOpsBy (por métrica), nunca em __calcOps. O RPC
//   run_widget_query fica INTOCADO (fonte é só filtro record_type). Ver
//   lib/widgets/metric-sources.ts.
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
  type ComparisonSettings,
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
import { partitionMetricLegs } from "./metric-sources";
import {
  alignComparisonRows,
  collapseMedianRows,
  comparisonLabel,
  comparisonSpec,
  isChronoDim,
  uniquePeriodField,
  type ComparisonSpec,
} from "./comparison";
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
import {
  correspondenceMapForSources,
  unifiedMemberRef,
  type Correspondence,
} from "@/lib/correspondences";
import { resolveGoal } from "@/lib/metas/resolve";
import {
  BUILTIN_SOURCES,
  isSubSource,
  planSourceLegs,
  recordTypeOf,
  rootSources,
  SOURCE_LABELS,
  sourceLabel,
  sourcePredicate,
  toRecordType,
  toSourceKey,
  type SourceDef,
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
// SUB-FONTES (0077): ciente do catálogo — subs resolvem para o record_type da
// PAI (recordTypeOf) e injetam o PREDICADO da sub (sourcePredicate), scoped ao
// record_type da pai via `record_types` (pass-through no RPC). Assim uma consulta
// com a sub como fonte efetiva de um record_type restringe só as linhas dela.
export function sourceFilters(
  sources?: SourceKey[],
  catalog: SourceDef[] = BUILTIN_SOURCES
): WidgetFilter[] {
  if (!sources || sources.length === 0) return [];
  const set = new Set(sources);
  const rts = [...new Set(sources.map((s) => recordTypeOf(s, catalog)))];
  const out: WidgetFilter[] = [{ field: "record_type", op: "in", value: rts }];
  for (const s of sources) {
    const def = catalog.find((c) => c.key === s);
    if (!def?.parentKey) continue;
    // ABSORVIDA: se a PAI também está na lista, ela cobre as linhas da sub — não
    // aplica o predicado (senão restringiria as linhas da pai indevidamente).
    if (set.has(def.parentKey)) continue;
    const pred = sourcePredicate(s, catalog);
    const rt = recordTypeOf(s, catalog);
    for (const f of pred) {
      // Descarta targeting antigo do predicado; scope pelo record_type da pai.
      const { sources: _s, record_types: _rt, ...rest } = f;
      out.push({ ...rest, record_types: [rt] });
    }
  }
  return out;
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
    // Merge (não substituição): as pernas por fonte (Metric.sources) chamam
    // attachMoney de novo com as métricas delas — chaves disjuntas por chamada.
    row.__money = { ...row.__money, ...money };
  }
  for (const { m, i } of moneyEntries) {
    const metricKey = `metric_${i + 1}`;
    const foreign = seriesForeignCode(rows, metricKey, m.currencyDisplay ?? "original");
    for (const row of rows) {
      row[metricKey] = plotAmount(row.__money![metricKey], m.agg, foreign);
    }
  }
}

// Decisão de moeda de plotagem de uma SÉRIE (metricKey): mantém a moeda
// estrangeira quando toda a série tem uma única moeda estrangeira e a exibição
// é "original"; senão converte p/ R$. Compartilhada entre attachMoney e a
// reescrita dos valores de comparação (os dois lados na MESMA escala).
function seriesForeignCode(
  rows: WidgetRow[],
  metricKey: string,
  disp: string
): string | null {
  let single = true;
  let code: string | null = null;
  for (const row of rows) {
    const bd = row.__money?.[metricKey];
    if (!bd) continue;
    const codes = Object.keys(bd.perCurrency);
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
  return single && code != null && code !== "BRL" && disp === "original"
    ? code
    : null;
}

// Exportado p/ o Card modo "record" (lib/widgets/card.ts) resolver o rótulo do
// campo FK exibido com a mesma semântica das dimensões.
export async function fetchFkLabels(
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
  period?: DashboardPeriod | null,
  // Comparação com período anterior (só o modo razão usa; meta não compara —
  // a meta já é a referência do card).
  cmp?: {
    spec: ComparisonSpec;
    settings: ComparisonSettings;
    filters: WidgetFilter[];
  } | null
): Promise<WidgetData> {
  const s = config.settings ?? {};
  const empty = { rows: [], dimensions: [], metrics: [] };
  // Casas decimais do widget (aparência) — aplicadas aos textos do servidor.
  const decimals = s.appearance?.decimals;

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
  // `f` permite reusar com os filtros do período de comparação.
  const moneyBreakdown = async (
    m: Metric,
    f: WidgetFilter[] = filters
  ): Promise<MoneyBreakdown | null> => {
    const infos: MoneyInfo[] = [
      { metric: m, ...moneyCurrencyInfo(m.field, fieldByKey) },
    ];
    // Degrada com elegância se a aux falhar (migração 0039 ausente): null =
    // cai no número cru do aggregate.
    try {
      const map = await buildMoneyBreakdowns(
        supabase,
        [],
        f,
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
    // Comparação: a MESMA razão sob os filtros do período de comparação. Razão
    // é intensiva — nas bases de janela compara a razão da janela inteira (sem
    // dividir por buckets; mediana degrada p/ o agregado da janela).
    let cmpValue: number | null | undefined;
    if (cmp) {
      try {
        const [cn0, cd0] = await aggregate(
          supabase,
          [num, den],
          cmp.filters,
          correspondencesMap
        );
        let cn = cn0;
        let cd = cd0;
        if (numMoney) {
          const bd = await moneyBreakdown(num, cmp.filters);
          if (bd) cn = num.agg === "avg" && bd.count > 0 ? bd.brl / bd.count : bd.brl;
        }
        if (denMoney) {
          const bd = await moneyBreakdown(den, cmp.filters);
          if (bd) cd = den.agg === "avg" && bd.count > 0 ? bd.brl / bd.count : bd.brl;
        }
        cmpValue = cd ? cn / cd : null;
      } catch {
        cmpValue = undefined; // degrada sem variação
      }
    }
    return {
      ...empty,
      ...(cmp && cmpValue !== undefined
        ? {
            comparison: {
              base: cmp.spec.base,
              from: cmp.spec.from,
              to: cmp.spec.to,
              label: comparisonLabel(cmp.settings, cmp.spec),
              settings: cmp.settings,
            },
          }
        : {}),
      kpi: {
        mode: "ratio",
        label: s.label ?? "Razão",
        value,
        ...(cmpValue !== undefined ? { cmpValue } : {}),
        // A razão de um numerador monetário é uma cifra em R$ (ex.: ticket médio).
        // `percent` (não-monetário): razão exibida ×100 + "%" (0.35 → "35%").
        ...(numConverted && value != null
          ? { valueText: formatMoney(value, "BRL", decimals) }
          : s.percent && value != null
            ? { valueText: formatPercent(value, true, decimals) }
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
    realizadoText = formatMoneyAggregate(
      metaBd,
      kpiCfg(metaMetric.agg),
      false,
      decimals
    );
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
            metaText:
              meta != null ? formatMoney(meta, "BRL", decimals) : undefined,
            faltaText:
              meta != null
                ? formatMoney(meta - realizado, "BRL", decimals)
                : undefined,
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

  // Fontes por métrica (18/07/2026): pernas (Metric.sources) compõem a basis
  // com registros das fontes DELAS. O fetch de EXIBIÇÃO (linhas/grupos) segue
  // as fontes do widget e, na regra dos mocks, inspeciona só as métricas da
  // consulta principal (paridade com o caminho RPC); o fetch EXTRA cobre as
  // fontes que faltam e inspeciona as métricas das pernas — mocks entram na
  // basis sem virar linha. Fontes de perna já cobertas pelo widget reusam os
  // registros de exibição (filtrados por record_type no escopo, adiante) —
  // nesse recorte a regra dos mocks é a da consulta principal (limitação
  // documentada; o fetch extra é que carrega os mocks da perna).
  const { defaultIdx, legs } = partitionMetricLegs(
    config.metrics,
    config.sources
  );
  const legByIdx = new Map<number, { sources: SourceKey[]; idx: number[] }>();
  for (const l of legs) for (const i of l.idx) legByIdx.set(i, l);
  const extraSources =
    config.sources && config.sources.length > 0
      ? [...new Set(legs.flatMap((l) => l.sources))].filter(
          (s) => !config.sources!.includes(s)
        )
      : [];
  // Falha do fetch extra degrada as métricas de perna p/ null ("—") — nunca
  // derruba o widget (mesma postura das pernas do caminho RPC).
  let extraOk = true;
  const [records, extraRecords] = await Promise.all([
    runRecordList(
      supabase,
      legs.length > 0
        ? { ...config, metrics: defaultIdx.map((i) => config.metrics[i]) }
        : config,
      period,
      available
    ) as Promise<RecordRow[]>,
    extraSources.length > 0
      ? (runRecordList(
          supabase,
          {
            ...config,
            sources: extraSources,
            metrics: legs.flatMap((l) => l.idx.map((i) => config.metrics[i])),
            settings: { ...config.settings, limit: undefined },
          },
          period,
          available
        ) as Promise<RecordRow[]>).catch(() => {
          extraOk = false;
          return [] as RecordRow[];
        })
      : Promise.resolve([] as RecordRow[]),
  ]);

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
  // Chave de grupo: tupla das dimensões unida por U+0001 (separador que não
  // colide com valores reais) — compartilhada com a atribuição dos extras.
  const groupKeyOf = (dvs: DV[]): string =>
    dvs.map((x) => x.key).join("");
  const groups = new Map<
    string,
    { key: string; dv: DV[]; records: RecordRow[] }
  >();
  for (const r of records) {
    const dvs = dims.map((d) => dimValue(d, r));
    const gkey = fn === "individual" ? r.id : groupKeyOf(dvs);
    let g = groups.get(gkey);
    if (!g) {
      g = { key: gkey, dv: dvs, records: [] };
      groups.set(gkey, g);
    }
    g.records.push(r);
  }

  // Extras (fontes das pernas) atribuídos aos grupos pela MESMA chave de
  // tupla; grupos que só existiriam nos extras NÃO viram linha (universo de
  // linhas = fontes do widget). No modo "individual" não há como casar (grupo
  // = 1 registro): o escopo da perna é o próprio registro, filtrado por fonte.
  const extrasByGroup = new Map<string, RecordRow[]>();
  if (fn !== "individual") {
    for (const r of extraRecords) {
      const gkey = groupKeyOf(dims.map((d) => dimValue(d, r)));
      if (!groups.has(gkey)) continue;
      const list = extrasByGroup.get(gkey) ?? [];
      list.push(r);
      extrasByGroup.set(gkey, list);
    }
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
    // Escopo de uma PERNA neste grupo: registros do grupo + extras do grupo,
    // filtrados pelas fontes da métrica (no "individual", só o próprio
    // registro — extras não casam com grupo de 1 registro).
    const legScope = (leg: { sources: SourceKey[] }): RecordRow[] => {
      const rts = new Set(leg.sources.map((s) => toRecordType(s)));
      const extras =
        fn === "individual" ? [] : (extrasByGroup.get(g.key) ?? []);
      return [...g.records, ...extras].filter((r) => rts.has(r.record_type));
    };
    const calcOpsBy: NonNullable<WidgetRow["__calcOpsBy"]> = {};
    config.metrics.forEach((m, mi) => {
      const rc = calcResolved.get(mi);
      const leg = legByIdx.get(mi);
      if (leg) {
        // Métrica de perna: escopo próprio; fetch extra indisponível → null.
        const scope = extraOk ? legScope(leg) : null;
        if (rc) {
          const legBasis = scope ? basisFromRecords(scope) : {};
          calcOpsBy[`metric_${mi + 1}`] = legBasis;
          row[`metric_${mi + 1}`] =
            rc.formula && scope
              ? evalCalcMoney(rc.formula, legBasis, calcMeta(rc)).value
              : null;
          return;
        }
        if (!scope || (fn === "individual" && scope.length === 0)) {
          row[`metric_${mi + 1}`] = null;
          return;
        }
        let legVal: number;
        if (fn === "individual") {
          if (m.field === "*") legVal = scope.length;
          else {
            const n = Number(rawValue(m.field, scope[0]));
            legVal = Number.isFinite(n) ? n : 0;
          }
        } else {
          legVal = aggMetricNum(m, scope);
        }
        row[`metric_${mi + 1}`] = legVal;
        if (m.field !== "*" && isMoney(m.field)) {
          money[`metric_${mi + 1}`] = buildRecordBreakdown(
            scope,
            (r) => rawValue(m.field, r),
            (r) => metricCurrency(m.field, r),
            (r) => recYQ(r, m),
            rates
          );
        }
        return;
      }
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
    if (Object.keys(calcOpsBy).length > 0) row.__calcOpsBy = calcOpsBy;
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
  correspondencesMapIn: Record<string, string[]> = {},
  fields: FieldDefinition[] = [],
  rates: CurrencyRates = {},
  conversionPeriod: ConversionYQ = yearQuarterOf(null),
  // SUB-FONTES (0077): catálogo + correspondências CRUAS para resolver a fonte
  // efetiva por record_type (perna). Sem sub-fonte selecionada, o comportamento
  // é byte a byte o de antes (usa `correspondencesMapIn` global).
  catalog: SourceDef[] = BUILTIN_SOURCES,
  correspondences: Correspondence[] = []
): Promise<WidgetData> {
  const coexist = config.settings?.coexistSubSources;
  // Só ativa o caminho de sub-fontes quando de fato há uma sub selecionada
  // (nas fontes do widget ou nas fontes de uma métrica) — mantém widgets sem
  // sub-fontes idênticos ao legado.
  const involvesSub =
    catalog.some((s) => s.parentKey) &&
    ((config.sources ?? []).some((s) => isSubSource(s, catalog)) ||
      (config.metrics ?? []).some((m) =>
        (m.sources ?? []).some((s) => isSubSource(s, catalog))
      ));
  const mainPlan = planSourceLegs(config.sources, coexist, catalog);
  // Fontes efetivas da consulta PRINCIPAL (uma por record_type; subs absorvidas
  // somem, subs avulsas viram a fonte efetiva do seu record_type).
  const effMainSources = involvesSub
    ? mainPlan.allMain
      ? []
      : mainPlan.mainSources
    : config.sources;
  // Source-keys efetivas de uma perna (para montar o coalesce dos unificados).
  const effKeysOf = (srcs?: SourceKey[]): SourceKey[] => {
    const p = planSourceLegs(srcs, coexist, catalog);
    return p.allMain ? rootSources(catalog).map((s) => s.key) : p.mainSources;
  };
  const corrMapForKeys = (keys: SourceKey[]): Record<string, string[]> =>
    involvesSub
      ? correspondenceMapForSources(correspondences, keys)
      : correspondencesMapIn;
  // Mapa de correspondências da consulta PRINCIPAL (um ref por record_type, da
  // fonte efetiva) — sombreia o param p/ que todos os caminhos "default" o usem.
  const correspondencesMap = corrMapForKeys(effKeysOf(config.sources));

  // Segmentação por fonte ANTES do @period/sourceFilters: os filtros
  // sintéticos e o record_type in (...) implícito nunca ganham alvo.
  // O pipeline inteiro é reconstruível POR CONJUNTO DE FONTES (legFiltersFor):
  // métricas com fontes próprias (Metric.sources) rodam em pernas separadas e
  // precisam do @period byType das SUAS fontes — o RPC exclui record_types
  // fora do mapa, então reaproveitar os filtros do widget derrubaria as
  // fontes extras da métrica.
  const resolved = resolveFilters(config.filters ?? []);
  const legFiltersFor = (
    p: DashboardPeriod | null | undefined,
    srcs?: SourceKey[]
  ): WidgetFilter[] => {
    let f = applyFilterSourceTargets(resolved, srcs, catalog);
    if (p) f = applyPeriodToFilters(f, p, srcs, catalog);
    // Fonte(s) da perna viram um filtro record_type in (...) + predicado da sub.
    return [...sourceFilters(srcs, catalog), ...f];
  };
  const filters = legFiltersFor(period, effMainSources);

  const fieldByKey = new Map(fields.map((f) => [f.field_key, f]));
  const today = yearQuarterOf(null);

  // Comparação com período anterior (settings.comparison): resolve o range da
  // segunda consulta (lib/widgets/comparison.ts). Ela filtra pelo MESMO campo
  // de data do período atual (regra dos mocks 0052 preservada) e nasce dos
  // filtros do próprio widget — nunca de filtros de restrição externos.
  const cmpSettings = config.settings?.comparison;
  const cmpSpec = comparisonSpec(period, cmpSettings);
  // Parametrizado por fontes (mesmo pipeline da principal): a rodada de
  // comparação também reconstrói os filtros por perna.
  const cmpFiltersFor = (
    spec: ComparisonSpec,
    srcs?: SourceKey[]
  ): WidgetFilter[] =>
    legFiltersFor(
      {
        field: period!.field,
        from: spec.from,
        to: spec.to,
        fieldBySource: period?.fieldBySource,
      },
      srcs
    );

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
      period,
      cmpSpec && cmpSettings
        ? {
            spec: cmpSpec,
            settings: cmpSettings,
            filters: cmpFiltersFor(cmpSpec),
          }
        : null
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

  // SUB-FONTES conviver (0077): pernas EXTRAS (sub convivendo com a pai, ou 2+
  // subs da mesma pai) não cabem na consulta única — cada FONTE de linha vira
  // uma série própria (perna independente: filtro + data + membro próprios),
  // com a fonte como dimensão LÍDER. Evita a ambiguidade de agregar linhas de
  // datas/filtros diferentes no mesmo grupo (cada linha pertence a uma perna).
  // KPI/card/"Agrupar período" já retornaram acima (ficam no absorver).
  if (involvesSub && mainPlan.extraLegs.length > 0) {
    const rowSourceKeys = [...mainPlan.mainSources, ...mainPlan.extraLegs];
    const legData = await Promise.all(
      rowSourceKeys.map((key) =>
        runWidget(
          supabase,
          {
            ...config,
            sources: [key],
            splitBySource: false,
            settings: { ...config.settings, coexistSubSources: [] },
          },
          available,
          period,
          correspondencesMapIn,
          fields,
          rates,
          conversionPeriod,
          catalog,
          correspondences
        ).catch(
          () => ({ rows: [], dimensions: [], metrics: [] }) as WidgetData
        )
      )
    );
    const nDims = config.dimensions.length;
    const seriesRows: WidgetRow[] = [];
    rowSourceKeys.forEach((key, li) => {
      const label = sourceLabel(key, catalog);
      for (const r of legData[li].rows) {
        const nr: WidgetRow = { ...r };
        // Desloca dim_n → dim_{n+1} (do maior p/ o menor) e injeta a Fonte.
        for (let d = nDims; d >= 1; d--) nr[`dim_${d + 1}`] = r[`dim_${d}`];
        nr.dim_1 = label;
        seriesRows.push(nr);
      }
    });
    const base = legData.find((d) => d.metrics.length > 0) ?? legData[0];
    return {
      rows: seriesRows,
      dimensions: [
        { key: "dim_1", label: "Fonte" },
        ...(base?.dimensions ?? []).map((d, i) => ({
          key: `dim_${i + 2}`,
          label: d.label,
        })),
      ],
      metrics: base?.metrics ?? [],
      comparison: base?.comparison,
    };
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

  // Fontes por métrica (18/07/2026): particiona as métricas entre a consulta
  // PRINCIPAL (fontes do widget — define o universo de LINHAS) e as pernas
  // extras (uma por conjunto distinto de Metric.sources). Sem fontes próprias,
  // legs = [] e tudo abaixo se comporta byte a byte como antes.
  const { defaultIdx, legs } = partitionMetricLegs(
    config.metrics,
    config.sources
  );
  const defaultIdxSet = new Set(defaultIdx);

  // Uma rodada COMPLETA da consulta agregada (RPC principal + auxiliares de
  // condição/moeda + pernas por fonte + remapeamento e avaliação das métricas
  // calculadas) para um par dims/pipeline-de-filtros. A mesma rodada serve o
  // período atual e o de comparação — `dims` SOMBREIA o de fora de propósito;
  // `filtersOf` reconstrói os filtros para as fontes de cada perna.
  const computeRows = async (
    dims: Dimension[],
    filtersOf: (srcs?: SourceKey[]) => WidgetFilter[]
  ): Promise<WidgetRow[]> => {
    const filters = filtersOf(effMainSources);
    const rpcMetrics: Metric[] = [];
    const rpcIdxOfConfig = new Map<number, number>(); // idx config → idx rpc (normais)
    config.metrics.forEach((m, i) => {
      if (!defaultIdxSet.has(i) || calcResolved.has(i)) return;
      rpcIdxOfConfig.set(i, rpcMetrics.length);
      rpcMetrics.push(m);
    });
    const rpcIdxOfBasis = new Map<string, number>(); // basis key → idx rpc
    // Chaves condicionais (SOMASE/CONT.SE/MÉDIASE): NUNCA entram na consulta
    // principal (o filtro da condição valeria para a consulta inteira) — cada
    // conjunto de condições vira uma consulta auxiliar própria, adiante.
    const condBasisKeys: BasisKey[] = [];
    for (const [ci, rc] of calcResolved) {
      // Calculadas de perna resolvem a própria basis na perna (adiante).
      if (!defaultIdxSet.has(ci)) continue;
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
    // Toda métrica é calculada/de perna e sem operando na principal: o RPC não
    // aceita SELECT vazio — pede uma contagem descartada só p/ a consulta valer
    // (com pernas, a principal continua necessária: ela define as linhas).
    if (
      (calcResolved.size > 0 || legs.length > 0) &&
      rpcMetrics.length === 0 &&
      dims.length === 0
    ) {
      rpcMetrics.push({ field: "*", agg: "count" });
    }

    // As três pernas da consulta (RPC principal + auxiliares de condição +
    // auxiliar de moeda) dependem só de dims/filters/config — nunca do
    // resultado umas das outras —, então disparam JUNTAS e um único
    // Promise.all (adiante) as aguarda: o caminho crítico do widget vira
    // max(principal, condição, moeda) em vez da soma das três.
    const mainPromise = supabase.rpc("run_widget_query", {
      p_source: config.source,
      p_dimensions: dims,
      p_metrics: rpcMetrics,
      p_filters: filters,
      p_correspondences: correspondencesMap,
    });

    // Chaves condicionais: uma consulta auxiliar por conjunto DISTINTO de
    // condições (mesmas dims; filtros da condição anexados aos do widget),
    // casada por tupla de dims como a consulta de moeda. Falha da auxiliar
    // degrada a chave para null (operando ausente → "—"), nunca para o número
    // sem condição (que seria um valor errado).
    const condValueByKey = new Map<BasisKey, Record<string, number | null>>();
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
    const condPromise = Promise.all(
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

    // Consulta auxiliar por moeda + data-da-taxa (uma só): cobre as métricas
    // monetárias normais (`__money`) E os operandos monetários das métricas
    // calculadas (basis como MoneyBreakdown — preserva a moeda única do recorte
    // ou opera nos valores convertidos p/ Real quando misturar).
    // min/max ficam fora: o breakdown por moeda assume agregação linear (somar
    // parcelas por moeda) — min/max monetário exibe o agregado cru do RPC.
    const moneyEntries = config.metrics
      .map((m, i) => ({ m, i }))
      .filter(
        ({ m, i }) =>
          defaultIdxSet.has(i) &&
          isMoneyMetric(m, available) &&
          m.agg !== "min" &&
          m.agg !== "max"
      );
    // Chaves condicionais ficam de fora: a consulta de moeda não aplica os
    // filtros da condição (o detalhamento sairia sem condição — valor errado);
    // o operando condicional segue numérico (soma crua, degradação v1).
    const moneyBasisKeysOf = (idxFilter: (i: number) => boolean): BasisKey[] => [
      ...new Set(
        [...calcResolved]
          .filter(([i]) => idxFilter(i))
          .flatMap(([, rc]) =>
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
    const basisMoneyKeys = moneyBasisKeysOf((i) => defaultIdxSet.has(i));
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
    // calculada fica numérica (soma crua, comportamento v1). A aux dispara sem
    // esperar a principal (ainda não dá pra saber se haverá linhas; widget
    // monetário vazio gasta 1 RPC à toa — raro), mas o resultado só é USADO
    // quando a principal traz linhas, como na versão serial.
    const moneyPromise: Promise<Record<string, MoneyBreakdown[]>> =
      metricInfos.length + basisInfos.length > 0
        ? buildMoneyBreakdowns(
            supabase,
            dims,
            filters,
            correspondencesMap,
            [...metricInfos, ...basisInfos],
            rates,
            conversionPeriod,
            today
          ).catch(() => ({}))
        : Promise.resolve({});

    // ---- Pernas por fonte (Metric.sources, 18/07/2026) ---------------------
    // Cada conjunto distinto de fontes de métrica vira uma rodada própria
    // (RPC principal + auxiliares de condição e moeda) com os filtros
    // reconstruídos para AQUELAS fontes (filtersOf), casada às linhas da
    // principal por tupla de dims. Grupo ausente na perna: contagem → 0,
    // demais → null (precedente das auxiliares de condição). Falha da perna
    // degrada as métricas dela para null — nunca derruba o widget.
    interface LegRun {
      idx: number[];
      rpcIdxOfConfig: Map<number, number>; // idx config → idx rpc (normais)
      rpcIdxOfBasis: Map<string, number>; // basis key → idx rpc
      moneyEntries: { m: Metric; i: number }[];
      basisMoneyKeys: BasisKey[];
      rowByTuple: Map<string, Record<string, unknown>>;
      condValueByKey: Map<BasisKey, Record<string, number | null>>;
      bdMap: Record<string, MoneyBreakdown[]>;
      ok: boolean;
    }
    const runLeg = async (leg: {
      sources: SourceKey[];
      idx: number[];
    }): Promise<LegRun> => {
      const legFilters = filtersOf(leg.sources);
      // Correspondências da perna: um ref por record_type das fontes DELA (subs
      // resolvem o membro próprio). Sem sub, é o mapa global (corrMapForKeys).
      const legCorr = corrMapForKeys(effKeysOf(leg.sources));
      const legMetrics: Metric[] = [];
      const idxOfConfig = new Map<number, number>();
      for (const i of leg.idx) {
        if (calcResolved.has(i)) continue;
        idxOfConfig.set(i, legMetrics.length);
        legMetrics.push(config.metrics[i]);
      }
      const idxOfBasis = new Map<string, number>();
      const condKeys: BasisKey[] = [];
      for (const i of leg.idx) {
        const rc = calcResolved.get(i);
        if (!rc?.formula) continue;
        for (const key of basisKeysFor(rc.formula)) {
          if (isCondBasisKey(key)) {
            if (!condKeys.includes(key)) condKeys.push(key);
            continue;
          }
          if (idxOfBasis.has(key)) continue;
          const bm = basisMetric(key);
          const existing = legMetrics.findIndex(
            (m) => m.field === bm.field && m.agg === bm.agg && !m.formula
          );
          if (existing >= 0) {
            idxOfBasis.set(key, existing);
          } else {
            idxOfBasis.set(key, legMetrics.length);
            legMetrics.push(bm);
          }
        }
      }
      const legMoneyEntries = leg.idx
        .map((i) => ({ m: config.metrics[i], i }))
        .filter(
          ({ m, i }) =>
            !calcResolved.has(i) &&
            isMoneyMetric(m, available) &&
            m.agg !== "min" &&
            m.agg !== "max"
        );
      const out: LegRun = {
        idx: leg.idx,
        rpcIdxOfConfig: idxOfConfig,
        rpcIdxOfBasis: idxOfBasis,
        moneyEntries: legMoneyEntries,
        basisMoneyKeys: moneyBasisKeysOf((i) => leg.idx.includes(i)),
        rowByTuple: new Map(),
        condValueByKey: new Map(),
        bdMap: {},
        ok: false,
      };
      // Perna sem nada a consultar (só calculadas sem fórmula/operando):
      // valores saem null sem gastar RPC.
      if (legMetrics.length === 0 && condKeys.length === 0) {
        out.ok = true;
        return out;
      }
      // O builder do supabase é thenable (não Promise) — sem anotação; o ramo
      // vazio devolve o mesmo shape { data, error } p/ o destructuring.
      const legMainP =
        legMetrics.length > 0
          ? supabase.rpc("run_widget_query", {
              p_source: config.source,
              p_dimensions: dims,
              p_metrics: legMetrics,
              p_filters: legFilters,
              p_correspondences: legCorr,
            })
          : Promise.resolve({ data: [] as unknown, error: null });
      const condGroups = new Map<
        string,
        { filters: WidgetFilter[]; keys: BasisKey[] }
      >();
      for (const key of condKeys) {
        const parsed = parseCondBasisKey(key);
        if (!parsed) continue;
        const extra = condFilters(parsed.conds);
        const gk = JSON.stringify(extra);
        const g = condGroups.get(gk) ?? { filters: extra, keys: [] };
        g.keys.push(key);
        condGroups.set(gk, g);
      }
      const legCondP = Promise.all(
        [...condGroups.values()].map(async (g) => {
          try {
            const { data: condData, error: condError } = await supabase.rpc(
              "run_widget_query",
              {
                p_source: config.source,
                p_dimensions: dims,
                p_metrics: g.keys.map(basisMetric),
                p_filters: [...legFilters, ...g.filters],
                p_correspondences: legCorr,
              }
            );
            if (condError) throw new Error(condError.message);
            const condRows = (Array.isArray(condData)
              ? condData
              : []) as WidgetRow[];
            for (const key of g.keys) out.condValueByKey.set(key, {});
            for (const r of condRows) {
              const tuple: unknown[] = [];
              for (let i = 1; i <= dims.length; i++)
                tuple.push(r[`dim_${i}`] ?? null);
              const tk = JSON.stringify(tuple);
              g.keys.forEach((key, ki) => {
                const v = r[`metric_${ki + 1}`];
                const n = Number(v);
                out.condValueByKey.get(key)![tk] =
                  v == null || !Number.isFinite(n) ? null : n;
              });
            }
          } catch {
            for (const key of g.keys) out.condValueByKey.delete(key);
          }
        })
      );
      const legMetricInfos: MoneyInfo[] = legMoneyEntries.map(({ m }) => ({
        metric: m,
        ...moneyCurrencyInfo(m.field, fieldByKey),
      }));
      const legBasisInfos: MoneyInfo[] = out.basisMoneyKeys.map((key) => {
        const bm = basisMetric(key);
        return { metric: bm, ...moneyCurrencyInfo(bm.field, fieldByKey) };
      });
      const legMoneyP: Promise<Record<string, MoneyBreakdown[]>> =
        legMetricInfos.length + legBasisInfos.length > 0
          ? buildMoneyBreakdowns(
              supabase,
              dims,
              legFilters,
              legCorr,
              [...legMetricInfos, ...legBasisInfos],
              rates,
              conversionPeriod,
              today
            ).catch(() => ({}))
          : Promise.resolve({});
      try {
        const [{ data: legData, error: legError }, , legBd] = await Promise.all(
          [legMainP, legCondP, legMoneyP]
        );
        if (legError) throw new Error(legError.message);
        const legRows = (Array.isArray(legData)
          ? legData
          : []) as Record<string, unknown>[];
        for (const r of legRows) {
          const tuple: unknown[] = [];
          for (let i = 1; i <= dims.length; i++)
            tuple.push(r[`dim_${i}`] ?? null);
          out.rowByTuple.set(JSON.stringify(tuple), r);
        }
        out.bdMap = legBd;
        out.ok = true;
      } catch {
        // ok = false: métricas da perna degradam p/ null ("—").
      }
      return out;
    };
    const legsPromise = Promise.all(legs.map(runLeg));

    const [{ data, error }, , bdAll, legRuns] = await Promise.all([
      mainPromise,
      condPromise,
      moneyPromise,
      legsPromise,
    ]);
    if (error) throw new Error(error.message);

    const rows = (Array.isArray(data) ? data : []) as WidgetRow[];
    const bdMap = rows.length > 0 ? bdAll : {};
    const hasBd = Object.keys(bdMap).length > 0;

    // Remapeia metric_<n> do RPC para a ordem de config.metrics e avalia as
    // métricas calculadas — ANTES de attachMoney/rotulagem, que mutam os dim_*
    // usados como chave de grupo. Com pernas, roda também sem calculadas (os
    // índices do RPC principal deixam de coincidir com config.metrics).
    if (calcResolved.size > 0 || legRuns.length > 0) {
      const legByIdx = new Map<number, LegRun>();
      for (const lr of legRuns) for (const i of lr.idx) legByIdx.set(i, lr);
      // Basis de uma calculada de PERNA p/ um grupo (tk): valores do grupo na
      // perna (ausente → contagem 0 / demais null), com os overrides de moeda
      // e das chaves condicionais DA PERNA. Perna falha → basis vazia (avalia
      // p/ null; subtotais idem — nunca cai na basis do universo do widget).
      const legBasisFor = (lr: LegRun, i: number, tk: string): BasisValues => {
        const rc = calcResolved.get(i)!;
        const legBasis: BasisValues = {};
        if (!lr.ok || !rc.formula) return legBasis;
        const legRow = lr.rowByTuple.get(tk);
        for (const key of basisKeysFor(rc.formula)) {
          if (isCondBasisKey(key)) {
            const byTuple = lr.condValueByKey.get(key);
            if (!byTuple) {
              legBasis[key] = null;
              continue;
            }
            legBasis[key] =
              tk in byTuple
                ? byTuple[tk]
                : parseCondBasisKey(key)?.metric.agg === "count"
                  ? 0
                  : null;
            continue;
          }
          const ri = lr.rpcIdxOfBasis.get(key);
          const v = ri != null ? legRow?.[`metric_${ri + 1}`] : undefined;
          const n = Number(v);
          legBasis[key] =
            v == null || !Number.isFinite(n)
              ? basisMetric(key).agg === "count"
                ? 0
                : null
              : n;
        }
        const legBdArr = lr.bdMap[tk];
        lr.basisMoneyKeys.forEach((key, k) => {
          const bd = legBdArr?.[lr.moneyEntries.length + k];
          if (bd) legBasis[key] = bd;
        });
        return legBasis;
      };
      for (const row of rows) {
        const src: Record<string, unknown> = {};
        rpcMetrics.forEach((_, ri) => {
          src[`metric_${ri + 1}`] = row[`metric_${ri + 1}`];
        });
        // Chave do grupo desta linha nas consultas auxiliares/pernas (dims
        // cruas do RPC).
        const tuple: unknown[] = [];
        for (let i = 1; i <= dims.length; i++) tuple.push(row[`dim_${i}`] ?? null);
        const tk = JSON.stringify(tuple);
        const bdArr = hasBd ? bdMap[tk] : undefined;
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
          if (tk in byTuple) {
            basis[key] = byTuple[tk];
          } else {
            basis[key] =
              parseCondBasisKey(key)?.metric.agg === "count" ? 0 : null;
          }
        }
        // Basis POR MÉTRICA das calculadas de perna (universo próprio) — os
        // renderizadores leem __calcOpsBy[key] ?? __calcOps.
        const calcOpsBy: NonNullable<WidgetRow["__calcOpsBy"]> = {};
        config.metrics.forEach((m, i) => {
          const rc = calcResolved.get(i);
          const lr = legByIdx.get(i);
          if (lr) {
            if (rc) {
              const legBasis = legBasisFor(lr, i, tk);
              calcOpsBy[`metric_${i + 1}`] = legBasis;
              row[`metric_${i + 1}`] = rc.formula
                ? evalCalcMoney(
                    rc.formula,
                    legBasis,
                    calcMoneyMeta(rc, rates, conversionPeriod)
                  ).value
                : null;
              return;
            }
            // Métrica normal de perna: valor do grupo na perna; grupo ausente
            // → contagem 0, demais null; perna falha → null.
            const ri = lr.rpcIdxOfConfig.get(i)!;
            const v = lr.ok
              ? lr.rowByTuple.get(tk)?.[`metric_${ri + 1}`]
              : undefined;
            row[`metric_${i + 1}`] =
              v != null ? v : lr.ok && m.agg === "count" ? 0 : null;
            return;
          }
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
        if (calcResolved.size > 0) row.__calcOps = basis;
        if (Object.keys(calcOpsBy).length > 0) row.__calcOpsBy = calcOpsBy;
      }
    }

    // Métricas monetárias: anexa `__money` a cada linha (ANTES da rotulagem, que
    // muta os dim_* usados como chave de grupo). Charts plotam `metric_<n>`
    // numérico. bdMap vazio = degradação (aux falhou): não anexa __money nem
    // sobrescreve os valores, deixando o número cru do RPC — melhor que zerar.
    if (moneyEntries.length > 0 && rows.length > 0 && hasBd) {
      attachMoney(rows, dims, moneyEntries, bdMap);
    }
    // Métricas monetárias de PERNA: mesmo attach, com o detalhamento da perna
    // (attachMoney faz merge em __money — chamadas múltiplas não se clobberam).
    for (const lr of legRuns) {
      if (!lr.ok || lr.moneyEntries.length === 0 || rows.length === 0) continue;
      if (Object.keys(lr.bdMap).length === 0) continue;
      attachMoney(rows, dims, lr.moneyEntries, lr.bdMap);
    }
    return rows;
  };

  // Rodada de comparação em paralelo com a principal. Qualquer falha aqui
  // degrada silenciosamente: o widget segue sem variação.
  const runComparison = async (): Promise<{
    cmpRows: WidgetRow[];
    sharedIdx: number[];
    bucketed: boolean;
    divide: boolean;
  } | null> => {
    if (!cmpSpec || !period) return null;
    try {
      const isWindow =
        cmpSpec.base === "window_avg" || cmpSpec.base === "window_median";
      // Janelas: dims cronológicas saem da consulta de comparação — cada
      // bucket do período atual compara contra a média/mediana por bucket da
      // janela inteira (por tupla das demais dims).
      const sharedIdx = dims
        .map((_, i) => i)
        .filter((i) => !isWindow || !isChronoDim(dims[i]));
      let cmpDims = sharedIdx.map((i) => dims[i]);
      let bucketed = false;
      let divide = cmpSpec.base === "window_avg";
      if (cmpSpec.base === "window_median" && cmpSpec.bucket) {
        // Mediana precisa de UMA coluna de data p/ bucketizar; fontes com
        // campos divergentes degradam p/ média (total ÷ nº de buckets).
        const bucketField = uniquePeriodField(period);
        if (bucketField) {
          cmpDims = [
            ...cmpDims,
            { field: bucketField, transform: cmpSpec.bucket },
          ];
          bucketed = true;
        } else {
          divide = true;
        }
      }
      const cmpRows = await computeRows(cmpDims, (srcs) =>
        cmpFiltersFor(cmpSpec, srcs)
      );
      return { cmpRows, sharedIdx, bucketed, divide };
    } catch {
      return null;
    }
  };

  const [rows, cmpRun] = await Promise.all([
    computeRows(dims, (srcs) => legFiltersFor(period, srcs)),
    runComparison(),
  ]);

  let comparisonMeta: WidgetData["comparison"] | undefined;
  if (cmpRun && cmpSpec && cmpSettings) {
    let { cmpRows } = cmpRun;
    // Moeda: reescreve o valor comparado com a MESMA decisão de moeda da série
    // principal (R$ vs. moeda estrangeira única) — comparação na mesma escala.
    // Sem __money (aux degradada), fica o número cru do RPC.
    const cmpMoneyEntries = config.metrics
      .map((m, i) => ({ m, i }))
      .filter(
        ({ m }) =>
          isMoneyMetric(m, available) && m.agg !== "min" && m.agg !== "max"
      );
    for (const { m, i } of cmpMoneyEntries) {
      const key = `metric_${i + 1}`;
      const foreign = seriesForeignCode(
        rows,
        key,
        m.currencyDisplay ?? "original"
      );
      for (const r of cmpRows) {
        const bd = r.__money?.[key];
        if (bd) r[key] = plotAmount(bd, m.agg, foreign);
      }
    }
    // Extensivas (soma/contagem não-calculadas) dividem pela janela e zeram
    // buckets vazios; intensivas (média/min/max/fórmula) comparam o agregado
    // da janela em si (dividir uma razão por N seria matemática errada).
    const isExtensive = config.metrics.map(
      (m, i) => !calcResolved.has(i) && (m.agg === "sum" || m.agg === "count")
    );
    if (cmpRun.bucketed) {
      cmpRows = collapseMedianRows(
        cmpRows,
        cmpRun.sharedIdx.length,
        config.metrics.length,
        cmpSpec.bucketCount ?? 1,
        isExtensive
      );
    } else if (cmpRun.divide && cmpSpec.bucketCount) {
      for (const r of cmpRows) {
        config.metrics.forEach((_, i) => {
          if (!isExtensive[i]) return;
          const key = `metric_${i + 1}`;
          const v = Number(r[key]);
          if (r[key] != null && Number.isFinite(v)) {
            r[key] = v / cmpSpec.bucketCount!;
          }
        });
      }
    }
    alignComparisonRows(
      rows,
      cmpRows,
      dims,
      cmpRun.sharedIdx,
      config.metrics.length
    );
    comparisonMeta = {
      base: cmpSpec.base,
      from: cmpSpec.from,
      to: cmpSpec.to,
      label: comparisonLabel(cmpSettings, cmpSpec),
      settings: cmpSettings,
    };
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
  // As dimensões FK acumulam suas buscas e um Promise.all as roda juntas
  // (antes: um await por dimensão, em série); os demais casos são só CPU.
  const fkDimLookups: { key: string; fetch: Promise<Record<string, string>> }[] =
    [];
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
    fkDimLookups.push({ key, fetch: fetchFkLabels(supabase, fk, ids) });
  }
  const fkLabelMaps = await Promise.all(fkDimLookups.map((l) => l.fetch));
  fkDimLookups.forEach(({ key }, li) => {
    const labels = fkLabelMaps[li];
    for (const r of rows) {
      const v = r[key];
      if (v != null) r[key] = labels[String(v)] ?? String(v);
    }
  });

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

  return {
    rows,
    dimensions,
    metrics,
    ...(comparisonMeta ? { comparison: comparisonMeta } : {}),
  };
}
