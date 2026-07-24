// Versão: 1.10 | Data: 24/07/2026
// v1.10 (24/07/2026): pernas de sub-base EXIBÍVEIS (§4.8) — no branch
// multi-perna: (a) operando escopado em fonte-IRMÃ é zerado por perna
// (zeroSiblingScopedOperands; cada perna mostra a própria contribuição) +
// backfill 0 na basis p/ o re-eval client-side com a fórmula ORIGINAL (que
// volta no meta das métricas); (b) settings.subSeriesMode: "total" funde as
// pernas por tupla (foldRowGroup; sem a dim "Base") — pizza/funil com dim e
// KPI/card fundem SEMPRE —, "stacked"/"grouped" carimbam WidgetData.subSeries
// p/ o chart pivotar; goalLine/businessDayRef agora propagam. RPCs intocados.
// v1.9 (23/07/2026): merge por bucket p/ dimensão `custom:` + transform
// (lib/widgets/bucket-merge.ts) — o ramo custom das RPCs agrupa pelo valor
// CRU (0085; transform é só rótulo), então valores com hora viravam um grupo
// por registro (barras/chips duplicados). computeRows agora funde as linhas
// pelo bucket no retorno (choke point único: principal/comparação/pernas do
// align/card/quick-table/snapshot), com a semântica do Total geral (sum/count
// somam; min/max reduzem; calc reavalia sobre foldBasis; monetárias fundem
// __money e replotam — exato incl. média; média SIMPLES não-monetária =
// média das médias, aproximação documentada). Dim fundida grava o valor
// CANÔNICO estilo-núcleo (conserta sort cronológico/comparação/goalLine).
// RPCs INTOCADAS. attachMoney ganhou o helper replotMoney (reusado pós-merge).
// v1.8 (21/07/2026): dia de Brasília (0085) — resolveFilters ancora bounds
// gt/gte/lt/lte de coluna de data do NÚCLEO com offset -03:00
// (anchorCoreDateBound; choke point do RPC e do modo lista); bdAlignCtx expõe
// refIso/reference e o resultado carrega WidgetData.businessDayRef (badge
// "Nº dia útil" — N de corte compartilhado entre os meses).
// v1.7 (20/07/2026): dia útil e metas nos gráficos — (a) businessDayAlign:
//   pernas por mês via computeRows com o range recortado no N-ésimo dia útil
//   (comparação ignorada com o align ativo); (b) base previous_period_bd (a
//   comparação recebe o contexto de feriados); (c) goalLine: série __goal por
//   bucket mensal via resolveGoal (modo pace usa dias úteis); (d) KPI modo
//   meta usa a métrica do próprio widget como realizado. Tudo no ENGINE —
//   RPCs intocados. Ver lib/date/business-days.ts e docs/arquitetura.md §4.9.
// v1.6 (20/07/2026): mapa de unificados SEMPRE por perna — runWidget perde o
//   param do mapa global e monta correspondenceMapForSources(correspondências,
//   fontes efetivas, catálogo) incondicionalmente. O gate involvesSub deixava o
//   mapa global (com o membro da sub) vazar p/ widget só-pai: o coalesce da pai
//   passava a ler a coluna da sub (mesmo record_type) e alterava cálculos.
// v1.5 (20/07/2026): "Agrupar período" — top-up de mocks das pernas COBERTAS
//   (runCoveredLegMockTopUp): a regra dos mocks da exibição não vê as métricas
//   das pernas e o fetch extra só cobre fontes que faltam; sem o top-up, mocks
//   de Data Reunião sumiam da basis de métrica com fontes dentro das do widget
//   (ex.: widget em "todas as fontes"). legScope resolve record_type ciente do
//   catálogo (recordTypeOf — sub-fonte apontava p/ chave inexistente e zerava).
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
import { isCoreDef } from "@/lib/records/core-defs";
import {
  AGG_LABELS,
  DATE_AGG_LABELS,
  TRANSFORM_LABELS,
  type ComparisonSettings,
  type DateAgg,
  type Dimension,
  type Metric,
  type PeriodWindowKey,
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
  siblingScopedBasisKeys,
  zeroSiblingScopedOperands,
  zeroSiblingScopesInFields,
  type BasisKey,
  type BasisValues,
  type CalcMoneyMeta,
  type ResolvedCalcMetric,
} from "./calc-metrics";
import { applyFilterSourceTargets } from "./filter-sources";
import { foldRowGroup, mergeRowsByBucket } from "./bucket-merge";
import { coveredLegSources, partitionMetricLegs } from "./metric-sources";
import {
  alignComparisonRows,
  collapseMedianRows,
  comparisonLabel,
  comparisonSpec,
  isChronoDim,
  uniquePeriodField,
  type ComparisonSpec,
} from "./comparison";
import {
  dedupeById,
  runCoveredLegMockTopUp,
  runRecordList,
} from "./record-list";
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
import {
  anchorCoreDateBound,
  applyPeriodToFilters,
  CORE_DATE_COLS,
  patchAuxPeriodByType,
  scopedAuxPeriod,
  type DashboardPeriod,
} from "./period";
import { DEFAULT_DATE_FORMAT, formatDateValue, formatPercent } from "./format";
import { todayBrasiliaIso } from "@/lib/date/today";
import {
  businessDayIndexInMonth,
  businessDaysInMonth,
  daysInMonth,
  nthBusinessDayOfMonth,
} from "@/lib/date/business-days";
import { loadNonWorkingDays } from "@/lib/config/non-working-days";
import { loadGoalMetrics } from "@/lib/config/goal-metrics";
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
  return filters.map((f) => {
    const value = Array.isArray(f.value)
      ? f.value.map(resolveToken)
      : resolveToken(f.value);
    // Intervalo em coluna de data do NÚCLEO (timestamptz): ancora o bound no
    // dia de Brasília (0085) — RPC e PostgREST compartilham este choke point.
    // eq/neq ficam de fora (igualdade de instante — degenerada, documentada).
    if (
      typeof value === "string" &&
      CORE_DATE_COLS.has(f.field) &&
      (f.op === "gt" || f.op === "gte" || f.op === "lt" || f.op === "lte")
    ) {
      // Date-only: só `lte` fecha no fim do dia ("até 31/07" inclui o dia);
      // `lt` exclui o dia inteiro e `gt`/`gte` abrem no início — mesma
      // semântica da comparação textual dos campos custom.
      const kind = f.op === "lte" ? "to" : "from";
      return { ...f, value: anchorCoreDateBound(value, kind) };
    }
    return { ...f, value };
  });
}

