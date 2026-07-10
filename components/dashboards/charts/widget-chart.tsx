// Versão: 2.0 | Data: 10/07/2026
// Renderiza um WidgetData conforme o visual_type (Recharts v3). v2.0 (Fase 10):
// aceita AppearanceSettings (cores por série/coluna, gradiente sutil, fundo,
// linhas de grade, eixo duplo esq/dir, rótulos de dados, legenda, paleta de
// pizza, e cores/ordem/ordenação de tabela). Sem `appearance` = comportamento
// anterior (paleta --chart-1..5, um eixo, legenda p/ ≥2 séries).
"use client";

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
import type { AppearanceSettings, VisualType, WidgetData } from "@/lib/widgets/types";
import { paletteColor, resolveSeriesColor } from "@/lib/widgets/palettes";
import {
  gridFlags,
  orderedColumns,
  sortRows,
  topWithOther,
} from "@/lib/widgets/appearance";

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
}: {
  visualType: VisualType;
  data: WidgetData;
  appearance?: AppearanceSettings;
}) {
  const { rows, dimensions, metrics } = data;
  const dimKey = dimensions[0]?.key;
  const ap = appearance ?? {};
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
    return <AppearanceTable data={data} appearance={ap} />;
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

  if (visualType === "linha") {
    return withBg(
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
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

  return withBg(
    <BarChart
      data={rows}
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
          singleSeries &&
          (ap.fillMode === "gradient" ||
            (ap.columnColors && Object.keys(ap.columnColors).length > 0));
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
              ? rows.map((_, idx) => (
                  <Cell
                    key={idx}
                    fill={ap.columnColors?.[idx] ?? base}
                    fillOpacity={
                      ap.fillMode === "gradient"
                        ? gradientOpacity(idx, rows.length)
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

// ---------------- Tabela agregada com aparência ----------------
function AppearanceTable({
  data,
  appearance,
}: {
  data: WidgetData;
  appearance: AppearanceSettings;
}) {
  const t = appearance.table ?? {};
  const metricKeys = new Set(data.metrics.map((m) => m.key));
  const allCols = [
    ...data.dimensions.map((d) => ({ key: d.key, label: d.label })),
    ...data.metrics.map((m) => ({ key: m.key, label: m.label })),
  ];
  const cols = orderedColumns(
    allCols.map((c) => c.key),
    t.columnOrder
  ).map((key) => allCols.find((c) => c.key === key)!);

  const colorForCol = (key: string) => t.columnColors?.[key];
  const rows = sortRows(data.rows, t.sort, (r) => {
    const col = t.sort?.column ?? "";
    return String(colorForCol(col) ?? r[col] ?? "");
  });

  const gl = t.gridLines ?? "both";
  const vertical = gl === "vertical" || gl === "both";
  const horizontal = gl === "horizontal" || gl === "both";
  const borderColor = t.borderColor;
  const rowBorder = horizontal ? "" : "border-b-0";
  const cellBorder = (last: boolean) =>
    vertical && !last
      ? { borderRight: `1px solid ${borderColor ?? "var(--border)"}` }
      : {};

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
            {cols.map((c, ci) => (
              <TableHead
                key={c.key}
                className={metricKeys.has(c.key) ? "text-right" : undefined}
                style={{
                  color: t.headerColor ?? colorForCol(c.key),
                  ...cellBorder(ci === cols.length - 1),
                }}
              >
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow
              key={i}
              className={rowBorder}
              style={{
                background: t.rowColors?.[i] ?? t.bodyBg,
                color: t.bodyColor,
                ...(borderColor ? { borderColor } : {}),
              }}
            >
              {cols.map((c, ci) => {
                const isMetric = metricKeys.has(c.key);
                const cellColor =
                  t.cellColors?.[`${i}:${c.key}`] ?? colorForCol(c.key);
                return (
                  <TableCell
                    key={c.key}
                    className={isMetric ? "text-right tabular-nums" : undefined}
                    style={{
                      color: cellColor ?? t.bodyColor,
                      ...cellBorder(ci === cols.length - 1),
                    }}
                  >
                    {isMetric ? fmt(r[c.key]) : String(r[c.key] ?? "—")}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
