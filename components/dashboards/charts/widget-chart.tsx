// Versão: 3.4 | Data: 24/07/2026
// v3.4 (24/07/2026): pernas de sub-base como SÉRIES — quando o engine carimba
//   WidgetData.subSeries (modos "stacked"/"grouped"), buildSubSeriesPivot
//   (lib/widgets/sub-series.ts) pivota a dim líder "Base" em uma série por
//   sub-base (empilhada por métrica ou lado a lado) com a dimensão REAL no
//   eixo; formatação resolve a métrica subjacente via keyMap (resolveKey) e o
//   top-N/ordenação ranqueiam pelo total da categoria. Sem o marcador, caminho
//   byte-idêntico.
// v3.3 (18/07/2026): "Formato do grupo" na tabela agregada
//   (appearance.table.groupDateFormats, keys dim_<n>) — nível de data do
//   "Agrupar por" funde/rotula por formato próprio (bucketGroupDate) e ordena
//   cronologicamente, sem alterar a máscara das células. Só dims cujo valor
//   ainda é ISO cru (sem transform "por nome"; guard via dateCols).
// v3.2 (18/07/2026): fontes por métrica — as leituras de basis das calculadas
//   passam a preferir __calcOpsBy[key] (basis POR MÉTRICA, universo próprio de
//   Metric.sources) com fallback ao __calcOps compartilhado (comportamento
//   clássico). Ver lib/widgets/engine.ts v1.4.
// v3.1 (15/07/2026): exibição percentual — buildPercentModes (x100 do carimbo do
//   engine vence o sufixo "%" da métrica) aplicado a células, tooltips, rótulos,
//   eixos, subtotais e Total geral.
// Renderiza um WidgetData conforme o visual_type (Recharts v3). v3.0 (Fase 10.1):
// além da aparência (cores, grade, eixos, legenda, gradiente), suporta edição
// IN-LOCO em tabelas e gráficos (reordenar por arraste, ordenar e colorir via
// duplo-clique) quando canEdit. Sem `appearance` = comportamento original.
"use client";

import { memo, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type {
  AppearanceSettings,
  ColorPair,
  GroupDateFormat,
  Metric,
  TableAlign,
  VisualType,
  WidgetData,
  WidgetRow,
} from "@/lib/widgets/types";
import {
  bucketGroupDate,
  isGroupDateFormat,
} from "@/lib/widgets/date-buckets";
import {
  foldBreakdowns,
  formatMoney,
  formatMoneyAggregate,
  plotSingleCurrency,
} from "@/lib/widgets/currency";
import {
  evalCalcMoney,
  foldBasis,
  type CalcMoneyMeta,
} from "@/lib/widgets/calc-metrics";
import { paletteColor, resolveSeriesColor } from "@/lib/widgets/palettes";
import {
  buildSubSeriesPivot,
  subSeriesCatTotalKey,
} from "@/lib/widgets/sub-series";
import {
  alignClass,
  applyManualOrder,
  distinctFills,
  fracDigits,
  gridFlags,
  groupByLevels,
  limitCategories,
  orderCategories,
  reorderKeys,
  resolveAlign,
  resolveDecimals,
  rowKeyOf,
  sortRows,
  topWithOther,
} from "@/lib/widgets/appearance";
import {
  DEFAULT_DATE_FORMAT,
  formatDateValue,
  formatPercent,
  looksLikeDate,
  type DateFormat,
} from "@/lib/widgets/format";
import {
  CategoryEditor,
  ColorOrderDialog,
  ColorPopover,
  ContextMenu,
  ResizeHandle,
  type ColorScope,
} from "../appearance-editing";
import {
  computeVariation,
  formatVariation,
  variationTone,
} from "@/lib/widgets/variation";
import {
  evalConditional,
  evalScopedConditional,
  hasConditional,
  scaleDomains,
  type ResolvedCondStyle,
} from "@/lib/widgets/conditional";
import { useFontScale } from "../font-scale-context";
import { FONT_DEFAULTS, fontStyle, resolveFontNum } from "@/lib/widgets/fonts";
import { VariationBadge } from "./variation-badge";

// Glyphs dos ícones de regra condicional (células/valores).
const COND_ICONS: Record<string, string> = {
  up: "▲",
  down: "▼",
  dot: "●",
  warn: "⚠",
};
function CondIcon({ style }: { style: ResolvedCondStyle | null }) {
  if (!style?.icon) return null;
  return (
    <span aria-hidden className="mr-0.5">
      {COND_ICONS[style.icon] ?? ""}
    </span>
  );
}

// noop p/ quando não há edição (canEdit=false).
const NOOP = () => {};

// `decimals` (18/07/2026): casas fixas da aparência; undefined = teto de 2.
function fmt(v: unknown, decimals?: number): string {
  const n = Number(v);
  if (v == null || Number.isNaN(n)) return String(v ?? "—");
  return n.toLocaleString("pt-BR", fracDigits(decimals));
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Glyph textual da variação (tooltips — sem cor/ícone SVG).
function variationGlyph(dir: "up" | "down" | "flat"): string {
  return dir === "up" ? "▲" : dir === "down" ? "▼" : "•";
}

// Cor (CSS var) do tom da variação p/ SVG/labels dos gráficos.
function variationFill(tone: "good" | "bad" | "flat"): string {
  return tone === "good"
    ? "var(--chart-2)"
    : tone === "bad"
      ? "var(--destructive)"
      : "var(--muted-foreground)";
}

// Exibição percentual (15/07/2026): "x100" = campo/calc percentual (converte de
// fato, 0.35 → "35%"); "suffix" = toggle "%" da métrica (só anexa o símbolo);
// null = número normal. "x100" vence o toggle (nunca duplica o símbolo).
type PercentMode = "x100" | "suffix" | null;

// Modo percentual por chave de métrica, pré-computado uma vez por render (padrão
// metricByKey/calcCodeByKey — nada de .find() por célula/tooltip). Única fonte da
// precedência: carimbo do engine ("x100") > toggle da métrica ("suffix", nunca em
// monetária) > null. Compartilhado entre o WidgetChart e a AppearanceTable.
function buildPercentModes(
  dataMetrics: WidgetData["metrics"],
  metricByKey: Record<string, Metric>
): Record<string, PercentMode> {
  const out: Record<string, PercentMode> = {};
  for (const m of dataMetrics) {
    out[m.key] = m.percent
      ? "x100"
      : metricByKey[m.key]?.percent && !m.isMoney
        ? "suffix"
        : null;
  }
  return out;
}

// Métrica calculada de agregados: null (divisão por zero / operando ausente) →
// "—"; com moeda → formatMoney; senão número puro. `calcValueText` é o fallback
// SEM basis (payload antigo / valor plotado): usa a moeda fixa da definição.
type CalcMeta = NonNullable<WidgetData["metrics"][number]["calc"]>;
function calcMetaOf(calc: CalcMeta): CalcMoneyMeta {
  return {
    mode: calc.mode ?? (calc.currency ? "fixed" : "none"),
    code: calc.currency,
    fixedRate: calc.fixedRate,
    allowNegative: calc.allowNegative,
  };
}
function calcValueText(
  v: unknown,
  calc: CalcMeta,
  pct: PercentMode = null,
  decimals?: number
): string {
  const n = Number(v);
  if (v == null || !Number.isFinite(n)) return "—";
  if (calc.currency) return formatMoney(n, calc.currency, decimals);
  return pct ? formatPercent(n, pct === "x100", decimals) : fmt(n, decimals);
}

// Célula de métrica calculada: reavalia a fórmula da basis da linha (moeda
// automática preservada / convertida); sem basis cai no valor plotado. `pct`
// só se aplica quando o resultado é número puro (sem moeda).
// Basis da métrica `key` numa linha: por métrica (__calcOpsBy, universo próprio
// de Metric.sources) com fallback à compartilhada (__calcOps, clássico).
function calcOpsOf(
  row: Record<string, unknown>,
  key: string
): WidgetRow["__calcOps"] {
  const r = row as WidgetRow;
  return r.__calcOpsBy?.[key] ?? r.__calcOps;
}

function calcCellText(
  row: Record<string, unknown>,
  key: string,
  calc: CalcMeta,
  pct: PercentMode = null,
  decimals?: number
): string {
  const ops = calcOpsOf(row, key);
  if (ops) {
    const { value, currency } = evalCalcMoney(calc.formula, ops, calcMetaOf(calc));
    if (value == null) return "—";
    if (currency) return formatMoney(value, currency, decimals);
    return pct ? formatPercent(value, pct === "x100", decimals) : fmt(value, decimals);
  }
  return calcValueText(row[key], calc, pct, decimals);
}

// Subtotal/Total geral de uma métrica calculada: NUNCA soma a coluna — funde as
// basis (__calcOpsBy[key] ?? __calcOps) das linhas do escopo e reavalia a
// fórmula. Linhas sem basis (payload antigo) → null ("—").
function calcAggResult(
  rs: Record<string, unknown>[],
  key: string,
  calc: CalcMeta
): { value: number | null; currency: string | null } | null {
  if (calc.formula.tokens.length === 0) return null;
  const list = rs.map((r) => calcOpsOf(r, key));
  if (!list.some(Boolean)) return null;
  return evalCalcMoney(calc.formula, foldBasis(list), calcMetaOf(calc));
}
function calcAggText(
  rs: Record<string, unknown>[],
  key: string,
  calc: CalcMeta,
  pct: PercentMode = null,
  decimals?: number
): string {
  const res = calcAggResult(rs, key, calc);
  if (!res || res.value == null) return "—";
  if (res.currency) return formatMoney(res.value, res.currency, decimals);
  return pct
    ? formatPercent(res.value, pct === "x100", decimals)
    : fmt(res.value, decimals);
}

// Valor monetário compacto (sem centavos) p/ os eixos dos gráficos.
function moneyAxis(v: unknown, code: string): string {
  const n = Number(v);
  if (v == null || Number.isNaN(n)) return String(v ?? "—");
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: code,
    maximumFractionDigits: 0,
  });
}

// Opacidade decrescente p/ o modo gradiente (variação sutil entre colunas).
function gradientOpacity(i: number, n: number): number {
  if (n <= 1) return 1;
  return 1 - (i / (n - 1)) * 0.45;
}

function EmptyState() {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
      Sem dados para exibir.
    </div>
  );
}