function metricForMeta(metric: string): Metric {
  if (metric === "clientes") return { field: "*", agg: "count" };
  return { field: metric, agg: "sum" };
}

// Filtro implícito das fontes selecionadas (record_type in ...). Vazio = todas.
// SUB-FONTES (0078): ciente do catálogo — subs resolvem para o record_type da
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
  replotMoney(rows, moneyEntries);
}

// Reescreve `metric_<n>` das métricas monetárias a partir do `__money` de cada
// linha (decisão de moeda POR SÉRIE). Extraído de attachMoney para rodar de
// novo após o merge por bucket (bucket-merge) — o breakdown fundido carrega
// count, então até a média sai exata.
function replotMoney(
  rows: WidgetRow[],
  moneyEntries: { m: Metric; i: number }[]
): void {
  for (const { m, i } of moneyEntries) {
    const metricKey = `metric_${i + 1}`;
    const foreign = seriesForeignCode(rows, metricKey, m.currencyDisplay ?? "original");
    for (const row of rows) {
      const bd = row.__money?.[metricKey];
      if (bd) row[metricKey] = plotAmount(bd, m.agg, foreign);
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

// Relações aceitas como condição de SOMASE/CONT.SE por NOME (19/07/2026):
// [Responsável] = "Paulo" — o literal digitado é o nome, mas a coluna guarda o
// UUID; resolveFkCondFilters troca o literal pelo id ANTES do RPC.
const FK_COND_TABLES: Record<string, { table: string; col: string }> = {
  responsible_id: { table: "responsibles", col: "display_name" },
  operation_id: { table: "operations", col: "name" },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// UUID sintático impossível: nome não encontrado → recorte vazio (contagem 0,
// mesma semântica de "= nome que não existe"); o erro amigável é do SAVE.
const FK_NO_MATCH = "00000000-0000-0000-0000-000000000000";

/**
 * Resolve literais de NOME nos filtros de condição sobre relações
 * (responsible_id/operation_id) para o UUID correspondente (case-insensitive +
 * trim — mesma normalização do eq_ci). Valor já em forma de UUID passa intacto;
 * sem filtro de relação, retorna a MESMA lista (fast path). Uma consulta por
 * tabela referenciada.
 */
export async function resolveFkCondFilters(
  supabase: SupabaseClient,
  filters: WidgetFilter[]
): Promise<WidgetFilter[]> {
  const needsFor = (field: string) =>
    filters.some(
      (f) =>
        f.field === field && typeof f.value === "string" && !UUID_RE.test(f.value)
    );
  if (!Object.keys(FK_COND_TABLES).some(needsFor)) return filters;
  const norm = (s: string) => s.trim().toLocaleLowerCase("pt-BR");
  const maps = new Map<string, Map<string, string>>();
  for (const [field, cfg] of Object.entries(FK_COND_TABLES)) {
    if (!needsFor(field)) continue;
    // Select literal por tabela (o parser de tipos do supabase-js não entende
    // coluna interpolada).
    const { data } =
      field === "responsible_id"
        ? await supabase.from("responsibles").select("id, display_name")
        : await supabase.from("operations").select("id, name");
    const m = new Map<string, string>();
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      const name = norm(String(r[cfg.col] ?? ""));
      if (name && !m.has(name)) m.set(name, String(r.id));
    }
    maps.set(field, m);
  }
  return filters.map((f) => {
    const m = maps.get(f.field);
    if (!m || typeof f.value !== "string" || UUID_RE.test(f.value)) return f;
    return { ...f, value: m.get(norm(f.value)) ?? FK_NO_MATCH };
  });
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
  // Realizado (20/07/2026): a métrica configurada no PRÓPRIO widget tem
  // precedência — com metas por métrica arbitrária ('sql', 'mql'…, registry de
  // lib/metas/metrics.ts) o realizado é o que a consulta do widget contar
  // (ex.: contagem sobre a sub-fonte SQLs). Sem métrica no widget, cai no
  // legado por chave ('clientes' = contagem; demais = soma do campo homônimo).
  // Presets antigos já traziam a métrica equivalente — resultado idêntico.
  const metaMetric = config.metrics[0] ?? metricForMeta(metric);
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
  conversionPeriod: ConversionYQ,
  // Catálogo de fontes p/ abaixar operandos com escopo (`agg:…@<fonte>`).
  catalog: SourceDef[] = BUILTIN_SOURCES
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
  // como a regra dos mocks da exibição não vê as métricas das pernas, o
  // TOP-UP (v1.5, runCoveredLegMockTopUp) busca só is_mock=true dessas fontes
  // e entra no MESMO stream de extras (sem virar linha; gates evitam duplicar
  // quando a própria exibição já serviu os mocks).
  const { defaultIdx, legs } = partitionMetricLegs(
    config.metrics,
    config.sources,
    fieldByKey
  );
  const legByIdx = new Map<number, { sources: SourceKey[]; idx: number[] }>();
  for (const l of legs) for (const i of l.idx) legByIdx.set(i, l);
  const extraSources =
    config.sources && config.sources.length > 0
      ? [...new Set(legs.flatMap((l) => l.sources))].filter(
          (s) => !config.sources!.includes(s)
        )
      : [];
  // No "individual" os extras não são usados (grupo = 1 registro) — sem top-up.
  const covered =
    fn === "individual" ? [] : coveredLegSources(legs, config.sources);
  const displayConfig =
    legs.length > 0
      ? { ...config, metrics: defaultIdx.map((i) => config.metrics[i]) }
      : config;
  const legMetrics = legs.flatMap((l) => l.idx.map((i) => config.metrics[i]));
  // Falha do fetch extra/top-up degrada as métricas de perna p/ null ("—") —
  // nunca derruba o widget (mesma postura das pernas do caminho RPC).
  let extraOk = true;
  const [records, extraFetched, topUp] = await Promise.all([
    runRecordList(supabase, displayConfig, period, available) as Promise<
      RecordRow[]
    >,
    extraSources.length > 0
      ? (runRecordList(
          supabase,
          {
            ...config,
            sources: extraSources,
            metrics: legMetrics,
            settings: { ...config.settings, limit: undefined },
          },
          period,
          available
        ) as Promise<RecordRow[]>).catch(() => {
          extraOk = false;
          return [] as RecordRow[];
        })
      : Promise.resolve([] as RecordRow[]),
    covered.length > 0
      ? runCoveredLegMockTopUp(
          supabase,
          displayConfig,
          {
            ...config,
            sources: covered,
            metrics: legMetrics,
            settings: { ...config.settings, limit: undefined },
          },
          period,
          available
        ).catch(() => {
          extraOk = false;
          return [] as RecordRow[];
        })
      : Promise.resolve([] as RecordRow[]),
  ]);
  const extraRecords = dedupeById(extraFetched, topUp);

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
    if (isCalcMetric(m, fieldByKey))
      calcResolved.set(mi, resolveCalcMetric(m, fieldByKey, catalog));
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
  // Condição sobre RELAÇÃO compara por NOME (19/07/2026): pré-carrega os
  // rótulos id→nome das relações referenciadas em condições e traduz na leitura.
  const condFkRefs = new Set<string>();
  for (const key of calcBasisKeys) {
    const cond = parseCondBasisKey(key);
    for (const c of cond?.conds ?? []) {
      if (c.ref === "responsible_id" || c.ref === "operation_id")
        condFkRefs.add(c.ref);
    }
  }
  const condFkLabels: Record<string, string> = {};
  for (const ref of condFkRefs) {
    const ids = Array.from(
      new Set(
        [...records, ...extraRecords]
          .map((r) => (r as unknown as Record<string, unknown>)[ref])
          .filter((v): v is string => typeof v === "string" && v !== "")
      )
    );
    Object.assign(
      condFkLabels,
      await fetchFkLabels(
        supabase,
        ref === "responsible_id" ? "responsible" : "operation",
        ids
      )
    );
  }
  const condRawValue = (ref: string, r: RecordRow): unknown => {
    const v = rawValue(ref, r);
    if (ref === "responsible_id" || ref === "operation_id") {
      return v == null ? null : (condFkLabels[String(v)] ?? v);
    }
    return v;
  };
  const basisFromRecords = (rs: RecordRow[]): BasisValues => {
    const out: BasisValues = {};
    for (const key of calcBasisKeys) {
      // Chave condicional (SOMASE/CONT.SE/MÉDIASE): restringe os registros do
      // grupo às condições e reusa a mesma lógica de contagem/soma/moeda.
      const cond = parseCondBasisKey(key);
      const recs = cond
        ? rs.filter((r) =>
            recordMatchesConds((ref) => condRawValue(ref, r), cond.conds)
          )
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
    // registro — extras não casam com grupo de 1 registro). recordTypeOf
    // ciente do catálogo: sub-fonte conta as linhas da PAI (paridade com
    // metricRts da tabela de registros).
    const legScope = (leg: { sources: SourceKey[] }): RecordRow[] => {
      const rts = new Set(leg.sources.map((s) => recordTypeOf(s, catalog)));
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
    const base = d.field === "record_type" ? "Base" : fieldLabel(d.field, available);
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
  fields: FieldDefinition[] = [],
  rates: CurrencyRates = {},
  conversionPeriod: ConversionYQ = yearQuarterOf(null),
  // SUB-FONTES (0078): catálogo + correspondências CRUAS para resolver a fonte
  // efetiva por record_type (perna) e montar o mapa de unificados POR PERNA
  // (correspondenceMapForSources) — o mapa global poluiria o coalesce da pai
  // com o membro da sub (mesmo record_type).
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
  // Mapa de unificados SEMPRE escopado às fontes efetivas da perna (v1.2): o
  // membro de uma sub NÃO entra no coalesce da pai só por existir na
  // correspondência — ele só entra quando a sub é a fonte efetiva da perna.
  // (Fallback perna→raízes→todos dentro do builder cobre correspondências sem
  // membro nas fontes da perna — o RPC ergueria erro p/ chave ausente.)
  const corrMapForKeys = (keys: SourceKey[]): Record<string, string[]> =>
    correspondenceMapForSources(correspondences, keys, catalog);
  // Mapa de correspondências da consulta PRINCIPAL (um ref por record_type, da
  // fonte efetiva) — todos os caminhos "default" o usam.
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

  // Linhas core (0086) fora: refs custom:<key> nunca apontam p/ coluna núcleo.
  const fieldByKey = new Map(
    fields.filter((f) => !isCoreDef(f)).map((f) => [f.field_key, f])
  );
  const today = yearQuarterOf(null);

  // Comparação com período anterior (settings.comparison): resolve o range da
  // segunda consulta (lib/widgets/comparison.ts). Ela filtra pelo MESMO campo
  // de data do período atual (regra dos mocks 0052 preservada) e nasce dos
  // filtros do próprio widget — nunca de filtros de restrição externos.
  const cmpSettings = config.settings?.comparison;
  let cmpSpec = comparisonSpec(period, cmpSettings);
  // Base "mesmo dia útil": recomputa o spec com o contexto de feriados (o
  // módulo de comparação segue puro). Falha ao carregar feriados degrada p/ o
  // range cheio de previous_period (spec já resolvido acima).
  if (cmpSpec?.base === "previous_period_bd") {
    try {
      cmpSpec = comparisonSpec(period, cmpSettings, {
        holidays: await loadNonWorkingDays(supabase),
        todayIso: todayBrasiliaIso(),
      });
    } catch {
      // mantém o spec degradado
    }
  }
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
      conversionPeriod,
      catalog
    );
  }

  // Métricas calculadas de agregados: resolvidas ANTES do branch multi-perna —
  // ele precisa da fórmula ORIGINAL (expandida+abaixada) p/ o meta das métricas,
  // o backfill de basis e o merge "total"; o caminho padrão (computeRows/
  // rpcMetrics abaixo) usa o MESMO mapa.
  const calcResolved = new Map<number, ResolvedCalcMetric>();
  config.metrics.forEach((m, i) => {
    if (isCalcMetric(m, fieldByKey))
      calcResolved.set(i, resolveCalcMetric(m, fieldByKey, catalog));
  });

  // SUB-FONTES conviver (0078): pernas EXTRAS (sub convivendo com a pai, ou 2+
  // subs da mesma pai) não cabem na consulta única — cada FONTE de linha vira
  // uma perna independente (filtro + data + membro próprios). Evita a
  // ambiguidade de agregar linhas de datas/filtros diferentes no mesmo grupo
  // (cada linha pertence a uma perna). KPI modo meta/razão e "Agrupar período"
  // já retornaram acima (ficam no absorver). Exibição (24/07/2026,
  // settings.subSeriesMode): "stacked"/"grouped" mantêm a fonte como dimensão
  // LÍDER ("Base") e o gráfico pivota as pernas em séries; "total" funde as
  // pernas por tupla AQUI (sem a dim "Base") — pizza/funil com dimensão e
  // KPI/card fundem SEMPRE (uma fatia/valor por categoria, não por perna).
  if (involvesSub && mainPlan.extraLegs.length > 0) {
    const rowSourceKeys = [...mainPlan.mainSources, ...mainPlan.extraLegs];
    // Operando escopado numa fonte-IRMÃ (outra perna de linha deste widget) é
    // ZERADO na perna (fórmulas das métricas E defs 'calculado_agg' aninhadas):
    // cada perna exibe só a PRÓPRIA contribuição — sem isso, `count@a +
    // count@b` repetiria o total global em toda perna, já que a consulta
    // auxiliar de um escopo roda independente do universo da perna. O escopo
    // da própria perna permanece (coincide com o universo).
    const siblingsOf = (key: SourceKey): Set<string> =>
      new Set<string>(rowSourceKeys.filter((k) => k !== key));
    const legData = await Promise.all(
      rowSourceKeys.map((key) => {
        const siblings = siblingsOf(key);
        return runWidget(
          supabase,
          {
            ...config,
            sources: [key],
            splitBySource: false,
            metrics: config.metrics.map((m) =>
              m.formula
                ? {
                    ...m,
                    formula: zeroSiblingScopedOperands(m.formula, siblings),
                  }
                : m
            ),
            settings: { ...config.settings, coexistSubSources: [] },
          },
          available,
          period,
          zeroSiblingScopesInFields(fields, siblings),
          rates,
          conversionPeriod,
          catalog,
          correspondences
        ).catch(
          () => ({ rows: [], dimensions: [], metrics: [] }) as WidgetData
        );
      })
    );
    // Backfill: a basis das linhas de cada perna ganha `0` nas chaves das
    // irmãs (a perna nem as consultou) — o re-eval client-side (células/
    // subtotais) roda a fórmula ORIGINAL, e o fold entre pernas soma as
    // contribuições complementares (Total geral exato p/ fórmulas aditivas).
    rowSourceKeys.forEach((key, li) => {
      const siblings = siblingsOf(key);
      for (const [i, rc] of calcResolved) {
        if (!rc.formula) continue;
        const keys = siblingScopedBasisKeys(rc.formula, siblings);
        if (keys.length === 0) continue;
        const mk = `metric_${i + 1}`;
        for (const r of legData[li].rows) {
          const basis = (r.__calcOpsBy?.[mk] ?? r.__calcOps) as
            | BasisValues
            | undefined;
          if (!basis) continue;
          for (const k of keys) if (!(k in basis)) basis[k] = 0;
        }
      }
    });
    const base = legData.find((d) => d.metrics.length > 0) ?? legData[0];
    // Meta das métricas: rótulos/flags da 1ª perna com dados, com o `calc` das
    // CALCULADAS reapontado p/ a fórmula ORIGINAL — a fórmula de cada perna
    // foi zerada e difere entre pernas (nunca pode sair no resultado).
    const metricsMeta = (base?.metrics ?? []).map((mm, i) => {
      const rc = calcResolved.get(i);
      if (!rc || !mm.calc) return mm;
      const meta = calcMoneyMeta(rc, rates, conversionPeriod);
      return {
        ...mm,
        calc: {
          formula: rc.formula ?? { tokens: [] },
          currency: rc.code,
          allowNegative: rc.allowNegative,
          mode: meta.mode,
          fixedRate: meta.fixedRate,
        },
      };
    });
    const nDims = config.dimensions.length;
    const forceTotal =
      config.visual_type === "kpi" ||
      ((config.visual_type === "pizza" || config.visual_type === "funil") &&
        nDims >= 1);
    const chosen = config.settings?.subSeriesMode;
    if (
      forceTotal ||
      (chosen === "total" && (nDims >= 1 || config.visual_type === "kpi"))
    ) {
      // Merge "total": funde as linhas das pernas por tupla de dims, com a
      // semântica do Total geral (sum/count somam; min/max reduzem; calculadas
      // reavaliam a fórmula ORIGINAL sobre a basis fundida — razões exatas;
      // monetárias fundem __money e replotam). __cmp soma os não-nulos
      // (aproximação, como o "Outros" do top-N); __goal é a MESMA meta global
      // repetida por perna — 1º não-nulo, nunca soma.
      const specs = config.metrics.map((m, i) => {
        const rc = calcResolved.get(i);
        return {
          key: `metric_${i + 1}`,
          kind: rc
            ? ("calc" as const)
            : ((m.agg ?? "sum") as "sum" | "count" | "avg" | "min" | "max"),
          evalBasis: rc?.formula
            ? (b: BasisValues) =>
                evalCalcMoney(
                  rc.formula!,
                  b,
                  calcMoneyMeta(rc, rates, conversionPeriod)
                ).value
            : undefined,
        };
      });
      const groups = new Map<string, WidgetRow[]>();
      const order: string[] = [];
      for (const d of legData) {
        for (const r of d.rows) {
          const tuple: unknown[] = [];
          for (let i = 1; i <= nDims; i++) tuple.push(r[`dim_${i}`] ?? null);
          const k = JSON.stringify(tuple);
          const g = groups.get(k);
          if (g) g.push(r);
          else {
            groups.set(k, [r]);
            order.push(k);
          }
        }
      }
      const mergedRows: WidgetRow[] = [];
      for (const k of order) {
        const g = groups.get(k)!;
        const merged = foldRowGroup(g, specs);
        const cmp: NonNullable<WidgetRow["__cmp"]> = {};
        let hasCmp = false;
        for (const spec of specs) {
          let sum = 0;
          let has = false;
          for (const r of g) {
            const v = r.__cmp?.[spec.key];
            if (v != null && Number.isFinite(Number(v))) {
              sum += Number(v);
              has = true;
            }
          }
          if (has) {
            cmp[spec.key] = sum;
            hasCmp = true;
          }
        }
        if (hasCmp) merged.__cmp = cmp;
        else delete merged.__cmp;
        const goal = g.find((r) => r.__goal != null)?.__goal;
        if (goal != null) merged.__goal = goal;
        mergedRows.push(merged);
      }
      const moneyEntries = config.metrics
        .map((m, i) => ({ m, i }))
        .filter(
          ({ m, i }) =>
            !calcResolved.has(i) &&
            isMoneyMetric(m, available) &&
            m.agg !== "min" &&
            m.agg !== "max"
        );
      if (moneyEntries.length > 0) replotMoney(mergedRows, moneyEntries);
      return {
        rows: mergedRows,
        dimensions: base?.dimensions ?? [],
        metrics: metricsMeta,
        comparison: base?.comparison,
        goalLine: base?.goalLine,
        businessDayRef: base?.businessDayRef,
      };
    }
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
    return {
      rows: seriesRows,
      dimensions: [
        { key: "dim_1", label: "Base" },
        ...(base?.dimensions ?? []).map((d, i) => ({
          key: `dim_${i + 2}`,
          label: d.label,
        })),
      ],
      metrics: metricsMeta,
      comparison: base?.comparison,
      goalLine: base?.goalLine,
      businessDayRef: base?.businessDayRef,
      subSeries: { mode: chosen === "grouped" ? "grouped" : "stacked" },
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
  // rpcMetrics === config.metrics e nada muda. (`calcResolved` é resolvido
  // acima, antes do branch multi-perna, do MESMO jeito.)

  // Fontes por métrica (18/07/2026): particiona as métricas entre a consulta
  // PRINCIPAL (fontes do widget — define o universo de LINHAS) e as pernas
  // extras (uma por conjunto distinto de Metric.sources). Sem fontes próprias,
  // legs = [] e tudo abaixo se comporta byte a byte como antes.
  const { defaultIdx, legs } = partitionMetricLegs(
    config.metrics,
    config.sources,
    fieldByKey
  );
  const defaultIdxSet = new Set(defaultIdx);

  // Aux de operando ESCOPADO (`aggif:` com scope, 20/07/2026): a consulta
  // auxiliar roda como perna SÓ da fonte do escopo — período pela coluna de
  // data DELA (scopedAuxPeriod; patch p/ o @period pré-sintetizado) e
  // correspondências com o membro DELA (unified bucketiza pela data da sub).
  // Usar a lista de fontes do widget contaminaria o AND com o predicado de uma
  // sub-irmã do mesmo record_type. O predicado do escopo também vem nos
  // condFilters (record_type = rt + filtro da sub) — duplicação inofensiva.
  const scopedAuxInputs = (
    scope: SourceKey,
    runPeriod: DashboardPeriod | null | undefined
  ): { filters: WidgetFilter[]; corr: Record<string, string[]> } => {
    const rt = recordTypeOf(scope, catalog);
    const scopeField =
      runPeriod?.fieldBySource?.[scope] ??
      catalog.find((s) => s.key === scope)?.defaultPeriodField ??
      runPeriod?.field ??
      "source_created_at";
    const f = legFiltersFor(scopedAuxPeriod(runPeriod, scope, catalog), [
      scope,
    ]);
    return {
      filters: patchAuxPeriodByType(f, rt, scopeField),
      corr: corrMapForKeys([scope]),
    };
  };

  // Uma rodada COMPLETA da consulta agregada (RPC principal + auxiliares de
  // condição/moeda + pernas por fonte + remapeamento e avaliação das métricas
  // calculadas) para um par dims/pipeline-de-filtros. A mesma rodada serve o
  // período atual e o de comparação — `dims` SOMBREIA o de fora de propósito;
  // `filtersOf` reconstrói os filtros para as fontes de cada perna;
  // `runPeriod` é o período DESTA rodada (atual/perna do align/comparação) —
  // insumo das auxes de operandos escopados (período pela data do escopo).
  const computeRows = async (
    dims: Dimension[],
    filtersOf: (srcs?: SourceKey[]) => WidgetFilter[],
    runPeriod?: DashboardPeriod | null
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
      { filters: WidgetFilter[]; keys: BasisKey[]; scope?: string }
    >();
    for (const key of condBasisKeys) {
      const parsed = parseCondBasisKey(key);
      if (!parsed) continue;
      const extra = condFilters(parsed.conds);
      // Escopo entra na chave do grupo: specs idênticos com escopos diferentes
      // têm auxes diferentes (período/correspondências da fonte do escopo).
      const gk = JSON.stringify([extra, parsed.scope ?? null]);
      const g =
        condGroups.get(gk) ??
        ({ filters: extra, keys: [], scope: parsed.scope } as {
          filters: WidgetFilter[];
          keys: BasisKey[];
          scope?: string;
        });
      g.keys.push(key);
      condGroups.set(gk, g);
    }
    const condPromise = Promise.all(
      [...condGroups.values()].map(async (g) => {
        try {
          // Condição sobre relação por NOME → resolve p/ UUID antes do RPC.
          const condExtra = await resolveFkCondFilters(supabase, g.filters);
          const scoped = g.scope ? scopedAuxInputs(g.scope, runPeriod) : null;
          const { data: condData, error: condError } = await supabase.rpc(
            "run_widget_query",
            {
              p_source: config.source,
              p_dimensions: dims,
              p_metrics: g.keys.map(basisMetric),
              p_filters: [...(scoped ? scoped.filters : filters), ...condExtra],
              p_correspondences: scoped ? scoped.corr : correspondencesMap,
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
      // resolvem o membro próprio; raízes, o seu — nunca o da sub).
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
        { filters: WidgetFilter[]; keys: BasisKey[]; scope?: string }
      >();
      for (const key of condKeys) {
        const parsed = parseCondBasisKey(key);
        if (!parsed) continue;
        const extra = condFilters(parsed.conds);
        // Escopo na chave do grupo (mesma regra da principal).
        const gk = JSON.stringify([extra, parsed.scope ?? null]);
        const g =
          condGroups.get(gk) ??
          ({ filters: extra, keys: [], scope: parsed.scope } as {
            filters: WidgetFilter[];
            keys: BasisKey[];
            scope?: string;
          });
        g.keys.push(key);
        condGroups.set(gk, g);
      }
      const legCondP = Promise.all(
        [...condGroups.values()].map(async (g) => {
          try {
            // Condição sobre relação por NOME → resolve p/ UUID antes do RPC
            // (mesmo tratamento da auxiliar de condição da consulta principal).
            const condExtra = await resolveFkCondFilters(supabase, g.filters);
            const scoped = g.scope
              ? scopedAuxInputs(g.scope, runPeriod)
              : null;
            const { data: condData, error: condError } = await supabase.rpc(
              "run_widget_query",
              {
                p_source: config.source,
                p_dimensions: dims,
                p_metrics: g.keys.map(basisMetric),
                p_filters: [
                  ...(scoped ? scoped.filters : legFilters),
                  ...condExtra,
                ],
                p_correspondences: scoped ? scoped.corr : legCorr,
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

    // Dimensão `custom:` com transform: o RPC agrupa pelo valor CRU (0085,
    // ramo custom — o transform é só rótulo). Funde aqui pelo bucket, no
    // choke point único — principal, comparação, pernas do businessDayAlign,
    // card, quick-table e snapshot (mesmo engine) recebem linhas já fundidas.
    // Sem dim custom+transform, `merged === rows` (caminho atual intocado).
    const merged = mergeRowsByBucket(
      rows,
      dims,
      config.metrics.map((m, i) => {
        const rc = calcResolved.get(i);
        return {
          key: `metric_${i + 1}`,
          kind: rc
            ? ("calc" as const)
            : ((m.agg ?? "sum") as "sum" | "count" | "avg" | "min" | "max"),
          evalBasis: rc?.formula
            ? (b: BasisValues) =>
                evalCalcMoney(
                  rc.formula!,
                  b,
                  calcMoneyMeta(rc, rates, conversionPeriod)
                ).value
            : undefined,
        };
      })
    );
    if (merged !== rows) {
      // Replot das monetárias sobre o __money FUNDIDO (exato, incl. média).
      if (moneyEntries.length > 0 && hasBd) replotMoney(merged, moneyEntries);
      for (const lr of legRuns) {
        if (!lr.ok || lr.moneyEntries.length === 0) continue;
        if (Object.keys(lr.bdMap).length === 0) continue;
        replotMoney(merged, lr.moneyEntries);
      }
    }
    return merged;
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
      const cmpRows = await computeRows(
        cmpDims,
        (srcs) => cmpFiltersFor(cmpSpec, srcs),
        // Período DESTA rodada (range de comparação) — auxes escopadas.
        {
          field: period!.field,
          from: cmpSpec.from,
          to: cmpSpec.to,
          fieldBySource: period?.fieldBySource,
        }
      );
      return { cmpRows, sharedIdx, bucketed, divide };
    } catch {
      return null;
    }
  };

  // ---- Alinhamento "mesmo dia útil" (settings.businessDayAlign, 20/07/2026) --
  // Pernas POR MÊS: cada mês do período roda uma rodada COMPLETA (computeRows)
  // com o range recortado no N-ésimo dia útil do mês (N = dia útil corrente da
  // referência). Como cada rodada só devolve linhas do próprio mês, o concat é
  // o resultado final — todas as métricas (normais/calculadas/moeda/pernas)
  // funcionam sem código novo e os RPCs ficam intocados. Meses ENCERRADOS no
  // alinhamento (N ≥ dias úteis do mês) usam o mês cheio (não perde registro
  // datado em fim de semana após o último dia útil — paridade com o KPI).
  // null = align inativo (fallback byte-idêntico). Precedências: KPI/card e
  // "Agrupar período" (dateAgg) retornaram antes deste ponto (align não se
  // aplica); pernas de sub-fonte "conviver" recursam runWidget por fonte e o
  // align roda DENTRO de cada perna. Com align ativo, settings.comparison é
  // ignorada (exclusão mútua — o próprio gráfico é a comparação).
  const MAX_BD_ALIGN_MONTHS = 13;
  const bdAlignCtx = await (async (): Promise<{
    legs: DashboardPeriod[];
    // Dia útil de corte (reusado pela goalLine 'pace' e exposto como
    // WidgetData.businessDayRef); null = janela em modo "dia cheio" (sem
    // alinhamento por dia útil).
    n: number | null;
    holidays: Set<string>;
    // Referência que gerou o N (badge "Nº dia útil" no card).
    refIso: string;
    reference: "today" | "period_end";
  } | null> => {
    const cfg = config.settings?.businessDayAlign;
    const pw = config.settings?.periodWindow;
    // Janela efetiva: seleção do card/default (periodWindow.active, mesclado
    // pela page/widget-scope) ou o alias legado windowMonths.
    const activeWindow: PeriodWindowKey | null = pw?.active ?? pw?.default ?? null;
    const legacyMonths = Math.floor(cfg?.windowMonths ?? 0);
    const alignEnabled = Boolean(cfg?.enabled);
    if (!alignEnabled && !activeWindow && legacyMonths < 2) return null;
    if (!period?.from || !period.to || !period.field) return null;
    const monthly = dims.some(
      (d) =>
        d.transform === "month" ||
        d.transform === "month_name" ||
        d.transform === "month_year"
    );
    if (!monthly) return null;

    const tm = period.to.match(/^(\d{4})-(\d{2})/);
    if (!tm) return null;
    const [ty, tmo] = [Number(tm[1]), Number(tm[2])];
    // Início da janela (1º dia do mês inicial) pela chave; sem janela = `from`
    // da barra (alinhamento puro sobre o range da barra).
    const monthsBack = (n: number) => {
      const idx = ty * 12 + (tmo - 1) - (n - 1);
      return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-01`;
    };
    let rangeFrom = period.from;
    const rangeTo = period.to;
    if (activeWindow === "3m") rangeFrom = monthsBack(3);
    else if (activeWindow === "6m") rangeFrom = monthsBack(6);
    else if (activeWindow === "12m") rangeFrom = monthsBack(12);
    else if (activeWindow === "trimestre")
      rangeFrom = `${ty}-${String(Math.floor((tmo - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
    else if (activeWindow === "semestre")
      rangeFrom = `${ty}-${tmo <= 6 ? "01" : "07"}-01`;
    else if (activeWindow === "ano") rangeFrom = `${ty}-01-01`;
    else if (legacyMonths >= 2)
      rangeFrom = monthsBack(Math.min(MAX_BD_ALIGN_MONTHS, legacyMonths));

    const fm = rangeFrom.match(/^(\d{4})-(\d{2})/);
    if (!fm) return null;
    const [fy, fmo] = [Number(fm[1]), Number(fm[2])];
    const monthCount = (ty - fy) * 12 + (tmo - fmo) + 1;
    // Períodos longos demais viram fallback silencioso (custo: 1 rodada/mês).
    if (monthCount < 1 || monthCount > MAX_BD_ALIGN_MONTHS) return null;
    let holidays: Set<string>;
    try {
      holidays = alignEnabled ? await loadNonWorkingDays(supabase) : new Set();
    } catch {
      holidays = new Set();
    }
    const todayIso = todayBrasiliaIso();
    const reference: "today" | "period_end" =
      cfg?.reference === "period_end" ? "period_end" : "today";
    const ref =
      reference === "period_end"
        ? period.to
        : todayIso < period.to
          ? todayIso
          : period.to;
    // Recorte de cada mês:
    //  - dia ÚTIL (align): até o N-ésimo dia útil (N da referência); mês com
    //    N ≥ total de dias úteis = mês cheio;
    //  - dia CHEIO (sem align): recorte de DIAS equivalente ao período apurado
    //    quando a barra cabe num único mês (dia(from)–dia(to) clampados ao
    //    tamanho do mês; "Este mês" = 1–31 → meses cheios); barra multi-mês =
    //    meses cheios. O mês final sempre respeita o `to` da barra.
    const n = alignEnabled ? businessDayIndexInMonth(ref, holidays) : null;
    const pf = period.from.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const pt = period.to.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const barSingleMonth =
      pf && pt && pf[1] === pt[1] && pf[2] === pt[2];
    const dayFrom = barSingleMonth ? Number(pf![3]) : 1;
    const dayTo = barSingleMonth ? Number(pt![3]) : 31;
    const legs: DashboardPeriod[] = [];
    // N = 0 com align (nenhum dia útil decorrido no mês da referência):
    // acumulado alinhado é vazio — ativo com zero pernas (gráfico sem dados).
    if (alignEnabled && (n ?? 0) <= 0) return { legs, n, holidays, refIso: ref, reference };
    for (let i = 0; i < monthCount; i++) {
      const y = fy + Math.floor((fmo - 1 + i) / 12);
      const m = ((fmo - 1 + i) % 12) + 1;
      const mm = String(m).padStart(2, "0");
      const dim = daysInMonth(y, m);
      const monthEnd = `${y}-${mm}-${String(dim).padStart(2, "0")}`;
      let legFrom: string;
      let legTo: string;
      if (alignEnabled) {
        legFrom = `${y}-${mm}-01`;
        legTo =
          (n ?? 0) >= businessDaysInMonth(y, m, holidays)
            ? monthEnd
            : nthBusinessDayOfMonth(y, m, n ?? 1, holidays);
      } else {
        legFrom = `${y}-${mm}-${String(Math.min(dayFrom, dim)).padStart(2, "0")}`;
        legTo = `${y}-${mm}-${String(Math.min(dayTo, dim)).padStart(2, "0")}`;
      }
      if (legFrom < rangeFrom) legFrom = rangeFrom;
      if (legTo > rangeTo) legTo = rangeTo;
      if (legFrom > legTo) continue;
      legs.push({
        field: period.field,
        from: legFrom,
        to: legTo,
        fieldBySource: period.fieldBySource,
      });
    }
    return { legs, n, holidays, refIso: ref, reference };
  })();

  const [rows, cmpRun] = await Promise.all([
    bdAlignCtx
      ? Promise.all(
          bdAlignCtx.legs.map((leg) =>
            computeRows(dims, (srcs) => legFiltersFor(leg, srcs), leg)
          )
        ).then((parts) => parts.flat())
      : computeRows(dims, (srcs) => legFiltersFor(period, srcs), period),
    bdAlignCtx ? Promise.resolve(null) : runComparison(),
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

  // ---- Linha de meta (settings.goalLine, 20/07/2026) ----------------------
  // Anexa `row.__goal` por bucket MENSAL — ANTES da rotulagem (que muta os
  // dim_*; o bucket cru "YYYY-MM-..." é o que dá ano/mês). Meta AO VIVO via
  // resolveGoal (mesmo caminho/passthrough do KPI meta nos snapshots). Modo
  // 'pace' = meta ÷ dias úteis do mês × N, com N do businessDayAlign quando
  // ativo (linha ideal no MESMO estágio de todos os meses); sem align, só o
  // mês corrente é rateado (passados = cheia, futuros = sem linha). Qualquer
  // falha degrada em silêncio (gráfico sem a linha).
  let goalLineMeta: WidgetData["goalLine"];
  const glCfg = config.settings?.goalLine;
  if (glCfg?.enabled && rows.length > 0) {
    try {
      const monthIdx = dims.findIndex(
        (d) =>
          d.transform === "month" ||
          d.transform === "month_name" ||
          d.transform === "month_year"
      );
      if (monthIdx >= 0) {
        const metricKey = glCfg.metric?.trim() || "mrr";
        const pace = glCfg.mode === "pace";
        // Feriados do align só quando o align está ATIVO (n != null) — janela
        // em "dia cheio" carrega um Set vazio que não serve ao pace.
        let holidays = bdAlignCtx?.n != null ? bdAlignCtx.holidays : null;
        if (pace && !holidays) {
          try {
            holidays = await loadNonWorkingDays(supabase);
          } catch {
            holidays = new Set();
          }
        }
        const todayIso = todayBrasiliaIso();
        const todayYm = todayIso.slice(0, 7);
        const goalCache = new Map<string, Promise<number | null>>();
        const goalFor = (y: number, m: number): Promise<number | null> => {
          const k = `${y}-${m}`;
          let p = goalCache.get(k);
          if (!p) {
            p = resolveGoal(supabase, {
              scope: glCfg.scope ?? "global",
              operationId: glCfg.operationId ?? null,
              responsibleId: glCfg.responsibleId ?? null,
              year: y,
              month: m,
              metric: metricKey,
            }).then((g) => g.target);
            goalCache.set(k, p);
          }
          return p;
        };
        const dimKey = `dim_${monthIdx + 1}`;
        await Promise.all(
          rows.map(async (r) => {
            const bucket = String(r[dimKey] ?? "");
            const bm = bucket.match(/^(\d{4})-(\d{2})/);
            if (!bm) return;
            const y = Number(bm[1]);
            const m = Number(bm[2]);
            const target = await goalFor(y, m);
            if (target == null) {
              r.__goal = null;
              return;
            }
            if (!pace || !holidays) {
              r.__goal = target;
              return;
            }
            const totalBd = businessDaysInMonth(y, m, holidays);
            const ym = `${bm[1]}-${bm[2]}`;
            // N do corte deste mês: align ativo = mesmo N p/ todos; senão só
            // o mês corrente é rateado.
            let n: number | null;
            if (bdAlignCtx?.n != null) {
              n = bdAlignCtx.n;
            } else if (ym < todayYm) {
              n = totalBd; // mês encerrado: meta cheia
            } else if (ym === todayYm) {
              n = businessDayIndexInMonth(todayIso, holidays);
            } else {
              n = null; // mês futuro: sem linha
            }
            r.__goal =
              n == null || totalBd === 0
                ? null
                : n >= totalBd
                  ? target
                  : (target / totalBd) * n;
          })
        );
        const registry = await loadGoalMetrics(supabase);
        goalLineMeta = {
          label: glCfg.label?.trim() || "Meta",
          mode: pace ? "pace" : "monthly",
          ...(glCfg.color ? { color: glCfg.color } : {}),
          money: registry.find((m) => m.key === metricKey)?.money === true,
        };
      }
    } catch {
      goalLineMeta = undefined; // degrada sem a linha
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
    const base = d.field === "record_type" ? "Base" : fieldLabel(d.field, available);
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
    ...(goalLineMeta ? { goalLine: goalLineMeta } : {}),
    // Badge "Nº dia útil": N do corte compartilhado das pernas mensais (o
    // mesmo da goalLine "pace"). Só com align ATIVO e N >= 1 (N=0 = nenhum
    // dia útil decorrido — gráfico vazio, sem badge).
    ...(bdAlignCtx && bdAlignCtx.n != null && bdAlignCtx.n >= 1
      ? {
          businessDayRef: {
            n: bdAlignCtx.n,
            reference: bdAlignCtx.reference,
            date: bdAlignCtx.refIso,
          },
        }
      : {}),
  };
}
