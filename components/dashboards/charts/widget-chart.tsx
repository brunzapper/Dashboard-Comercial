// Versão: 3.0 | Data: 10/07/2026
// Renderiza um WidgetData conforme o visual_type (Recharts v3). v3.0 (Fase 10.1):
// além da aparência (cores, grade, eixos, legenda, gradiente), suporta edição
// IN-LOCO em tabelas e gráficos (reordenar por arraste, ordenar e colorir via
// duplo-clique) quando canEdit. Sem `appearance` = comportamento original.
"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
  VisualType,
  WidgetData,
} from "@/lib/widgets/types";
import { paletteColor, resolveSeriesColor } from "@/lib/widgets/palettes";
import {
  applyManualOrder,
  distinctFills,
  gridFlags,
  reorderKeys,
  rowKeyOf,
  sortRows,
  topWithOther,
} from "@/lib/widgets/appearance";
import {
  DEFAULT_DATE_FORMAT,
  formatDateValue,
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

// noop p/ quando não há edição (canEdit=false).
const NOOP = () => {};

function fmt(v: unknown): string {
  const n = Number(v);
  if (v == null || Number.isNaN(n)) return String(v ?? "—");
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

const axisProps = {
  tick: { fontSize: 11, fill: "var(--muted-foreground)" },
  stroke: "var(--border)",
} as const;

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

export function WidgetChart({
  visualType,
  data,
  appearance,
  dateFormat,
  canEdit = false,
  onAppearanceChange,
}: {
  visualType: VisualType;
  data: WidgetData;
  appearance?: AppearanceSettings;
  dateFormat?: DateFormat;
  canEdit?: boolean;
  onAppearanceChange?: (a: AppearanceSettings) => void;
}) {
  const { rows, dimensions, metrics } = data;
  const dimKey = dimensions[0]?.key;
  const ap = appearance ?? {};
  const change = onAppearanceChange ?? NOOP;
  const editable = canEdit && Boolean(onAppearanceChange);
  const showLegend = ap.legend?.show ?? metrics.length > 1;
  const legendStyle = {
    fontSize: 11,
    ...(ap.legend?.color ? { color: ap.legend.color } : {}),
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
    if (data.kpi) {
      const k = data.kpi;
      if (k.mode === "ratio") {
        return (
          <div className="flex h-full flex-col justify-center p-1">
            <span className="text-3xl font-semibold tabular-nums">
              {k.value == null ? "—" : fmt(k.value)}
            </span>
            <span className="text-muted-foreground text-xs">{k.label}</span>
          </div>
        );
      }
      const pct = k.pct == null ? null : Math.round(k.pct * 100);
      return (
        <div className="flex h-full flex-col justify-center gap-1 p-1">
          <span className="text-3xl font-semibold tabular-nums">
            {fmt(k.realizado)}
          </span>
          <span className="text-muted-foreground text-xs">{k.label}</span>
          {k.meta != null ? (
            <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-4 text-xs">
              <span>Meta: {fmt(k.meta)}</span>
              {pct != null ? (
                <span className={pct >= 100 ? "text-chart-2" : ""}>{pct}%</span>
              ) : null}
              {k.falta != null && k.falta > 0 ? <span>Falta: {fmt(k.falta)}</span> : null}
            </div>
          ) : (
            <span className="text-muted-foreground text-xs">Sem meta configurada</span>
          )}
        </div>
      );
    }

    const row = rows[0] ?? {};
    return (
      <div className="flex h-full flex-wrap items-center gap-x-8 gap-y-3 p-1">
        {metrics.map((m) => (
          <div key={m.key} className="flex flex-col">
            <span className="text-2xl font-semibold tabular-nums">
              {fmt(row[m.key])}
            </span>
            <span className="text-muted-foreground text-xs">{m.label}</span>
          </div>
        ))}
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
        onChange={change}
      />
    );
  }

  if (rows.length === 0 || !dimKey) return <EmptyState />;

  if (visualType === "pizza" || visualType === "funil") {
    const metricKey = metrics[0]?.key;
    if (!metricKey) return <EmptyState />;
    const pieData = topWithOther(rows, dimKey, metricKey);
    const sliceFill = (i: number) =>
      ap.sliceColors?.[i] ?? paletteColor(ap.palette, i);
    const sliceOpacity = (i: number) =>
      ap.fillMode === "gradient" ? gradientOpacity(i, pieData.length) : 1;

    if (visualType === "funil") {
      return withBg(
        <FunnelChart>
          <Tooltip formatter={(v) => fmt(v)} />
          <Funnel dataKey="value" data={pieData} isAnimationActive={false}>
            <LabelList
              position="right"
              dataKey="name"
              stroke="none"
              fill="var(--foreground)"
              fontSize={11}
            />
            {pieData.map((_, i) => (
              <Cell key={i} fill={sliceFill(i)} fillOpacity={sliceOpacity(i)} />
            ))}
          </Funnel>
        </FunnelChart>
      );
    }

    return withBg(
      <PieChart>
        <Tooltip formatter={(v) => fmt(v)} />
        <Legend wrapperStyle={legendStyle} />
        <Pie
          data={pieData}
          dataKey="value"
          nameKey="name"
          innerRadius="45%"
          outerRadius="75%"
          paddingAngle={2}
          isAnimationActive={false}
        >
          {pieData.map((_, i) => (
            <Cell key={i} fill={sliceFill(i)} fillOpacity={sliceOpacity(i)} />
          ))}
        </Pie>
      </PieChart>
    );
  }

  // --- categorias (barra/linha): ordem manual ou ordenação, e chips editáveis ---
  const catName = (r: Record<string, unknown>) => String(r[dimKey] ?? "—");
  const chartRows = ap.categorySort
    ? sortRows(
        rows,
        {
          column: dimKey,
          dir: ap.categorySort.dir,
          colorOrder: ap.categorySort.colorOrder,
        },
        (r) => ap.categoryColors?.[catName(r)]?.fill
      )
    : ap.categoryOrder
      ? applyManualOrder(rows, ap.categoryOrder, catName)
      : rows;
  const catNames = chartRows.map(catName);

  function wrapCat(chartEl: React.ReactNode) {
    if (!editable) return withBg(chartEl);
    return (
      <div className="group flex h-full flex-col">
        <CategoryEditor names={catNames} appearance={ap} onChange={change} />
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
        <YAxis yAxisId="left" {...axisProps} width={48} />
        {hasRightAxis ? (
          <YAxis
            yAxisId="right"
            orientation="right"
            {...axisProps}
            width={48}
          />
        ) : null}
        <Tooltip formatter={(v) => fmt(v)} />
        {showLegend ? <Legend wrapperStyle={legendStyle} /> : null}
        {metrics.map((m, i) => (
          <Line
            key={m.key}
            yAxisId={axisOf(m.key)}
            type="monotone"
            dataKey={m.key}
            name={m.label}
            stroke={resolveSeriesColor(ap, m.key, i)}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    );
  }

  // barra + barra_horizontal
  const horizontal = visualType === "barra_horizontal";
  const singleSeries = metrics.length === 1;
  const hasCatColors = Object.keys(ap.categoryColors ?? {}).length > 0;

  return wrapCat(
    <BarChart
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
          <XAxis type="number" {...axisProps} />
          <YAxis type="category" dataKey={dimKey} {...axisProps} width={90} />
        </>
      ) : (
        <>
          <XAxis dataKey={dimKey} {...axisProps} />
          <YAxis yAxisId="left" {...axisProps} width={48} />
          {hasRightAxis ? (
            <YAxis
              yAxisId="right"
              orientation="right"
              {...axisProps}
              width={48}
            />
          ) : null}
        </>
      )}
      <Tooltip formatter={(v) => fmt(v)} cursor={{ fill: "var(--muted)" }} />
      {showLegend ? <Legend wrapperStyle={legendStyle} /> : null}
      {metrics.map((m, i) => {
        const base = resolveSeriesColor(ap, m.key, i);
        const perColumn =
          singleSeries && (ap.fillMode === "gradient" || hasCatColors);
        return (
          <Bar
            key={m.key}
            {...(horizontal ? {} : { yAxisId: axisOf(m.key) })}
            dataKey={m.key}
            name={m.label}
            fill={base}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            isAnimationActive={false}
          >
            {perColumn
              ? chartRows.map((r, idx) => (
                  <Cell
                    key={idx}
                    fill={ap.categoryColors?.[catName(r)]?.fill ?? base}
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
                dataKey={m.key}
                position={
                  ap.dataLabels.position === "inside"
                    ? "inside"
                    : horizontal
                      ? "right"
                      : "top"
                }
                fill={ap.dataLabels.color ?? "var(--foreground)"}
                fontSize={11}
                formatter={(v: unknown) => fmt(v)}
              />
            ) : null}
          </Bar>
        );
      })}
    </BarChart>
  );
}

// ---------------- Tabela agregada com aparência + edição in-loco ----------------
type TableMenu =
  | { kind: "ctx"; x: number; y: number; column: string; rowKey?: string; scopes: ColorScope[]; isDate: boolean }
  | { kind: "color"; x: number; y: number; scope: ColorScope; column: string; rowKey?: string }
  | { kind: "colorOrder"; x: number; y: number; column: string };

function AppearanceTable({
  data,
  appearance,
  editable,
  dateFormat,
  onChange,
}: {
  data: WidgetData;
  appearance: AppearanceSettings;
  editable: boolean;
  dateFormat: DateFormat;
  onChange: (a: AppearanceSettings) => void;
}) {
  const t = appearance.table ?? {};
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [dragRow, setDragRow] = useState<string | null>(null);
  const [menu, setMenu] = useState<TableMenu | null>(null);
  // Grupos recolhidos no modo "Agrupar por" (efêmero; default = todos expandidos).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const metricKeys = new Set(data.metrics.map((m) => m.key));
  const dimKeys = data.dimensions.map((d) => d.key);
  const allCols = [
    ...data.dimensions.map((d) => ({ key: d.key, label: d.label })),
    ...data.metrics.map((m) => ({ key: m.key, label: m.label })),
  ];
  const cols = applyManualOrder(allCols, t.columnOrder, (c) => c.key);
  const rowKey = (r: Record<string, unknown>) => rowKeyOf(r, dimKeys);

  // Ordenação (sort) tem precedência sobre a ordem manual de linhas.
  const rows = t.sort?.column
    ? sortRows(data.rows, t.sort, (r) => t.rowColors?.[rowKey(r)]?.fill)
    : applyManualOrder(data.rows, t.rowOrder, rowKey);

  const distinctRowFills = distinctFills(
    rows.map((r) => t.rowColors?.[rowKey(r)]?.fill)
  );

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

  function setColor(m: { scope: ColorScope; column: string; rowKey?: string }, cp: ColorPair) {
    const clear = !cp.fill && !cp.text;
    if (m.scope === "col") {
      const map = { ...(t.colColors ?? {}) };
      if (clear) delete map[m.column];
      else map[m.column] = cp;
      setTable({ colColors: map });
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

  function colorValue(m: { scope: ColorScope; column: string; rowKey?: string }): ColorPair {
    if (m.scope === "col") return t.colColors?.[m.column] ?? {};
    if (m.scope === "row" && m.rowKey) return t.rowColors?.[m.rowKey] ?? {};
    if (m.scope === "cell" && m.rowKey)
      return t.cellColors?.[`${m.rowKey}:${m.column}`] ?? {};
    return {};
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
    rk?: string
  ) {
    if (!editable) return;
    setMenu({
      kind: "ctx",
      x: e.clientX,
      y: e.clientY,
      column,
      rowKey: rk,
      scopes,
      isDate: dateCols.has(column),
    });
  }

  // --- Orientação / agrupamento (Parte 2/3) ---
  const orientation = t.orientation === "columns" ? "columns" : "rows";
  // "Agrupar por" só se aplica na orientação normal e se a key ainda existir
  // (pode ter ficado órfã se as dimensões mudaram).
  const groupByKey =
    orientation === "rows" && t.groupBy && dimKeys.includes(t.groupBy)
      ? t.groupBy
      : null;
  const groupLabelOf = (v: unknown) =>
    v == null || v === "" ? "—" : String(v);
  // Subtotal de uma métrica sobre um conjunto de linhas (soma; exato p/ count/sum,
  // aproximado p/ avg/min/max — ver plano).
  const sumMetric = (rs: Record<string, unknown>[], key: string) =>
    rs.reduce((s, r) => {
      const n = Number(r[key]);
      return Number.isNaN(n) ? s : s + n;
    }, 0);
  // Grupos preservando a ordem de `rows`.
  const groups: { label: string; rows: Record<string, unknown>[] }[] = [];
  if (groupByKey) {
    const idx = new Map<string, number>();
    for (const r of rows) {
      const label = groupLabelOf(r[groupByKey]);
      let i = idx.get(label);
      if (i == null) {
        i = groups.length;
        idx.set(label, i);
        groups.push({ label, rows: [] });
      }
      groups[i].rows.push(r);
    }
  }

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
          const cellCp = t.cellColors?.[`${rk}:${c.key}`];
          const colCp = t.colColors?.[c.key];
          return (
            <TableCell
              key={c.key}
              className={isMetric ? "text-right tabular-nums" : undefined}
              onDoubleClick={(e) => openCtx(e, c.key, ["row", "col", "cell"], rk)}
              style={{
                background: cellCp?.fill ?? colCp?.fill,
                color:
                  cellCp?.text ?? rowCp?.text ?? colCp?.text ?? t.bodyColor,
                ...cellBorder(ci === cols.length - 1),
                ...widthStyle(c.key),
                ...(cellText === "clip" ? { overflow: "hidden" } : {}),
              }}
            >
              <span className={cellSpanClass}>
                {isMetric ? fmt(r[c.key]) : dimDisplay(r[c.key], c.key)}
              </span>
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
    opts?: { collapsible?: boolean; isCollapsed?: boolean; onToggle?: () => void }
  ) => (
    <TableRow
      key={`__grp:${label}`}
      className={cn(rowBorder, "font-medium")}
      style={{
        background: t.headerBg ?? "var(--muted)",
        color: t.headerColor,
        ...(borderColor ? { borderColor } : {}),
      }}
    >
      {editable ? <TableCell className="w-6 px-1" /> : null}
      {cols.map((c, ci) => {
        const isMetric = metricKeys.has(c.key);
        const isFirst = ci === 0;
        return (
          <TableCell
            key={c.key}
            className={isMetric ? "text-right tabular-nums" : undefined}
            style={cellBorder(ci === cols.length - 1)}
          >
            {isFirst ? (
              <button
                type="button"
                className={cn(
                  "inline-flex items-center gap-1",
                  opts?.collapsible ? "cursor-pointer" : "cursor-default"
                )}
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
            ) : isMetric ? (
              fmt(sumMetric(rs, c.key))
            ) : null}
          </TableCell>
        );
      })}
    </TableRow>
  );

  // --- Modo transposto: dimensão(ões) no canto sup. esq., cada grupo vira uma
  // coluna, métricas descem como linhas à esquerda. Interações de cor/arraste
  // ficam desativadas nesta visão (ver plano). ---
  if (orientation === "columns") {
    const dimCols = cols.filter((c) => !metricKeys.has(c.key));
    const metricCols = cols.filter((c) => metricKeys.has(c.key));
    const cornerLabel = dimCols.map((c) => c.label).join(" · ") || "";
    const groupHeader = (r: Record<string, unknown>) =>
      dimCols.map((c) => dimDisplay(r[c.key], c.key)).join(" · ");
    return (
      <div className="h-full overflow-auto">
        <Table>
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
                  className="text-right"
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
                    className="text-right tabular-nums"
                    style={cellBorder(ri === rows.length - 1)}
                  >
                    {fmt(r[c.key])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <Table>
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
                  metricKeys.has(c.key) ? "text-right" : undefined,
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
          {groupByKey
            ? groups.flatMap((g) => {
                const isCollapsed = collapsed.has(g.label);
                const rowsOut = [
                  renderSubtotalRow(g.label, g.rows, {
                    collapsible: true,
                    isCollapsed,
                    onToggle: () =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.label)) next.delete(g.label);
                        else next.add(g.label);
                        return next;
                      }),
                  }),
                ];
                if (!isCollapsed) rowsOut.push(...g.rows.map(renderDataRow));
                return rowsOut;
              })
            : rows.map(renderDataRow)}
          {groupByKey && groups.length > 0
            ? renderSubtotalRow("Total geral", rows)
            : null}
        </TableBody>
      </Table>

      {menu?.kind === "ctx" ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          ordering={{
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
          }}
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
              ? "Cor da linha"
              : menu.scope === "col"
                ? "Cor da coluna"
                : "Cor da célula"
          }
          value={colorValue(menu)}
          onChange={(cp) => setColor(menu, cp)}
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
