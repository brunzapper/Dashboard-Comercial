// Versão: 1.0 | Data: 05/07/2026
// Renderiza um WidgetData conforme o visual_type (Recharts v3). Paleta
// categórica = tokens --chart-1..5 do design system (tema claro/escuro),
// atribuídos em ordem fixa; categorias além de 5 (pizza/funil) viram "Outros".
// Regras dataviz: um eixo só, legenda p/ ≥2 séries, KPI = número herói.
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
import type { VisualType, WidgetData } from "@/lib/widgets/types";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];
const MAX_CATEGORIES = 5;

function fmt(v: unknown): string {
  const n = Number(v);
  if (v == null || Number.isNaN(n)) return String(v ?? "—");
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

const axisProps = {
  tick: { fontSize: 11, fill: "var(--muted-foreground)" },
  stroke: "var(--border)",
} as const;

function EmptyState() {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
      Sem dados para exibir.
    </div>
  );
}

// Reduz categorias a top-N por valor + "Outros".
function topWithOther(
  rows: Record<string, unknown>[],
  dimKey: string,
  metricKey: string
) {
  const mapped = rows.map((r) => ({
    name: String(r[dimKey] ?? "—"),
    value: Number(r[metricKey]) || 0,
  }));
  if (mapped.length <= MAX_CATEGORIES) return mapped;
  const sorted = [...mapped].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, MAX_CATEGORIES - 1);
  const other = sorted
    .slice(MAX_CATEGORIES - 1)
    .reduce((s, x) => s + x.value, 0);
  return [...top, { name: "Outros", value: other }];
}

export function WidgetChart({
  visualType,
  data,
}: {
  visualType: VisualType;
  data: WidgetData;
}) {
  const { rows, dimensions, metrics } = data;
  const dimKey = dimensions[0]?.key;
  const showLegend = metrics.length > 1;

  if (visualType === "kpi") {
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
      <div className="h-full overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {dimensions.map((d) => (
                <TableHead key={d.key}>{d.label}</TableHead>
              ))}
              {metrics.map((m) => (
                <TableHead key={m.key} className="text-right">
                  {m.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                {dimensions.map((d) => (
                  <TableCell key={d.key}>{String(r[d.key] ?? "—")}</TableCell>
                ))}
                {metrics.map((m) => (
                  <TableCell key={m.key} className="text-right tabular-nums">
                    {fmt(r[m.key])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (rows.length === 0 || !dimKey) return <EmptyState />;

  if (visualType === "pizza" || visualType === "funil") {
    const metricKey = metrics[0]?.key;
    if (!metricKey) return <EmptyState />;
    const pieData = topWithOther(rows, dimKey, metricKey);

    if (visualType === "funil") {
      return (
        <ResponsiveContainer width="100%" height="100%">
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
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      );
    }

    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip formatter={(v) => fmt(v)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
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
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (visualType === "linha") {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey={dimKey} {...axisProps} />
          <YAxis {...axisProps} width={48} />
          <Tooltip formatter={(v) => fmt(v)} />
          {showLegend ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
          {metrics.map((m, i) => (
            <Line
              key={m.key}
              type="monotone"
              dataKey={m.key}
              name={m.label}
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  // barra (default)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey={dimKey} {...axisProps} />
        <YAxis {...axisProps} width={48} />
        <Tooltip formatter={(v) => fmt(v)} cursor={{ fill: "var(--muted)" }} />
        {showLegend ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
        {metrics.map((m, i) => (
          <Bar
            key={m.key}
            dataKey={m.key}
            name={m.label}
            fill={CHART_COLORS[i % CHART_COLORS.length]}
            radius={[4, 4, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
