// Versão: 1.0 | Data: 17/07/2026
// Export CSV do que um widget AGREGADO exibe (WidgetData): rótulos de
// dimensões/métricas no cabeçalho e valores como na UI — moeda honra
// __money/config da métrica (formatMoneyAggregate), percentual honra o
// carimbo do engine ("x100") e o toggle da métrica ("suffix"), espelhando o
// buildPercentModes do WidgetChart. Client-safe (menu ⋮ do widget-card).
import type { Metric, WidgetData, WidgetRow } from "@/lib/widgets/types";
import { formatMoneyAggregate } from "@/lib/widgets/currency";
import { formatPercent } from "@/lib/widgets/format";
import { csvNumber } from "@/lib/export/csv";

export function widgetDataToCsv(
  data: WidgetData,
  metricsConfig: Metric[]
): { headers: string[]; rows: string[][] } {
  const headers = [
    ...data.dimensions.map((d) => d.label),
    ...data.metrics.map((m) => m.label),
  ];
  // Config por métrica: pareada por posição (mesma montagem do WidgetChart).
  const metricByKey: Record<string, Metric> = {};
  data.metrics.forEach((m, i) => {
    if (metricsConfig[i]) metricByKey[m.key] = metricsConfig[i];
  });

  const cell = (row: WidgetRow, m: WidgetData["metrics"][number]): string => {
    const v = row[m.key];
    if (v == null || v === "") return "";
    const percentMode = m.percent
      ? "x100"
      : metricByKey[m.key]?.percent && !m.isMoney
        ? "suffix"
        : null;
    if (percentMode) return formatPercent(v, percentMode === "x100");
    const bd = row.__money?.[m.key];
    const cfg = metricByKey[m.key];
    if (m.isMoney && bd && cfg) return formatMoneyAggregate(bd, cfg);
    return csvNumber(v);
  };

  const rows = data.rows.map((r) => {
    const row = r as WidgetRow;
    return [
      ...data.dimensions.map((d) =>
        row[d.key] == null ? "" : String(row[d.key])
      ),
      ...data.metrics.map((m) => cell(row, m)),
    ];
  });
  return { headers, rows };
}