// React.memo: sob o WidgetCard memoizado, o chart (recharts) só re-renderiza
// quando dados/aparência mudam — não a cada medição/drag/hover do grid.
export const WidgetChart = memo(function WidgetChart({
  visualType,
  data,
  appearance,
  dateFormat,
  metricsConfig = [],
  canEdit = false,
  onAppearanceChange,
  dimChrono = false,
}: {
  visualType: VisualType;
  data: WidgetData;
  appearance?: AppearanceSettings;
  dateFormat?: DateFormat;
  // Config de moeda por métrica (alinhada por índice a data.metrics).
  metricsConfig?: Metric[];
  canEdit?: boolean;
  onAppearanceChange?: (a: AppearanceSettings) => void;
  // Eixo cronológico (1ª dimensão com transform de data): os chips não
  // oferecem ordenação por valor (o eixo segue cronológico por padrão).
  dimChrono?: boolean;
}) {
  const { rows, dimensions, metrics } = data;
  // Pernas de sub-base como SÉRIES (WidgetData.subSeries, 24/07/2026): pivota
  // a dimensão líder "Base" (dim_1) em uma série por sub-base e usa a dimensão
  // REAL (dim_2) como eixo de categorias — barras empilhadas ou lado a lado.
  // null = caminho clássico, byte-idêntico.
  const pivot = useMemo(() => buildSubSeriesPivot(data), [data]);
  const dimKey = pivot?.catKey ?? dimensions[0]?.key;
  // Chave sintética de série do pivot → metric_<n> (formatação/moeda/percent
  // resolvem pela métrica subjacente); fora do pivot, identidade.
  const resolveKey = (k: string): string => pivot?.keyMap[k] ?? k;

  // Tamanhos de fonte efetivos (appearance.fonts × escala do dashboard).
  // Auto + escala 1 ⇒ styles undefined (render idêntico ao anterior).
  const fontScale = useFontScale();
  const fonts = appearance?.fonts;
  const chartPx = resolveFontNum(fonts?.chart, FONT_DEFAULTS.chart, fontScale);
  const valueStyle = fontStyle(fonts?.value, FONT_DEFAULTS.value, fontScale);
  const valueMultiStyle = fontStyle(
    fonts?.value,
    FONT_DEFAULTS.valueMulti,
    fontScale
  );
  const labelsStyle = fontStyle(fonts?.labels, FONT_DEFAULTS.labels, fontScale);
  const axisProps = {
    tick: { fontSize: chartPx, fill: "var(--muted-foreground)" },
    stroke: "var(--border)",
  };
  // Largura dos eixos Y acompanha ticks maiores p/ não cortar os rótulos.
  const axisScale = Math.max(1, chartPx / FONT_DEFAULTS.chart);
  const axisW = Math.round(48 * axisScale);
  const axisWCat = Math.round(90 * axisScale);

  // --- Moeda: config por métrica + helpers de formatação (paridade c/ registros) ---
  const metricByKey: Record<string, Metric> = useMemo(() => {
    const out: Record<string, Metric> = {};
    metrics.forEach((m, i) => {
      if (metricsConfig[i]) out[m.key] = metricsConfig[i];
    });
    return out;
  }, [metrics, metricsConfig]);
  const isMoneyKey = (key: string) =>
    metrics.find((m) => m.key === resolveKey(key))?.isMoney ?? false;
  const calcOf = (key: string) =>
    metrics.find((m) => m.key === resolveKey(key))?.calc;

  // Percentual por métrica (ver buildPercentModes): pré-computado uma vez.
  const percentModeByKey = useMemo(
    () => buildPercentModes(metrics, metricByKey),
    [metrics, metricByKey]
  );
  const percentModeOf = (key: string): PercentMode =>
    percentModeByKey[resolveKey(key)] ?? null;
  // Casas decimais do widget (gráficos/KPI usam só o global; a AppearanceTable
  // resolve por célula via resolveDecimals).
  const apDecimals = appearance?.decimals;
  const pfmt = (v: unknown, key: string, decimals = apDecimals): string => {
    const mode = percentModeOf(key);
    return mode ? formatPercent(v, mode === "x100", decimals) : fmt(v, decimals);
  };

  // Texto de uma célula/valor de métrica honrando os modos de moeda (tabela/KPI).
  const moneyCellText = (
    row: WidgetRow,
    key: string,
    decimals = apDecimals
  ): string => {
    const calc = calcOf(key);
    if (calc) return calcCellText(row, key, calc, percentModeOf(key), decimals);
    const bd = row.__money?.[key];
    const cfg = metricByKey[key];
    if (isMoneyKey(key) && bd && cfg)
      return formatMoneyAggregate(bd, cfg, false, decimals);
    return pfmt(row[key], key, decimals);
  };

  // Moeda de EXIBIÇÃO de uma série no gráfico: mantém a moeda estrangeira única
  // (exibição "original"); senão R$ (convertido) — coerente com o número plotado
  // pelo engine. Mapa pré-computado por métrica monetária: o scan percorre
  // TODAS as linhas e era refeito por datapoint (tooltip/rótulo/eixo).
  const seriesMoneyCodeByKey = useMemo(() => {
    const out: Record<string, string> = {};
    for (const m of metrics) {
      if (!m.isMoney) continue;
      const key = m.key;
      let res = "BRL";
      if ((metricByKey[key]?.currencyDisplay ?? "original") === "original") {
        let code: string | null = null;
        let mixed = false;
        for (const r of rows as WidgetRow[]) {
          const bd = r.__money?.[key];
          if (!bd) continue;
          const c = plotSingleCurrency(bd);
          if (c == null || (code != null && code !== c)) {
            mixed = true;
            break;
          }
          code = c;
        }
        if (!mixed && code && code !== "BRL") res = code;
      }
      out[key] = res;
    }
    return out;
  }, [rows, metrics, metricByKey]);
  const seriesMoneyCode = (key: string): string =>
    seriesMoneyCodeByKey[resolveKey(key)] ?? "BRL";

  // Moeda uniforme da série de uma métrica calculada: todas as linhas avaliadas
  // na MESMA moeda → usa-a nos rótulos; mista ou sem moeda → null (número puro,
  // já que os valores plotados estariam em moedas diferentes). useMemo: avalia
  // a fórmula linha a linha por métrica calculada — só quando rows/metrics mudam.
  const calcCodeByKey: Record<string, string | null> = useMemo(() => {
    const calcSeriesCode = (key: string, calc: CalcMeta): string | null => {
      let code: string | null = null;
      let any = false;
      for (const r of rows as WidgetRow[]) {
        const ops = calcOpsOf(r, key);
        if (!ops) continue;
        const { currency } = evalCalcMoney(calc.formula, ops, calcMetaOf(calc));
        any = true;
        if (currency == null) return null;
        if (code == null) code = currency;
        else if (code !== currency) return null;
      }
      return any ? code : (calc.currency ?? null);
    };
    const out: Record<string, string | null> = {};
    metrics.forEach((m) => {
      if (m.calc) out[m.key] = calcSeriesCode(m.key, m.calc);
    });
    return out;
  }, [rows, metrics]);

  // Texto de um valor plotado (tooltip/rótulo) na moeda da série; não-money = fmt.
  // Calculada de agregados: moeda uniforme da série (ou número) e null → "—".
  // Obs.: a fatia "Outros" (pizza/funil, topWithOther) SOMA os valores plotados —
  // para fórmulas-razão isso é uma aproximação, não a fórmula sobre o conjunto.
  const moneyChartText = (v: unknown, key: string): string => {
    const calc = calcOf(key);
    if (calc) {
      const n = Number(v);
      if (v == null || !Number.isFinite(n)) return "—";
      const code = calcCodeByKey[resolveKey(key)];
      return code ? formatMoney(n, code, apDecimals) : pfmt(n, key);
    }
    return isMoneyKey(key)
      ? formatMoney(v, seriesMoneyCode(key), apDecimals)
      : pfmt(v, key);
  };

  // --- Comparação com período anterior (WidgetData.comparison) ---
  const cmp = data.comparison;
  // --- Linha de meta (WidgetData.goalLine): valores por linha em __goal ---
  const goal = data.goalLine;
  // Série fantasma nos gráficos: config explícita; default acompanha "exibir
  // valor do período de comparação".
  const ghost = Boolean(
    cmp && (cmp.settings.ghostSeries ?? cmp.settings.showBaseValue)
  );
  // Linhas de plotagem com o valor comparado achatado (`<metric>__cmp`) — o
  // Recharts precisa de dataKey plano p/ a série fantasma. Sob o pivot, as
  // linhas já saem achatadas por chave sintética (buildSubSeriesPivot).
  const plotRows = useMemo(() => {
    if (pivot) return pivot.rows;
    if (!cmp) return rows;
    return (rows as WidgetRow[]).map((r) => {
      const flat: Record<string, unknown> = {};
      for (const m of metrics) flat[`${m.key}__cmp`] = r.__cmp?.[m.key] ?? null;
      return { ...r, ...flat };
    });
  }, [rows, metrics, cmp, pivot]);
  // Texto de tooltip com a variação anexada ("R$ 12 mil · ▲ 8% vs. período
  // anterior"). Séries fantasma (dataKey __cmp) formatam na escala da métrica.
  const chartTooltipText = (v: unknown, dk: string, payload: unknown): string => {
    // Linha de meta: número puro (ou R$ p/ métrica de meta monetária).
    if (dk === "__goal") {
      const n = numOrNull(v);
      if (n == null) return "—";
      return goal?.money
        ? formatMoney(n, "BRL")
        : n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
    }
    const isCmpKey = dk.endsWith("__cmp");
    const baseKey = isCmpKey ? dk.slice(0, -5) : dk;
    const text = moneyChartText(v, baseKey);
    if (!cmp || isCmpKey) return text;
    const prev = (payload as WidgetRow | undefined)?.__cmp?.[baseKey];
    const vr = computeVariation(numOrNull(v), prev == null ? null : Number(prev));
    if (!vr) return text;
    return `${text} · ${variationGlyph(vr.dir)} ${formatVariation(
      vr,
      cmp.settings.format ?? "pct"
    )} ${cmp.label}`;
  };

  // Código único do eixo quando todas as métricas monetárias compartilham a mesma
  // moeda de exibição; senão null (eixo numérico simples).
  const moneyKeys = metrics.filter((m) => m.isMoney).map((m) => m.key);
  const axisMoneyCode = (() => {
    if (moneyKeys.length === 0) return null;
    const codes = new Set(moneyKeys.map(seriesMoneyCode));
    return codes.size === 1 ? [...codes][0]! : null;
  })();
  // Eixo percentual: sem eixo monetário e TODAS as métricas plotadas com o MESMO
  // modo percentual não-nulo → ticks em "%"; modos divergentes = eixo numérico.
  const axisPercentMode = (() => {
    if (axisMoneyCode || metrics.length === 0) return null;
    const modes = new Set(metrics.map((m) => percentModeOf(m.key)));
    return modes.size === 1 ? [...modes][0]! : null;
  })();
  const yTickFormatter = axisMoneyCode
    ? (v: number) => moneyAxis(v, axisMoneyCode)
    : axisPercentMode
      ? (v: number) => formatPercent(v, axisPercentMode === "x100")
      : undefined;
  const ap = appearance ?? {};
  const change = onAppearanceChange ?? NOOP;
  const editable = canEdit && Boolean(onAppearanceChange);
  // Formatação condicional no nível do chart/Card (a tabela agregada avalia a
  // própria cópia dentro da AppearanceTable). Alvo "value" = número do Card.
  const chartCond = ap.conditional;
  const chartCondActive = hasConditional(chartCond);
  const cardCondStyle = (value: unknown): ResolvedCondStyle | null =>
    chartCondActive ? evalConditional(chartCond, "value", value) : null;
  // Sob o pivot a legenda liga por padrão — os nomes das sub-bases são a única
  // identificação das séries.
  const showLegend = ap.legend?.show ?? (pivot ? true : metrics.length > 1);
  const legendStyle = {
    fontSize: chartPx,
    ...(ap.legend?.color ? { color: ap.legend.color } : {}),
  };
  // Texto do rótulo de dados (dataLabels.format): percentual = participação no
  // total da série exibida (barra/linha: soma da métrica nas categorias
  // plotadas; pizza/funil: soma das fatias) — total inválido cai p/ o valor.
  const dataLabelText = (
    v: unknown,
    key: string,
    total: number | null
  ): string => {
    const fmt = ap.dataLabels?.format ?? "value";
    const base = moneyChartText(v, key);
    if (fmt === "value") return base;
    const n = numOrNull(v);
    const pct =
      n != null && total != null && total !== 0
        ? formatPercent(n / total, true)
        : null;
    if (fmt === "percent") return pct ?? base;
    return pct ? `${base} · ${pct}` : base;
  };
  const grid = gridFlags(ap.gridLines);
  const bg = ap.chartBackground;

  // Eixo duplo: só se ≥2 métricas e alguma marcada como "direita".
  const hasRightAxis =
    metrics.length >= 2 &&
    metrics.some((m) => ap.seriesAxis?.[m.key] === "right");
  const axisOf = (key: string) => ap.seriesAxis?.[key] ?? "left";

  function withBg(chart: React.ReactNode) {
    return (
      <div className="h-full w-full" style={bg ? { background: bg } : undefined}>
        <ResponsiveContainer width="100%" height="100%">
          {chart as React.ReactElement}
        </ResponsiveContainer>
      </div>
    );
  }

  if (visualType === "kpi") {
    // Modos novos do Card (lib/widgets/card.ts): ranking/lista usam as rows já
    // ordenadas/cortadas no servidor; record/formula trazem o texto pronto.
    if (data.card) {
      const c = data.card;
      if (c.mode === "topn" || c.mode === "list") {
        if (rows.length === 0) return <EmptyState />;
        const dKey = dimensions[0]?.key ?? "dim_1";
        const mKey = metrics[0]?.key;
        return (
          <div className="flex h-full flex-col justify-center gap-1 overflow-auto p-1">
            {rows.map((r, i) => (
              <div
                key={i}
                className="flex items-baseline gap-2 text-sm"
                style={fontStyle(fonts?.value, 14, fontScale)}
              >
                <span className="text-muted-foreground w-4 shrink-0 text-right text-xs tabular-nums">
                  {i + 1}.
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {String(r[dKey] ?? "—")}
                </span>
                {c.mode === "topn" && mKey ? (
                  <span className="shrink-0 font-medium tabular-nums">
                    {moneyCellText(r as WidgetRow, mKey)}
                  </span>
                ) : null}
                {c.mode === "topn" && mKey && cmp ? (
                  <VariationBadge
                    cur={numOrNull(r[mKey])}
                    prev={(r as WidgetRow).__cmp?.[mKey] ?? null}
                    settings={cmp.settings}
                    fmtAbs={(n) => moneyChartText(n, mKey)}
                    className="shrink-0 text-xs"
                    hideWhenUnavailable
                  />
                ) : null}
              </div>
            ))}
            {c.subText ? (
              <span className="text-muted-foreground text-xs" style={labelsStyle}>
                {c.subText}
              </span>
            ) : null}
            {cmp ? (
              <span className="text-muted-foreground/70 text-[10px]">
                {cmp.label}
              </span>
            ) : null}
          </div>
        );
      }
      const cs = cardCondStyle(c.valueText);
      // Comparação do card de fórmula (value/cmpValue anexados pelo servidor);
      // cards de registro não trazem value e seguem sem badge.
      const cardCmp = cmp && c.value !== undefined ? cmp : null;
      const cardOnly = Boolean(cardCmp?.settings.onlyVariation);
      const fmtCardAbs = (n: number): string =>
        c.currency ? formatMoney(n, c.currency, apDecimals) : fmt(n, apDecimals);
      return (
        <div className="flex h-full flex-col justify-center gap-1 p-1">
          {cardCmp && cardOnly ? (
            <VariationBadge
              cur={c.value}
              prev={c.cmpValue}
              settings={cardCmp.settings}
              fmtAbs={fmtCardAbs}
              className="text-3xl font-semibold"
              style={valueStyle}
            />
          ) : (
            <span
              className="text-3xl font-semibold"
              style={{
                color: cs?.text,
                background: cs?.fill,
                ...(cs?.bold ? { fontWeight: 700 } : {}),
                ...valueStyle,
              }}
            >
              <CondIcon style={cs} />
              {c.valueText ?? "—"}
            </span>
          )}
          {c.subText ? (
            <span className="text-muted-foreground text-xs" style={labelsStyle}>
              {c.subText}
            </span>
          ) : null}
          {cardCmp ? (
            <span
              className="flex flex-wrap items-center gap-x-2 text-xs"
              style={labelsStyle}
            >
              {!cardOnly ? (
                <VariationBadge
                  cur={c.value}
                  prev={c.cmpValue}
                  settings={cardCmp.settings}
                  fmtAbs={fmtCardAbs}
                />
              ) : null}
              {cardCmp.settings.showBaseValue && c.cmpValueText ? (
                <span className="text-muted-foreground">
                  vs. {c.cmpValueText}
                </span>
              ) : null}
              <span className="text-muted-foreground/70">{cardCmp.label}</span>
            </span>
          ) : null}
        </div>
      );
    }
    if (data.kpi) {
      const k = data.kpi;
      if (k.mode === "data_atual") {
        return (
          <div className="flex h-full flex-col justify-center p-1">
            <span className="text-3xl font-semibold tabular-nums" style={valueStyle}>
              {k.valueText ?? "—"}
            </span>
            <span className="text-muted-foreground text-xs" style={labelsStyle}>
              {k.label}
            </span>
          </div>
        );
      }
      if (k.mode === "ratio") {
        const only = Boolean(cmp?.settings.onlyVariation);
        return (
          <div className="flex h-full flex-col justify-center p-1">
            {cmp && only ? (
              <VariationBadge
                cur={k.value}
                prev={k.cmpValue}
                settings={cmp.settings}
                className="text-3xl font-semibold"
                style={valueStyle}
              />
            ) : (
              <span className="text-3xl font-semibold tabular-nums" style={valueStyle}>
                {k.valueText ?? (k.value == null ? "—" : fmt(k.value, apDecimals))}
              </span>
            )}
            <span className="text-muted-foreground text-xs" style={labelsStyle}>
              {k.label}
            </span>
            {cmp ? (
              <span
                className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs"
                style={labelsStyle}
              >
                {!only ? (
                  <VariationBadge
                    cur={k.value}
                    prev={k.cmpValue}
                    settings={cmp.settings}
                  />
                ) : null}
                {cmp.settings.showBaseValue && k.cmpValue != null ? (
                  <span className="text-muted-foreground">
                    vs. {fmt(k.cmpValue, apDecimals)}
                  </span>
                ) : null}
                <span className="text-muted-foreground/70">{cmp.label}</span>
              </span>
            ) : null}
          </div>
        );
      }
      const pct = k.pct == null ? null : Math.round(k.pct * 100);
      return (
        <div className="flex h-full flex-col justify-center gap-1 p-1">
          <span className="text-3xl font-semibold tabular-nums" style={valueStyle}>
            {k.realizadoText ?? fmt(k.realizado, apDecimals)}
          </span>
          <span className="text-muted-foreground text-xs" style={labelsStyle}>
            {k.label}
          </span>
          {k.meta != null ? (
            <div
              className="text-muted-foreground mt-1 flex flex-wrap gap-x-4 text-xs"
              style={labelsStyle}
            >
              <span>Meta: {k.metaText ?? fmt(k.meta, apDecimals)}</span>
              {pct != null ? (
                <span className={pct >= 100 ? "text-chart-2" : ""}>{pct}%</span>
              ) : null}
              {k.falta != null && k.falta > 0 ? (
                <span>Falta: {k.faltaText ?? fmt(k.falta, apDecimals)}</span>
              ) : null}
            </div>
          ) : (
            <span className="text-muted-foreground text-xs" style={labelsStyle}>
              Sem meta configurada
            </span>
          )}
        </div>
      );
    }

    const row = (rows[0] ?? {}) as WidgetRow;
    const only = Boolean(cmp?.settings.onlyVariation);
    return (
      <div className="flex h-full flex-wrap items-center gap-x-8 gap-y-3 p-1">
        {metrics.map((m) => {
          const cur = numOrNull(row[m.key]);
          const prev = row.__cmp?.[m.key] ?? null;
          const fmtAbs = (n: number) => moneyChartText(n, m.key);
          const cs =
            cardCondStyle(cur) ??
            (chartCondActive
              ? evalConditional(chartCond, m.key, cur, {
                  variation:
                    cmp != null ? computeVariation(cur, prev) : null,
                })
              : null);
          return (
            <div key={m.key} className="flex flex-col">
              {cmp && only ? (
                <VariationBadge
                  cur={cur}
                  prev={prev}
                  settings={cmp.settings}
                  fmtAbs={fmtAbs}
                  className="text-2xl font-semibold"
                  style={valueMultiStyle}
                />
              ) : (
                <span
                  className="text-2xl font-semibold tabular-nums"
                  style={{
                    color: cs?.text,
                    background: cs?.fill,
                    ...(cs?.bold ? { fontWeight: 700 } : {}),
                    ...valueMultiStyle,
                  }}
                >
                  <CondIcon style={cs} />
                  {moneyCellText(row, m.key)}
                </span>
              )}
              <span className="text-muted-foreground text-xs" style={labelsStyle}>
                {m.label}
              </span>
              {cmp ? (
                <span
                  className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs"
                  style={labelsStyle}
                >
                  {!only ? (
                    <VariationBadge
                      cur={cur}
                      prev={prev}
                      settings={cmp.settings}
                      fmtAbs={fmtAbs}
                    />
                  ) : null}
                  {cmp.settings.showBaseValue && prev != null ? (
                    <span className="text-muted-foreground">
                      vs. {fmtAbs(prev)}
                    </span>
                  ) : null}
                  <span className="text-muted-foreground/70">{cmp.label}</span>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  if (visualType === "tabela") {
    return (
      <AppearanceTable
        data={data}
        appearance={ap}
        editable={editable}
        dateFormat={dateFormat ?? DEFAULT_DATE_FORMAT}
        metricByKey={metricByKey}
        onChange={change}
      />
    );
  }

  if (rows.length === 0 || !dimKey) return <EmptyState />;

  if (visualType === "pizza" || visualType === "funil") {
    const metricKey = metrics[0]?.key;
    if (!metricKey) return <EmptyState />;
    // Ordenação das fatias (categorySort, exceto "por cor" — sliceColors são
    // indexadas e não há fill por nome): por valor ou rótulo, MESMO helper do
    // sheet de aparência p/ os índices de fatia baterem.
    const pieBase = topWithOther(rows, dimKey, metricKey, ap.categoryLimit);
    const pieData =
      ap.categorySort && ap.categorySort.dir !== "color"
        ? (orderCategories(pieBase, ap.categorySort, {
            dimKey: "name",
            valueKey: "value",
          }) as typeof pieBase)
        : pieBase;
    // Fatia: cor manual > regra/escala condicional (sobre o valor plotado) >
    // paleta.
    const pieDomains = chartCondActive
      ? scaleDomains(pieData, chartCond?.scales, (r, target) =>
          target === metricKey ? r.value : undefined
        )
      : {};
    const sliceFill = (i: number) =>
      ap.sliceColors?.[i] ??
      (chartCondActive
        ? evalConditional(chartCond, metricKey, pieData[i]?.value, {
            domain: pieDomains[metricKey],
          })?.fill
        : undefined) ??
      paletteColor(ap.palette, i);
    const sliceOpacity = (i: number) =>
      ap.fillMode === "gradient" ? gradientOpacity(i, pieData.length) : 1;
    // Comparação no tooltip: topWithOther colapsa p/ {name,value}, então o
    // valor comparado é reagregado por nome ("Outros" = soma do resto). Sem
    // série fantasma em pizza/funil.
    const cmpByName = (() => {
      if (!cmp) return null;
      const inTop = new Set(pieData.map((p) => p.name));
      const map = new Map<string, { sum: number; any: boolean }>();
      const add = (name: string, v: number | null | undefined) => {
        const e = map.get(name) ?? { sum: 0, any: false };
        if (v != null && Number.isFinite(v)) {
          e.sum += v;
          e.any = true;
        }
        map.set(name, e);
      };
      for (const r of rows as WidgetRow[]) {
        const name = String(r[dimKey] ?? "—");
        add(inTop.has(name) ? name : "Outros", r.__cmp?.[metricKey]);
      }
      return map;
    })();
    const pieTotal = pieData.reduce(
      (s, p) => s + (Number.isFinite(p.value) ? p.value : 0),
      0
    );
    const pieLabelList = ap.dataLabels?.show ? (
      <LabelList
        dataKey="value"
        position={
          visualType === "funil"
            ? "center"
            : ap.dataLabels.position === "inside"
              ? "inside"
              : "outside"
        }
        stroke="none"
        fill={ap.dataLabels.color ?? "var(--foreground)"}
        fontSize={chartPx}
        formatter={(v: unknown) => dataLabelText(v, metricKey, pieTotal)}
      />
    ) : null;
    const pieTooltip = (v: unknown, payload: unknown): string => {
      const text = moneyChartText(v, metricKey);
      if (!cmp || !cmpByName) return text;
      const name = String(
        (payload as { name?: unknown } | undefined)?.name ?? "—"
      );
      const e = cmpByName.get(name);
      const vr = computeVariation(numOrNull(v), e?.any ? e.sum : null);
      if (!vr) return text;
      return `${text} · ${variationGlyph(vr.dir)} ${formatVariation(
        vr,
        cmp.settings.format ?? "pct"
      )} ${cmp.label}`;
    };

    if (visualType === "funil") {
      return withBg(
        <FunnelChart>
          <Tooltip
            formatter={(v, _n, item) =>
              pieTooltip(v, (item as { payload?: unknown })?.payload)
            }
          />
          <Funnel dataKey="value" data={pieData} isAnimationActive={false}>
            <LabelList
              position="right"
              dataKey="name"
              stroke="none"
              fill="var(--foreground)"
              fontSize={chartPx}
            />
            {pieLabelList}
            {pieData.map((_, i) => (
              <Cell key={i} fill={sliceFill(i)} fillOpacity={sliceOpacity(i)} />
            ))}
          </Funnel>
        </FunnelChart>
      );
    }

    return withBg(
      <PieChart>
        <Tooltip
          formatter={(v, _n, item) =>
            pieTooltip(v, (item as { payload?: unknown })?.payload)
          }
        />
        {/* Pizza: legenda default LIGADA (?? true) — o default por nº de
            métricas do showLegend apagaria a legenda das pizzas existentes. */}
        {(ap.legend?.show ?? true) ? (
          <Legend wrapperStyle={legendStyle} />
        ) : null}
        <Pie
          data={pieData}
          dataKey="value"
          nameKey="name"
          innerRadius="45%"
          outerRadius="75%"
          paddingAngle={2}
          isAnimationActive={false}
        >
          {pieLabelList}
          {pieData.map((_, i) => (
            <Cell key={i} fill={sliceFill(i)} fillOpacity={sliceOpacity(i)} />
          ))}
        </Pie>
      </PieChart>
    );
  }

  // --- categorias (barra/linha): ordem manual ou ordenação, e chips editáveis ---
  const catName = (r: Record<string, unknown>) => String(r[dimKey] ?? "—");
  // Séries a plotar (linha/barra): sob o pivot, uma por (sub-base × métrica);
  // senão, uma por métrica — descritor idêntico ao mapeamento clássico.
  const plotSeries = pivot
    ? pivot.series
    : metrics.map((m, i) => ({
        dataKey: m.key,
        cmpKey: `${m.key}__cmp`,
        base: m.label,
        baseIndex: i,
        metricKey: m.key,
        name: m.label,
        lastInStack: i === metrics.length - 1,
      }));
  const pivotStacked = pivot?.mode === "stacked";
  // Top-N + "Outros" (categoryLimit) nas barras, ANTES de ordenar — a linha
  // sintética "Outros" participa da ordenação/cores pelo nome. Linha (série
  // temporal) fica de fora do corte. Sob o pivot, o rank/corte usa o TOTAL da
  // categoria (soma entre sub-bases), nunca uma série isolada.
  const limitedRows =
    ap.categoryLimit?.n != null &&
    (visualType === "barra" || visualType === "barra_horizontal")
      ? limitCategories(
          plotRows,
          dimKey,
          pivot
            ? [
                ...pivot.series.map((s) => s.dataKey),
                ...metrics.map((m) => subSeriesCatTotalKey(m.key)),
              ]
            : metrics.map((m) => m.key),
          ap.categoryLimit,
          pivot ? subSeriesCatTotalKey(metrics[0]?.key ?? "metric_1") : undefined
        )
      : plotRows;
  const sortValueKeyOf = (metricKey: string): string =>
    pivot ? subSeriesCatTotalKey(metricKey) : metricKey;
  const chartRows = ap.categorySort
    ? orderCategories(limitedRows, ap.categorySort, {
        dimKey,
        valueKey: sortValueKeyOf(ap.categorySort.metric ?? metrics[0]?.key),
        fillOf: (r) => ap.categoryColors?.[catName(r)]?.fill,
      })
    : ap.categoryOrder
      ? applyManualOrder(limitedRows, ap.categoryOrder, catName)
      : limitedRows;
  const catNames = chartRows.map(catName);
  // Total da série sobre as categorias plotadas — denominador do formato
  // percentual dos rótulos de dados (barra/linha).
  const seriesTotal = (key: string): number =>
    chartRows.reduce((s, r) => {
      const n = numOrNull(r[key]);
      return n == null ? s : s + n;
    }, 0);

  // Rótulo de variação nos pontos/barras (comparison.chartLabels): renderizado
  // como <text> SVG posicionado pelo LabelList (content custom) e colorido pelo
  // tom da variação. Com dataLabels ligado, desloca p/ dentro p/ não sobrepor.
  const renderVarLabel = (props: unknown, key: string): React.ReactElement => {
    if (!cmp) return <g />;
    const { x, y, width, height, index } = props as {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      index?: number;
    };
    if (index == null || !chartRows[index]) return <g />;
    const r = chartRows[index] as WidgetRow;
    const vr = computeVariation(
      numOrNull(r[key]),
      r.__cmp?.[key] == null ? null : Number(r.__cmp[key])
    );
    if (!vr) return <g />;
    const fill = variationFill(variationTone(vr, cmp.settings.invertColors));
    const text = `${variationGlyph(vr.dir)} ${formatVariation(vr, cmp.settings.format ?? "pct")}`;
    const hasDataLabels = Boolean(ap.dataLabels?.show);
    if (visualType === "barra_horizontal") {
      const tx = (x ?? 0) + (width ?? 0) + (hasDataLabels ? 44 : 4);
      const ty = (y ?? 0) + (height ?? 0) / 2 + 3;
      return (
        <text x={tx} y={ty} fontSize={Math.max(9, chartPx - 1)} fill={fill}>
          {text}
        </text>
      );
    }
    const tx = (x ?? 0) + (width ?? 0) / 2;
    const ty = (y ?? 0) - (hasDataLabels ? 16 : 4);
    return (
      <text x={tx} y={ty} textAnchor="middle" fontSize={Math.max(9, chartPx - 1)} fill={fill}>
        {text}
      </text>
    );
  };

  function wrapCat(chartEl: React.ReactNode) {
    if (!editable) return withBg(chartEl);
    return (
      <div className="group flex h-full flex-col">
        <CategoryEditor
          names={catNames}
          appearance={ap}
          onChange={change}
          allowValueSort={!dimChrono}
        />
        <div className="min-h-0 flex-1">{withBg(chartEl)}</div>
      </div>
    );
  }

  if (visualType === "linha") {
    return wrapCat(
      <LineChart data={chartRows} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          horizontal={grid.horizontal}
          vertical={grid.vertical}
        />
        <XAxis dataKey={dimKey} {...axisProps} />
        <YAxis
          yAxisId="left"
          {...axisProps}
          width={axisW}
          tickFormatter={yTickFormatter}
        />
        {hasRightAxis ? (
          <YAxis
            yAxisId="right"
            orientation="right"
            {...axisProps}
            width={axisW}
          />
        ) : null}
        <Tooltip
          formatter={(v, _n, item) =>
            chartTooltipText(
              v,
              String((item as { dataKey?: unknown })?.dataKey ?? ""),
              (item as { payload?: unknown })?.payload
            )
          }
        />
        {showLegend ? <Legend wrapperStyle={legendStyle} /> : null}
        {ghost
          ? plotSeries.map((s) => (
              <Line
                key={s.cmpKey}
                yAxisId={axisOf(s.metricKey)}
                type="monotone"
                dataKey={s.cmpKey}
                name={`${s.name} (comparação)`}
                stroke={resolveSeriesColor(ap, s.dataKey, s.baseIndex)}
                strokeWidth={2}
                strokeDasharray="4 4"
                strokeOpacity={0.55}
                dot={false}
                isAnimationActive={false}
              />
            ))
          : null}
        {plotSeries.map((s) => (
          <Line
            key={s.dataKey}
            yAxisId={axisOf(s.metricKey)}
            type="monotone"
            dataKey={s.dataKey}
            name={s.name}
            stroke={resolveSeriesColor(ap, s.dataKey, s.baseIndex)}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          >
            {ap.dataLabels?.show ? (
              <LabelList
                dataKey={s.dataKey}
                position={
                  ap.dataLabels.position === "bottom" ? "bottom" : "top"
                }
                fill={ap.dataLabels.color ?? "var(--foreground)"}
                fontSize={chartPx}
                formatter={(v: unknown) =>
                  dataLabelText(v, s.dataKey, seriesTotal(s.dataKey))
                }
              />
            ) : null}
          </Line>
        ))}
        {goal ? (
          <Line
            key="__goal"
            yAxisId="left"
            type="monotone"
            dataKey="__goal"
            name={goal.label}
            stroke={goal.color ?? "var(--muted-foreground)"}
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            isAnimationActive={false}
          />
        ) : null}
      </LineChart>
    );
  }

  // barra + barra_horizontal
  const horizontal = visualType === "barra_horizontal";
  // Sob o pivot nunca é série única: cada sub-base tem cor de série própria
  // (cores por categoria/condicional por coluna não se aplicam).
  const singleSeries = metrics.length === 1 && !pivot;
  const hasCatColors = Object.keys(ap.categoryColors ?? {}).length > 0;
  // Formatação condicional nas barras (série única): regra/escala sobre o
  // valor plotado colore a barra; cor manual de categoria vence a regra.
  const barDomains = chartCondActive
    ? scaleDomains(chartRows, chartCond?.scales)
    : {};
  const barCondFill = (
    r: Record<string, unknown>,
    key: string
  ): string | undefined => {
    if (!chartCondActive) return undefined;
    const rw = r as WidgetRow;
    return evalConditional(chartCond, key, r[key], {
      variation: cmp
        ? computeVariation(
            numOrNull(r[key]),
            rw.__cmp?.[key] == null ? null : Number(rw.__cmp[key])
          )
        : null,
      domain: barDomains[key],
    })?.fill;
  };

  // Com linha de meta ativa, o container vira ComposedChart (o BarChart do
  // Recharts não desenha <Line>); sem meta, BarChart original — troca
  // condicional p/ zero risco de regressão nos widgets existentes.
  const BarContainer = goal ? ComposedChart : BarChart;
  return wrapCat(
    <BarContainer
      data={chartRows}
      layout={horizontal ? "vertical" : "horizontal"}
      margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
    >
      <CartesianGrid
        strokeDasharray="3 3"
        stroke="var(--border)"
        horizontal={grid.horizontal}
        vertical={grid.vertical}
      />
      {horizontal ? (
        <>
          <XAxis type="number" {...axisProps} tickFormatter={yTickFormatter} />
          <YAxis type="category" dataKey={dimKey} {...axisProps} width={axisWCat} />
        </>
      ) : (
        <>
          <XAxis dataKey={dimKey} {...axisProps} />
          <YAxis
            yAxisId="left"
            {...axisProps}
            width={axisW}
            tickFormatter={yTickFormatter}
          />
          {hasRightAxis ? (
            <YAxis
              yAxisId="right"
              orientation="right"
              {...axisProps}
              width={axisW}
            />
          ) : null}
        </>
      )}
      <Tooltip
        formatter={(v, _n, item) =>
          chartTooltipText(
            v,
            String((item as { dataKey?: unknown })?.dataKey ?? ""),
            (item as { payload?: unknown })?.payload
          )
        }
        cursor={{ fill: "var(--muted)" }}
      />
      {showLegend ? <Legend wrapperStyle={legendStyle} /> : null}
      {ghost
        ? plotSeries.map((s) => (
            <Bar
              key={s.cmpKey}
              {...(horizontal ? {} : { yAxisId: axisOf(s.metricKey) })}
              {...(pivotStacked
                ? { stackId: `cmp:${s.metricKey}` }
                : ap.stacked
                  ? { stackId: "cmp" }
                  : {})}
              dataKey={s.cmpKey}
              name={`${s.name} (comparação)`}
              fill={resolveSeriesColor(ap, s.dataKey, s.baseIndex)}
              fillOpacity={0.35}
              radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
              isAnimationActive={false}
            />
          ))
        : null}
      {plotSeries.map((s) => {
        const base = resolveSeriesColor(ap, s.dataKey, s.baseIndex);
        // Cor por categoria (colorByCategory, série única): cada barra pega a
        // cor do seu ÍNDICE na paleta do widget (mesmo mecanismo das fatias de
        // pizza) — barras de fontes/categorias diferentes ficam distinguíveis.
        // Off por padrão; cor manual (categoryColors) e condicional vencem.
        const colorByCat = Boolean(ap.colorByCategory) && singleSeries;
        const perColumn =
          singleSeries &&
          (colorByCat ||
            ap.fillMode === "gradient" ||
            hasCatColors ||
            chartCondActive);
        // Empilhado: um stack único (métricas) ou, sob o pivot, um stack POR
        // MÉTRICA (as sub-bases empilham dentro dele); só o segmento do topo
        // mantém o canto arredondado.
        const stacked = pivotStacked || Boolean(ap.stacked);
        const radius: [number, number, number, number] =
          stacked && !s.lastInStack
            ? [0, 0, 0, 0]
            : horizontal
              ? [0, 4, 4, 0]
              : [4, 4, 0, 0];
        return (
          <Bar
            key={s.dataKey}
            {...(horizontal ? {} : { yAxisId: axisOf(s.metricKey) })}
            {...(pivotStacked
              ? { stackId: `s:${s.metricKey}` }
              : ap.stacked
                ? { stackId: "s" }
                : {})}
            dataKey={s.dataKey}
            name={s.name}
            fill={base}
            radius={radius}
            isAnimationActive={false}
          >
            {perColumn
              ? chartRows.map((r, idx) => (
                  <Cell
                    key={idx}
                    fill={
                      ap.categoryColors?.[catName(r)]?.fill ??
                      barCondFill(r, s.dataKey) ??
                      (colorByCat ? paletteColor(ap.palette, idx) : base)
                    }
                    fillOpacity={
                      ap.fillMode === "gradient"
                        ? gradientOpacity(idx, chartRows.length)
                        : 1
                    }
                  />
                ))
              : null}
            {ap.dataLabels?.show ? (
              <LabelList
                dataKey={s.dataKey}
                position={
                  ap.dataLabels.position === "inside"
                    ? "inside"
                    : horizontal
                      ? "right"
                      : "top"
                }
                fill={ap.dataLabels.color ?? "var(--foreground)"}
                fontSize={chartPx}
                formatter={(v: unknown) =>
                  dataLabelText(v, s.dataKey, seriesTotal(s.dataKey))
                }
              />
            ) : null}
            {cmp?.settings.chartLabels ? (
              <LabelList
                dataKey={s.dataKey}
                content={(p) => renderVarLabel(p, s.dataKey)}
              />
            ) : null}
          </Bar>
        );
      })}
      {goal ? (
        <Line
          key="__goal"
          {...(horizontal ? {} : { yAxisId: "left" })}
          type="monotone"
          dataKey="__goal"
          name={goal.label}
          stroke={goal.color ?? "var(--muted-foreground)"}
          strokeWidth={2}
          strokeDasharray="6 4"
          dot={false}
          isAnimationActive={false}
        />
      ) : null}
    </BarContainer>
  );
});

// ---------------- Tabela agregada com aparência + edição in-loco ----------------
type TableMenu =
  | { kind: "ctx"; x: number; y: number; column: string; rowKey?: string; scopes: ColorScope[]; isDate: boolean; group?: boolean }
  | { kind: "color"; x: number; y: number; scope: ColorScope; column: string; rowKey?: string; group?: boolean }
  | { kind: "colorOrder"; x: number; y: number; column: string };

function AppearanceTable({
  data,
  appearance,
  editable,
  dateFormat,
  metricByKey,
  onChange,
}: {
  data: WidgetData;
  appearance: AppearanceSettings;
  editable: boolean;
  dateFormat: DateFormat;
  metricByKey: Record<string, Metric>;
  onChange: (a: AppearanceSettings) => void;
}) {
  const t = appearance.table ?? {};
  // Fonte do corpo da tabela (appearance.fonts.table × escala do dashboard):
  // aplicada no <table>; th/td herdam. Auto + escala 1 ⇒ undefined.
  const fontScale = useFontScale();
  const tableStyle = fontStyle(
    appearance.fonts?.table,
    FONT_DEFAULTS.table,
    fontScale
  );
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [dragRow, setDragRow] = useState<string | null>(null);
  const [menu, setMenu] = useState<TableMenu | null>(null);
  // Grupos EXPANDIDOS no "Agrupar por" (efêmero). Vazio = tudo colapsado, então a
  // visualização padrão de uma tabela agrupada abre sempre recolhida.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const metricKeys = new Set(data.metrics.map((m) => m.key));
  const moneyKeys = new Set(
    data.metrics.filter((m) => m.isMoney).map((m) => m.key)
  );
  const dimKeys = data.dimensions.map((d) => d.key);

  const calcByKey: Record<string, CalcMeta> = {};
  data.metrics.forEach((m) => {
    if (m.calc) calcByKey[m.key] = m.calc;
  });

  // Percentual por métrica (ver buildPercentModes): pré-computado uma vez.
  const percentModeByKey = buildPercentModes(data.metrics, metricByKey);
  const percentModeOf = (key: string): PercentMode =>
    percentModeByKey[key] ?? null;
  const pfmt = (v: unknown, key: string, decimals?: number): string => {
    const mode = percentModeOf(key);
    return mode ? formatPercent(v, mode === "x100", decimals) : fmt(v, decimals);
  };
  // Casas decimais efetivas de uma célula (célula > linha > coluna > widget).
  const decOf = (column: string, rowKey?: string): number | undefined =>
    resolveDecimals(appearance, { column, rowKey });

  // --- Comparação com período anterior (WidgetData.comparison) ---
  // "inline": badge dentro da célula da métrica; "column": colunas virtuais
  // `<metric>__var` (e `<metric>__cmp` com "exibir valor") após cada métrica —
  // colKeys novos participam de largura/cor/ordem como qualquer coluna.
  const cmp = data.comparison;
  // Modo transposto fica sem variação no v1 (as colunas viram eixo).
  const transposed = t.orientation === "columns";
  const cmpInline =
    cmp && !transposed && (cmp.settings.tablePlacement ?? "inline") === "inline";
  const cmpColumns =
    cmp && !transposed && cmp.settings.tablePlacement === "column";
  const varBaseOf = (key: string): string | null =>
    key.endsWith("__var") ? key.slice(0, -5) : null;
  const cmpBaseOf = (key: string): string | null =>
    key.endsWith("__cmp") ? key.slice(0, -5) : null;
  // Moeda de exibição da série (mesma decisão do valor plotado pelo engine):
  // formata o valor comparado/variação absoluta na escala da métrica.
  const seriesCodeOf = (key: string): string => {
    if ((metricByKey[key]?.currencyDisplay ?? "original") !== "original")
      return "BRL";
    let code: string | null = null;
    for (const r of data.rows as WidgetRow[]) {
      const bd = r.__money?.[key];
      if (!bd) continue;
      const c = plotSingleCurrency(bd);
      if (c == null || (code != null && c !== code)) return "BRL";
      code = c;
    }
    return code ?? "BRL";
  };
  const absFmtOf = (key: string, decimals?: number) => (n: number) =>
    moneyKeys.has(key)
      ? formatMoney(n, seriesCodeOf(key), decimals)
      : pfmt(n, key, decimals);
  const cmpValOf = (r: Record<string, unknown>, key: string): number | null => {
    const v = (r as WidgetRow).__cmp?.[key];
    return v == null ? null : Number(v);
  };
  // Soma dos valores comparados de um escopo (subtotais); null quando nenhuma
  // linha tem valor comparável.
  const sumCmp = (
    rs: Record<string, unknown>[],
    key: string
  ): number | null => {
    let any = false;
    let sum = 0;
    for (const r of rs) {
      const v = cmpValOf(r, key);
      if (v != null) {
        any = true;
        sum += v;
      }
    }
    return any ? sum : null;
  };

  // --- Formatação condicional (appearance.conditional) ---
  const cond = appearance.conditional;
  const condActive = hasConditional(cond);
  // Valor avaliável de um alvo numa linha (colunas virtuais de variação usam a
  // variação absoluta; __cmp usa o valor comparado).
  const condValueOf = (r: Record<string, unknown>, target: string): unknown => {
    const vb = varBaseOf(target);
    if (vb) {
      const cur = numOrNull(r[vb]);
      const prev = cmpValOf(r, vb);
      return cur != null && prev != null ? cur - prev : null;
    }
    const cb = cmpBaseOf(target);
    if (cb) return cmpValOf(r, cb);
    return r[target];
  };
  const condDomains = condActive
    ? scaleDomains(data.rows, cond?.scales, condValueOf)
    : {};
  // var_up/var_down avaliam a variação da métrica-base do alvo.
  const variationOf = (r: Record<string, unknown>, target: string) => {
    const vBase = varBaseOf(target) ?? (metricKeys.has(target) ? target : null);
    return cmp && vBase
      ? computeVariation(numOrNull(r[vBase]), cmpValOf(r, vBase))
      : null;
  };
  const condStyleOf = (
    r: Record<string, unknown>,
    colKey: string
  ): ResolvedCondStyle | null => {
    if (!condActive) return null;
    return evalConditional(cond, colKey, condValueOf(r, colKey), {
      variation: variationOf(r, colKey),
      domain: condDomains[colKey],
    });
  };

  // Célula de métrica: calculada de agregados reavalia a fórmula da basis da
  // linha (moeda automática preservada / fixa convertida; null → "—"); monetária
  // honra a config de moeda (via __money); demais caem no fmt numérico. Mesma
  // formatação do modo registros.
  const metricCellText = (
    r: Record<string, unknown>,
    key: string,
    decimals?: number
  ): string => {
    const calc = calcByKey[key];
    if (calc) return calcCellText(r, key, calc, percentModeOf(key), decimals);
    const bd = (r as WidgetRow).__money?.[key];
    const cfg = metricByKey[key];
    if (moneyKeys.has(key) && bd && cfg)
      return formatMoneyAggregate(bd, cfg, false, decimals);
    return pfmt(r[key], key, decimals);
  };
  // Subtotal/Total geral de uma métrica sobre `rs`: calculada de agregados
  // REAVALIA a fórmula sobre as basis fundidas do escopo (nunca soma a coluna);
  // monetária funde os __money e formata (isGrand usa o modo do Total geral);
  // demais somam numérico.
  const metricAggCellText = (
    rs: Record<string, unknown>[],
    key: string,
    isGrand: boolean,
    decimals?: number
  ): string => {
    const calc = calcByKey[key];
    if (calc) return calcAggText(rs, key, calc, percentModeOf(key), decimals);
    const cfg = metricByKey[key];
    if (moneyKeys.has(key) && cfg) {
      const folded = foldBreakdowns(rs.map((r) => (r as WidgetRow).__money?.[key]));
      return formatMoneyAggregate(folded, cfg, isGrand, decimals);
    }
    return pfmt(sumMetric(rs, key), key, decimals);
  };
  const allCols = [
    ...data.dimensions.map((d) => ({ key: d.key, label: d.label })),
    ...data.metrics.flatMap((m) => {
      const entry = [{ key: m.key, label: m.label }];
      if (cmpColumns) {
        if (cmp!.settings.showBaseValue)
          entry.push({ key: `${m.key}__cmp`, label: `${m.label} (comparação)` });
        entry.push({ key: `${m.key}__var`, label: `Δ ${m.label}` });
      }
      return entry;
    }),
  ];
  const cols = applyManualOrder(allCols, t.columnOrder, (c) => c.key);
  const rowKey = (r: Record<string, unknown>) => rowKeyOf(r, dimKeys);

  // Ordenação (sort) tem precedência sobre a ordem manual de linhas.
  const rows = t.sort?.column
    ? sortRows(data.rows, t.sort, (r) => t.rowColors?.[rowKey(r)]?.fill)
    : applyManualOrder(data.rows, t.rowOrder, rowKey);

  // Sem colunas (dados vazios/erro engolido) ou sem linhas: estado vazio, como
  // nos gráficos (guard de `rows`) e no RecordListTable — nunca uma tabela nua.
  if (allCols.length === 0 || rows.length === 0) return <EmptyState />;

  const distinctRowFills = distinctFills(
    rows.map((r) => t.rowColors?.[rowKey(r)]?.fill)
  );

  // Regras condicionais com escopo linha/coluna: pré-passe sobre as linhas
  // visíveis (uma vez por render, como condDomains). Subtotais e transposta
  // ficam fora (paridade com o condicional por célula atual).
  const scopedCond = condActive
    ? evalScopedConditional(cond, rows, rowKey, condValueOf, variationOf)
    : { row: {}, col: {} };

  const gl = t.gridLines ?? "both";
  const vertical = gl === "vertical" || gl === "both";
  const horizontal = gl === "horizontal" || gl === "both";
  const borderColor = t.borderColor;
  const rowBorder = horizontal ? "" : "border-b-0";
  const cellBorder = (last: boolean) =>
    vertical && !last
      ? { borderRight: `1px solid ${borderColor ?? "var(--border)"}` }
      : {};

  const setTable = (patch: Partial<NonNullable<AppearanceSettings["table"]>>) =>
    onChange({ ...appearance, table: { ...t, ...patch } });

  function setColor(m: { scope: ColorScope; column: string; rowKey?: string; group?: boolean }, cp: ColorPair) {
    const clear = !cp.fill && !cp.text;
    if (m.scope === "col") {
      // Coluna a partir de uma linha de grupo grava num mapa dedicado, lido só
      // pelas linhas de grupo — não pinta as linhas de dados.
      const field = m.group ? "groupColColors" : "colColors";
      const map = { ...(t[field] ?? {}) };
      if (clear) delete map[m.column];
      else map[m.column] = cp;
      setTable({ [field]: map });
    } else if (m.scope === "row" && m.rowKey) {
      const map = { ...(t.rowColors ?? {}) };
      if (clear) delete map[m.rowKey];
      else map[m.rowKey] = cp;
      setTable({ rowColors: map });
    } else if (m.scope === "cell" && m.rowKey) {
      const map = { ...(t.cellColors ?? {}) };
      const k = `${m.rowKey}:${m.column}`;
      if (clear) delete map[k];
      else map[k] = cp;
      setTable({ cellColors: map });
    }
  }

  function colorValue(m: { scope: ColorScope; column: string; rowKey?: string; group?: boolean }): ColorPair {
    if (m.scope === "col")
      return (m.group ? t.groupColColors : t.colColors)?.[m.column] ?? {};
    if (m.scope === "row" && m.rowKey) return t.rowColors?.[m.rowKey] ?? {};
    if (m.scope === "cell" && m.rowKey)
      return t.cellColors?.[`${m.rowKey}:${m.column}`] ?? {};
    return {};
  }

  // Alinhamento por escopo (linha/coluna/célula), espelhando setColor/colorValue.
  // Linhas de grupo compartilham o colAlign das linhas de dados.
  function setAlign(
    m: { scope: ColorScope; column: string; rowKey?: string },
    a: TableAlign | undefined
  ) {
    if (m.scope === "col") {
      const map = { ...(t.colAlign ?? {}) };
      if (!a) delete map[m.column];
      else map[m.column] = a;
      setTable({ colAlign: map });
    } else if (m.scope === "row" && m.rowKey) {
      const map = { ...(t.rowAlign ?? {}) };
      if (!a) delete map[m.rowKey];
      else map[m.rowKey] = a;
      setTable({ rowAlign: map });
    } else if (m.scope === "cell" && m.rowKey) {
      const map = { ...(t.cellAlign ?? {}) };
      const k = `${m.rowKey}:${m.column}`;
      if (!a) delete map[k];
      else map[k] = a;
      setTable({ cellAlign: map });
    }
  }
  function alignValue(m: { scope: ColorScope; column: string; rowKey?: string }): TableAlign | undefined {
    if (m.scope === "col") return t.colAlign?.[m.column];
    if (m.scope === "row" && m.rowKey) return t.rowAlign?.[m.rowKey];
    if (m.scope === "cell" && m.rowKey) return t.cellAlign?.[`${m.rowKey}:${m.column}`];
    return undefined;
  }

  // Casas decimais por escopo (linha/coluna/célula), espelhando setAlign.
  function setDecimals(
    m: { scope: ColorScope; column: string; rowKey?: string },
    d: number | undefined
  ) {
    if (m.scope === "col") {
      const map = { ...(t.colDecimals ?? {}) };
      if (d == null) delete map[m.column];
      else map[m.column] = d;
      setTable({ colDecimals: map });
    } else if (m.scope === "row" && m.rowKey) {
      const map = { ...(t.rowDecimals ?? {}) };
      if (d == null) delete map[m.rowKey];
      else map[m.rowKey] = d;
      setTable({ rowDecimals: map });
    } else if (m.scope === "cell" && m.rowKey) {
      const map = { ...(t.cellDecimals ?? {}) };
      const k = `${m.rowKey}:${m.column}`;
      if (d == null) delete map[k];
      else map[k] = d;
      setTable({ cellDecimals: map });
    }
  }
  function decimalsValue(m: {
    scope: ColorScope;
    column: string;
    rowKey?: string;
  }): number | undefined {
    if (m.scope === "col") return t.colDecimals?.[m.column];
    if (m.scope === "row" && m.rowKey) return t.rowDecimals?.[m.rowKey];
    if (m.scope === "cell" && m.rowKey)
      return t.cellDecimals?.[`${m.rowKey}:${m.column}`];
    return undefined;
  }

  // Datas: uma coluna (dimensão) é "de data" se algum valor parece ISO. Formato
  // efetivo = override por coluna (t.dateFormats) ou padrão do dashboard.
  const dateCols = new Set<string>();
  for (const c of allCols) {
    if (metricKeys.has(c.key)) continue;
    if (data.rows.some((r) => looksLikeDate(r[c.key]))) dateCols.add(c.key);
  }
  const fmtOf = (key: string): DateFormat => t.dateFormats?.[key] ?? dateFormat;
  const dimDisplay = (v: unknown, key: string): string =>
    dateCols.has(key) && looksLikeDate(v)
      ? formatDateValue(v, fmtOf(key))
      : String(v ?? "—");
  // Largura de coluna: fixa quando redimensionada; senão um teto para o texto não
  // empurrar/sobrepor as vizinhas (o recorte/quebra é feito no span interno).
  const widthStyle = (key: string): React.CSSProperties => {
    const w = t.colWidths?.[key];
    return w ? { width: w, minWidth: w, maxWidth: w } : { maxWidth: 240 };
  };
  // Classe do conteúdo interno da célula: cortar (…) ou quebrar linha.
  const cellText = t.cellText ?? "clip";
  const cellSpanClass =
    cellText === "wrap"
      ? "block whitespace-normal break-words"
      : "block truncate";
  const setColWidth = (key: string, w: number) =>
    setTable({ colWidths: { ...(t.colWidths ?? {}), [key]: w } });
  const setRowHeight = (key: string, h: number) =>
    setTable({ rowHeights: { ...(t.rowHeights ?? {}), [key]: h } });
  const setColDateFormat = (key: string, f: DateFormat) =>
    setTable({ dateFormats: { ...(t.dateFormats ?? {}), [key]: f } });

  function openCtx(
    e: React.MouseEvent,
    column: string,
    scopes: ColorScope[],
    rk?: string,
    group = false
  ) {
    if (!editable) return;
    setMenu({
      kind: "ctx",
      x: e.clientX,
      y: e.clientY,
      column,
      rowKey: rk,
      scopes,
      // Linhas de grupo não têm formato de data — só cor.
      isDate: group ? false : dateCols.has(column),
      group,
    });
  }

  // --- Orientação / agrupamento (Parte 2/3) ---
  const orientation = t.orientation === "columns" ? "columns" : "rows";
  // "Agrupar por" só se aplica na orientação normal e às keys que ainda existem
  // (podem ter ficado órfãs se as dimensões mudaram). Lista ordenada = hierarquia.
  const groupLevels =
    orientation === "rows"
      ? groupByLevels(t.groupBy).filter((k) => dimKeys.includes(k))
      : [];
  // Rótulo/chave de um grupo. Colunas de data honram o formato configurado (mesma
  // formatação da célula via `fmtOf`), para o cabeçalho bater com a célula e as
  // linhas de mesmo formato (ex.: `mm/aa` → mesmo mês) caírem no mesmo grupo.
  const groupLabelOf = (v: unknown, key: string): string =>
    dateCols.has(key) && looksLikeDate(v)
      ? formatDateValue(v, fmtOf(key))
      : v == null || v === "" ? "—" : String(v);
  // "Formato do grupo" (t.groupDateFormats): override por nível do "Agrupar
  // por". Só vale quando a célula ainda carrega o ISO cru — dims com transform
  // "por nome" viram rótulo no engine, ficam fora de dateCols e o setting
  // órfão fica inerte.
  const groupFmtOf = (key: string): GroupDateFormat | undefined => {
    const v = t.groupDateFormats?.[key];
    return v && dateCols.has(key) && isGroupDateFormat(v) ? v : undefined;
  };
  // Célula de grupo: chave de fusão + rótulo + sort cronológico (só override).
  // Sem override, k === label — chaves de nós/cores existentes inalteradas.
  const groupCellOf = (
    v: unknown,
    key: string
  ): { k: string; label: string; sort?: number } => {
    const gf = groupFmtOf(key);
    if (gf) {
      const b = bucketGroupDate(v, gf);
      return { k: b.key, label: b.label, sort: b.sort };
    }
    const label = groupLabelOf(v, key);
    return { k: label, label };
  };
  // Subtotal de uma métrica sobre um conjunto de linhas (soma; exato p/ count/sum,
  // aproximado p/ avg/min/max — ver plano).
  const sumMetric = (rs: Record<string, unknown>[], key: string) =>
    rs.reduce((s, r) => {
      const n = Number(r[key]);
      return Number.isNaN(n) ? s : s + n;
    }, 0);
  // Achata a hierarquia numa lista de itens, respeitando quais grupos estão
  // expandidos. A chave inclui o caminho (prefixo) p/ não confundir grupos
  // homônimos em ramos diferentes.
  type GroupItem =
    | { kind: "group"; level: number; key: string; label: string; rows: Record<string, unknown>[] }
    | { kind: "data"; row: Record<string, unknown> };
  const buildGroupItems = (
    rs: Record<string, unknown>[],
    levels: string[],
    depth: number,
    prefix: string
  ): GroupItem[] => {
    if (levels.length === 0)
      return rs.map((r) => ({ kind: "data" as const, row: r }));
    const [key, ...rest] = levels;
    const byKey = new Map<
      string,
      { label: string; sort: number; rows: Record<string, unknown>[] }
    >();
    const order: string[] = [];
    for (const r of rs) {
      const cell = groupCellOf(r[key], key);
      let g = byKey.get(cell.k);
      if (!g) {
        g = { label: cell.label, sort: cell.sort ?? 0, rows: [] };
        byKey.set(cell.k, g);
        order.push(cell.k);
      }
      g.rows.push(r);
    }
    // Com "Formato do grupo", ordena cronologicamente pelo sort do bucket
    // (vazios "—" com Infinity por último); sem, ordem de inserção (linhas
    // pré-ordenadas a montante).
    if (groupFmtOf(key))
      order.sort((a, b) => byKey.get(a)!.sort - byKey.get(b)!.sort);
    const items: GroupItem[] = [];
    for (const gk of order) {
      const g = byKey.get(gk)!;
      const k = `${prefix}›${gk}`;
      items.push({ kind: "group", level: depth, key: k, label: g.label, rows: g.rows });
      if (expanded.has(k))
        items.push(...buildGroupItems(g.rows, rest, depth + 1, k));
    }
    return items;
  };
  const groupItems: GroupItem[] =
    groupLevels.length > 0 ? buildGroupItems(rows, groupLevels, 0, "") : [];

  // Renderiza uma linha de dados (reutilizada nos modos plano e agrupado).
  const renderDataRow = (r: Record<string, unknown>) => {
    const rk = rowKey(r);
    const rowCp = t.rowColors?.[rk];
    const rh = t.rowHeights?.[rk];
    return (
      <TableRow
        key={rk}
        className={rowBorder}
        style={{
          background: rowCp?.fill ?? t.bodyBg,
          color: rowCp?.text ?? t.bodyColor,
          ...(borderColor ? { borderColor } : {}),
          ...(rh ? { height: rh } : {}),
        }}
      >
        {editable ? (
          <TableCell
            className="group relative w-6 cursor-move px-1"
            draggable
            onDragStart={() => setDragRow(rk)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragRow)
                setTable({
                  rowOrder: reorderKeys(rows.map(rowKey), dragRow, rk),
                  sort: undefined,
                });
              setDragRow(null);
            }}
            title="Arraste para reordenar a linha"
          >
            <GripVertical className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
            <ResizeHandle axis="row" onResize={(hh) => setRowHeight(rk, hh)} />
          </TableCell>
        ) : null}
        {cols.map((c, ci) => {
          const isMetric = metricKeys.has(c.key);
          const varBase = varBaseOf(c.key);
          const cmpBase = cmpBaseOf(c.key);
          const isNumeric = isMetric || varBase != null || cmpBase != null;
          const cellCp = t.cellColors?.[`${rk}:${c.key}`];
          const colCp = t.colColors?.[c.key];
          // Precedência: célula manual > regra de célula > escala > regra de
          // linha > regra de coluna > linha/coluna manual > global (ver
          // lib/widgets/conditional.ts).
          const cs = condStyleOf(r, c.key);
          const scRow = scopedCond.row[rk];
          const scCol = scopedCond.col[c.key];
          const dec = decOf(c.key, rk);
          return (
            <TableCell
              key={c.key}
              className={cn(
                alignClass(resolveAlign(t, { column: c.key, rowKey: rk, numeric: isNumeric })),
                isNumeric && "tabular-nums"
              )}
              onDoubleClick={(e) => openCtx(e, c.key, ["row", "col", "cell"], rk)}
              style={{
                background:
                  cellCp?.fill ??
                  cs?.fill ??
                  scRow?.fill ??
                  scCol?.fill ??
                  colCp?.fill,
                color:
                  cellCp?.text ??
                  cs?.text ??
                  scRow?.text ??
                  scCol?.text ??
                  rowCp?.text ??
                  colCp?.text ??
                  t.bodyColor,
                ...(cs?.bold || scRow?.bold || scCol?.bold
                  ? { fontWeight: 600 }
                  : {}),
                ...cellBorder(ci === cols.length - 1),
                ...widthStyle(c.key),
                ...(cellText === "clip" ? { overflow: "hidden" } : {}),
              }}
            >
              {varBase && cmp ? (
                <VariationBadge
                  cur={numOrNull(r[varBase])}
                  prev={cmpValOf(r, varBase)}
                  settings={cmp.settings}
                  fmtAbs={absFmtOf(varBase, dec)}
                  className="text-xs"
                />
              ) : cmpBase ? (
                <span className={cellSpanClass}>
                  {cmpValOf(r, cmpBase) == null
                    ? "—"
                    : absFmtOf(cmpBase, dec)(cmpValOf(r, cmpBase)!)}
                </span>
              ) : (
                <>
                  <span className={cellSpanClass}>
                    <CondIcon style={cs} />
                    {isMetric
                      ? metricCellText(r, c.key, dec)
                      : dimDisplay(r[c.key], c.key)}
                  </span>
                  {isMetric && cmpInline ? (
                    <span className="flex flex-wrap items-center gap-x-1 text-[10px] leading-tight">
                      <VariationBadge
                        cur={numOrNull(r[c.key])}
                        prev={cmpValOf(r, c.key)}
                        settings={cmp!.settings}
                        fmtAbs={absFmtOf(c.key, dec)}
                        hideWhenUnavailable
                      />
                      {cmp!.settings.showBaseValue &&
                      cmpValOf(r, c.key) != null ? (
                        <span className="text-muted-foreground">
                          vs. {absFmtOf(c.key, dec)(cmpValOf(r, c.key)!)}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </>
              )}
            </TableCell>
          );
        })}
      </TableRow>
    );
  };

  // Linha de subtotais de um grupo (cabeçalho recolhível) ou total geral.
  const renderSubtotalRow = (
    label: string,
    rs: Record<string, unknown>[],
    opts?: {
      collapsible?: boolean;
      isCollapsed?: boolean;
      onToggle?: () => void;
      level?: number;
      keyId?: string;
      isGrand?: boolean;
    }
  ) => {
    // Chave estável da linha de grupo (inclui o caminho hierárquico) — rowKey nos
    // mapas de cor, isolada das linhas de dados pelo prefixo `__grp:`.
    const grpKey = `__grp:${opts?.keyId ?? label}`;
    const rowCp = t.rowColors?.[grpKey];
    const cellExtra = (colKey: string) => {
      const cellCp = t.cellColors?.[`${grpKey}:${colKey}`];
      const grpColCp = t.groupColColors?.[colKey];
      return {
        style: {
          background: cellCp?.fill ?? grpColCp?.fill,
          color: cellCp?.text ?? rowCp?.text ?? grpColCp?.text ?? t.headerColor,
        } as React.CSSProperties,
        onDoubleClick: editable
          ? (e: React.MouseEvent) =>
              openCtx(e, colKey, ["row", "col", "cell"], grpKey, true)
          : undefined,
      };
    };
    return (
    <TableRow
      key={grpKey}
      className={cn(rowBorder, "font-medium")}
      style={{
        background: rowCp?.fill ?? t.headerBg ?? "var(--muted)",
        color: rowCp?.text ?? t.headerColor,
        ...(borderColor ? { borderColor } : {}),
      }}
    >
      {editable ? <TableCell className="w-6 px-1" /> : null}
      {cols.map((c, ci) => {
        const isMetric = metricKeys.has(c.key);
        const varBase = varBaseOf(c.key);
        const cmpBase = cmpBaseOf(c.key);
        const isFirst = ci === 0;
        const extra = cellExtra(c.key);
        const dec = decOf(c.key, grpKey);
        // Subtotal da variação: variação dos SOMATÓRIOS cur/prev do escopo.
        // Métrica calculada fica "—" (fundir basis de comparação é extensão
        // futura); soma dos __cmp cobre soma/contagem (aprox. p/ avg/min/max,
        // como o próprio sumMetric).
        const subtotalVar = () => {
          if (!cmp || !varBase || calcByKey[varBase]) return <>—</>;
          return (
            <VariationBadge
              cur={sumMetric(rs, varBase)}
              prev={sumCmp(rs, varBase)}
              settings={cmp.settings}
              fmtAbs={absFmtOf(varBase, dec)}
              className="text-xs"
            />
          );
        };
        return (
          <TableCell
            key={c.key}
            className={cn(
              alignClass(resolveAlign(t, { column: c.key, rowKey: grpKey, numeric: isMetric || varBase != null || cmpBase != null })),
              (isMetric || varBase != null || cmpBase != null) && "tabular-nums"
            )}
            onDoubleClick={extra.onDoubleClick}
            style={{ ...cellBorder(ci === cols.length - 1), ...extra.style }}
          >
            {isFirst ? (
              <button
                type="button"
                className={cn(
                  "inline-flex items-center gap-1",
                  opts?.collapsible ? "cursor-pointer" : "cursor-default"
                )}
                style={
                  opts?.level ? { paddingLeft: opts.level * 16 } : undefined
                }
                onClick={opts?.onToggle}
                disabled={!opts?.collapsible}
              >
                {opts?.collapsible ? (
                  opts.isCollapsed ? (
                    <ChevronRight className="size-3.5 shrink-0" />
                  ) : (
                    <ChevronDown className="size-3.5 shrink-0" />
                  )
                ) : null}
                {label}
              </button>
            ) : varBase ? (
              subtotalVar()
            ) : cmpBase ? (
              sumCmp(rs, cmpBase) == null || calcByKey[cmpBase] ? (
                "—"
              ) : (
                absFmtOf(cmpBase, dec)(sumCmp(rs, cmpBase)!)
              )
            ) : isMetric ? (
              <>
                {metricAggCellText(rs, c.key, opts?.isGrand ?? false, dec)}
                {cmpInline && !calcByKey[c.key] ? (
                  <span className="ml-1 text-[10px]">
                    <VariationBadge
                      cur={sumMetric(rs, c.key)}
                      prev={sumCmp(rs, c.key)}
                      settings={cmp!.settings}
                      fmtAbs={absFmtOf(c.key, dec)}
                      hideWhenUnavailable
                    />
                  </span>
                ) : null}
              </>
            ) : null}
          </TableCell>
        );
      })}
    </TableRow>
    );
  };

  // --- Modo transposto: dimensão(ões) no canto sup. esq., cada grupo vira uma
  // coluna, métricas descem como linhas à esquerda. Interações de cor/arraste
  // ficam desativadas nesta visão (ver plano). ---
  if (orientation === "columns") {
    const dimCols = cols.filter((c) => !metricKeys.has(c.key));
    const metricCols = cols.filter((c) => metricKeys.has(c.key));
    // Com "Agrupar por" na transposta: a dimensão de `colDim` (default: a 1ª)
    // vira as colunas do topo e as demais dimensões escolhidas nos níveis viram
    // grupos no eixo esquerdo, aninhados dentro de cada métrica. `tGroupLevels`
    // exclui a dim de coluna e keys órfãs (se as dimensões mudaram).
    const colDimKey =
      t.colDim && dimKeys.includes(t.colDim) ? t.colDim : dimKeys[0];
    const tGroupLevels = groupByLevels(t.groupBy).filter(
      (k) => dimKeys.includes(k) && k !== colDimKey
    );

    if (tGroupLevels.length === 0) {
      // Sem agrupamento: comportamento antigo — todas as dimensões combinadas no
      // cabeçalho de coluna, cada linha de dados vira uma coluna.
      const cornerLabel = dimCols.map((c) => c.label).join(" · ") || "";
      const groupHeader = (r: Record<string, unknown>) =>
        dimCols.map((c) => dimDisplay(r[c.key], c.key)).join(" · ");
      return (
        <div className="h-full overflow-auto [scrollbar-gutter:stable]">
          <Table style={tableStyle}>
            <TableHeader>
              <TableRow
                className={rowBorder}
                style={{
                  background: t.headerBg,
                  color: t.headerColor,
                  ...(borderColor ? { borderColor } : {}),
                }}
              >
                <TableHead style={cellBorder(rows.length === 0)}>
                  {cornerLabel}
                </TableHead>
                {rows.map((r, ri) => (
                  <TableHead
                    key={rowKey(r)}
                    className={alignClass(
                      resolveAlign(t, { column: rowKey(r), numeric: true })
                    )}
                    style={cellBorder(ri === rows.length - 1)}
                  >
                    {groupHeader(r)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {metricCols.map((c) => (
                <TableRow
                  key={c.key}
                  className={rowBorder}
                  style={{
                    background: t.bodyBg,
                    color: t.bodyColor,
                    ...(borderColor ? { borderColor } : {}),
                  }}
                >
                  <TableHead
                    className="font-medium"
                    style={cellBorder(rows.length === 0)}
                  >
                    {c.label}
                  </TableHead>
                  {rows.map((r, ri) => (
                    <TableCell
                      key={rowKey(r)}
                      className={cn(
                        alignClass(
                          resolveAlign(t, { column: rowKey(r), rowKey: c.key, numeric: true })
                        ),
                        "tabular-nums"
                      )}
                      style={cellBorder(ri === rows.length - 1)}
                    >
                      {/* Transposta: chaves de linha/coluna invertidas — só o
                          decimal global do widget se aplica. */}
                      {metricCellText(r, c.key, appearance.decimals)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      );
    }

    // Com agrupamento: colunas = valores distintos da 1ª dimensão (na ordem em que
    // aparecem em `rows`, que já respeita sort/ordem manual). Colunas de data são
    // deduplicadas pelo valor FORMATADO (`colGroupKey`), então datas do mesmo mês
    // (formato `mm/aa`) viram uma única coluna; `colVals` guarda um representante
    // bruto (o cabeçalho o formata via `dimDisplay`).
    const colGroupKey = (v: unknown) => groupLabelOf(v, colDimKey);
    const colVals: unknown[] = [];
    const seenCol = new Set<string>();
    for (const r of rows) {
      const gk = colGroupKey(r[colDimKey]);
      if (!seenCol.has(gk)) {
        seenCol.add(gk);
        colVals.push(r[colDimKey]);
      }
    }
    const colDimLabel =
      data.dimensions.find((d) => d.key === colDimKey)?.label ?? "";
    const rowsForCol = (rs: Record<string, unknown>[], v: unknown) =>
      rs.filter((r) => colGroupKey(r[colDimKey]) === colGroupKey(v));

    // Eixo esquerdo achatado, com a MÉTRICA por fora: cada métrica é uma linha
    // recolhível (nível 0) e, quando expandida, desce os grupos das demais
    // dimensões (níveis ≥1). A chave inclui o caminho (prefixo) e a métrica p/
    // isolar o estado de expansão entre métricas e ramos homônimos.
    type TItem = {
      metricKey: string;
      level: number;
      label: string;
      key: string;
      rows: Record<string, unknown>[];
      collapsible: boolean;
    };
    const buildTItems = (
      rs: Record<string, unknown>[],
      levels: string[],
      depth: number,
      prefix: string,
      metricKey: string
    ): TItem[] => {
      if (levels.length === 0) return [];
      const [key, ...rest] = levels;
      const byKey = new Map<
        string,
        { label: string; sort: number; rows: Record<string, unknown>[] }
      >();
      const order: string[] = [];
      for (const r of rs) {
        const cell = groupCellOf(r[key], key);
        let g = byKey.get(cell.k);
        if (!g) {
          g = { label: cell.label, sort: cell.sort ?? 0, rows: [] };
          byKey.set(cell.k, g);
          order.push(cell.k);
        }
        g.rows.push(r);
      }
      if (groupFmtOf(key))
        order.sort((a, b) => byKey.get(a)!.sort - byKey.get(b)!.sort);
      const items: TItem[] = [];
      for (const gk of order) {
        const g = byKey.get(gk)!;
        const k = `${prefix}›${gk}`;
        const isLeaf = rest.length === 0;
        items.push({
          metricKey,
          level: depth,
          label: g.label,
          key: k,
          rows: g.rows,
          collapsible: !isLeaf,
        });
        if (!isLeaf && expanded.has(k))
          items.push(...buildTItems(g.rows, rest, depth + 1, k, metricKey));
      }
      return items;
    };
    const tItems: TItem[] = [];
    for (const mc of metricCols) {
      const mKey = `__m:${mc.key}`;
      tItems.push({
        metricKey: mc.key,
        level: 0,
        label: mc.label,
        key: mKey,
        rows,
        collapsible: true,
      });
      if (expanded.has(mKey))
        tItems.push(...buildTItems(rows, tGroupLevels, 1, mKey, mc.key));
    }

    return (
      <div className="h-full overflow-auto [scrollbar-gutter:stable]">
        <Table style={tableStyle}>
          <TableHeader>
            <TableRow
              className={rowBorder}
              style={{
                background: t.headerBg,
                color: t.headerColor,
                ...(borderColor ? { borderColor } : {}),
              }}
            >
              <TableHead style={cellBorder(colVals.length === 0)}>
                {colDimLabel}
              </TableHead>
              {colVals.map((v, ci) => (
                <TableHead
                  key={String(v ?? "")}
                  className={alignClass(
                    resolveAlign(t, { column: String(v ?? ""), numeric: true })
                  )}
                  style={cellBorder(ci === colVals.length - 1)}
                >
                  {dimDisplay(v, colDimKey)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tItems.map((item) => {
              const isMetric = item.level === 0;
              const isCollapsed = !expanded.has(item.key);
              return (
                <TableRow
                  key={item.key}
                  className={cn(rowBorder, isMetric && "font-medium")}
                  style={{
                    background: isMetric
                      ? t.headerBg ?? "var(--muted)"
                      : t.bodyBg,
                    color: isMetric ? t.headerColor : t.bodyColor,
                    ...(borderColor ? { borderColor } : {}),
                  }}
                >
                  <TableHead
                    className="font-medium"
                    style={cellBorder(colVals.length === 0)}
                  >
                    <button
                      type="button"
                      className={cn(
                        "inline-flex items-center gap-1",
                        item.collapsible ? "cursor-pointer" : "cursor-default"
                      )}
                      style={
                        item.level ? { paddingLeft: item.level * 16 } : undefined
                      }
                      onClick={
                        item.collapsible
                          ? () => toggleExpand(item.key)
                          : undefined
                      }
                      disabled={!item.collapsible}
                    >
                      {item.collapsible ? (
                        isCollapsed ? (
                          <ChevronRight className="size-3.5 shrink-0" />
                        ) : (
                          <ChevronDown className="size-3.5 shrink-0" />
                        )
                      ) : null}
                      {item.label}
                    </button>
                  </TableHead>
                  {colVals.map((v, ci) => (
                    <TableCell
                      key={String(v ?? "")}
                      className={cn(
                        alignClass(
                          resolveAlign(t, {
                            column: String(v ?? ""),
                            rowKey: item.key,
                            numeric: true,
                          })
                        ),
                        "tabular-nums"
                      )}
                      style={cellBorder(ci === colVals.length - 1)}
                    >
                      {metricAggCellText(
                        rowsForCol(item.rows, v),
                        item.metricKey,
                        false,
                        appearance.decimals
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto [scrollbar-gutter:stable]">
      <Table style={tableStyle}>
        <TableHeader>
          <TableRow
            className={rowBorder}
            style={{
              background: t.headerBg,
              color: t.headerColor,
              ...(borderColor ? { borderColor } : {}),
            }}
          >
            {editable ? <TableHead className="w-6 px-1" /> : null}
            {cols.map((c, ci) => (
              <TableHead
                key={c.key}
                className={cn(
                  "group relative",
                  alignClass(
                    resolveAlign(t, { column: c.key, numeric: metricKeys.has(c.key) })
                  ),
                  editable && "cursor-move"
                )}
                draggable={editable}
                onDragStart={editable ? () => setDragCol(c.key) : undefined}
                onDragOver={editable ? (e) => e.preventDefault() : undefined}
                onDrop={
                  editable
                    ? () => {
                        if (dragCol)
                          setTable({
                            columnOrder: reorderKeys(
                              cols.map((x) => x.key),
                              dragCol,
                              c.key
                            ),
                          });
                        setDragCol(null);
                      }
                    : undefined
                }
                onDoubleClick={(e) => openCtx(e, c.key, ["col"])}
                style={{
                  background: t.colColors?.[c.key]?.fill,
                  color: t.colColors?.[c.key]?.text ?? t.headerColor,
                  ...cellBorder(ci === cols.length - 1),
                  ...widthStyle(c.key),
                  ...(cellText === "clip" ? { overflow: "hidden" } : {}),
                }}
              >
                <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                  {editable ? (
                    <GripVertical className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
                  ) : null}
                  <span className={cellSpanClass}>{c.label}</span>
                </span>
                {editable ? (
                  <ResizeHandle axis="col" onResize={(w) => setColWidth(c.key, w)} />
                ) : null}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {groupLevels.length > 0
            ? groupItems.map((item) =>
                item.kind === "group"
                  ? renderSubtotalRow(item.label, item.rows, {
                      collapsible: true,
                      isCollapsed: !expanded.has(item.key),
                      onToggle: () => toggleExpand(item.key),
                      level: item.level,
                      keyId: item.key,
                    })
                  : renderDataRow(item.row)
              )
            : rows.map(renderDataRow)}
          {groupLevels.length > 0 && rows.length > 0
            ? renderSubtotalRow("Total geral", rows, { isGrand: true })
            : null}
        </TableBody>
      </Table>

      {menu?.kind === "ctx" ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          ordering={
            menu.group
              ? undefined
              : {
                  onAsc: () => {
                    setTable({ sort: { column: menu.column, dir: "asc" }, rowOrder: undefined });
                    setMenu(null);
                  },
                  onDesc: () => {
                    setTable({ sort: { column: menu.column, dir: "desc" }, rowOrder: undefined });
                    setMenu(null);
                  },
                  onByColor:
                    distinctRowFills.length >= 2
                      ? () => setMenu({ kind: "colorOrder", x: menu.x, y: menu.y, column: menu.column })
                      : undefined,
                }
          }
          coloring={{
            scopes: menu.scopes,
            onScope: (scope) =>
              setMenu({
                kind: "color",
                x: menu.x,
                y: menu.y,
                scope,
                column: menu.column,
                rowKey: menu.rowKey,
                group: menu.group,
              }),
          }}
          dateFormat={
            menu.isDate
              ? {
                  value: t.dateFormats?.[menu.column],
                  onSelect: (f) => {
                    setColDateFormat(menu.column, f);
                    setMenu(null);
                  },
                }
              : undefined
          }
        />
      ) : null}

      {menu?.kind === "color" ? (
        <ColorPopover
          x={menu.x}
          y={menu.y}
          title={
            menu.scope === "row"
              ? "Aparência da linha"
              : menu.scope === "col"
                ? "Aparência da coluna"
                : "Aparência da célula"
          }
          value={colorValue(menu)}
          onChange={(cp) => setColor(menu, cp)}
          align={{
            value: alignValue(menu),
            onSelect: (a) => setAlign(menu, a),
          }}
          decimals={
            // Só onde afeta algo numérico: colunas de métrica/variação, ou o
            // escopo linha (que atinge as células de métrica da linha).
            menu.scope === "row" ||
            metricKeys.has(menu.column) ||
            varBaseOf(menu.column) != null ||
            cmpBaseOf(menu.column) != null
              ? {
                  value: decimalsValue(menu),
                  onSelect: (d) => setDecimals(menu, d),
                }
              : undefined
          }
          onClose={() => setMenu(null)}
        />
      ) : null}

      {menu?.kind === "colorOrder" ? (
        <ColorOrderDialog
          x={menu.x}
          y={menu.y}
          colors={distinctRowFills}
          value={t.sort?.colorOrder}
          onApply={(order) => {
            setTable({
              sort: { column: menu.column, dir: "color", colorOrder: order },
              rowOrder: undefined,
            });
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}
