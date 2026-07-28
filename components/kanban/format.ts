// Versão: 1.0 | Data: 28/07/2026
// Formatação ÚNICA das métricas do kanban — cabeçalho da coluna, badges do
// card e células da visão lista (antes cada um formatava inline). Dinheiro =
// formatMoney; dias = "N d"; número pt-BR com até 2 decimais.
import { formatMoney } from "@/lib/widgets/currency";
import type {
  KanbanBoardData,
  KanbanCardBadge,
  KanbanMetricFormat,
} from "@/lib/kanban/data";

const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

export function formatKanbanMetric(
  value: number | null,
  format: KanbanMetricFormat
): string {
  if (value == null) return "—";
  if (format === "money") return formatMoney(value, null);
  if (format === "days") return `${NUM.format(value)} d`;
  return NUM.format(value);
}

/** Formato efetivo do cabeçalho: produtor novo manda metricFormat; produtor
 *  antigo (snapshot precomputado etc.) cai no metricIsMoney legado. */
export function boardMetricFormat(data: KanbanBoardData): KanbanMetricFormat {
  return data.metricFormat ?? (data.metricIsMoney ? "money" : "number");
}

/** Formato de exibição de UM badge (kind + isMoney do campo). */
export function badgeFormat(b: KanbanCardBadge): KanbanMetricFormat {
  if (b.kind === "age") return "days";
  if (b.kind === "field" && b.isMoney) return "money";
  return "number";
}
