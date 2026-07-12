// Versão: 1.0 | Data: 12/07/2026
// Snapshot do estado de um dashboard (nome + settings + widgets + células das
// tabelas editáveis) para o histórico de Desfazer/Refazer. É o que se grava de
// volta num "restore". A montagem é DETERMINÍSTICA (widgets e células ordenados)
// para que JSON.stringify sirva de comparação estável entre dois snapshots.
import type { DashboardSettings, Widget } from "./types";

// Colunas persistidas de um widget (sem dashboard_id — o restore o injeta a
// partir do id do dashboard). O `id` é mantido para reconciliar por linha:
// reinsere widgets excluídos com o mesmo id e casa referências (células).
export type WidgetSnapshot = Pick<
  Widget,
  | "id"
  | "title"
  | "visual_type"
  | "source"
  | "sources"
  | "split_by_source"
  | "dimensions"
  | "metrics"
  | "filters"
  | "settings"
  | "grid_position"
  | "sort_order"
>;

export interface CellSnapshot {
  widget_id: string;
  row_key: string;
  col_key: string;
  value: number | string | null;
}

export interface DashboardSnapshot {
  name: string;
  settings: DashboardSettings;
  widgets: WidgetSnapshot[];
  cells: CellSnapshot[];
}

// Linhas cruas vindas do Supabase (page.tsx / captureDashboardSnapshot).
type WidgetRow = Widget;
type CellRow = {
  widget_id: string;
  row_key: string;
  col_key: string;
  value: number | string | null;
};

export function buildDashboardSnapshot(
  name: string,
  settings: DashboardSettings,
  widgets: WidgetRow[],
  cells: CellRow[]
): DashboardSnapshot {
  const widgetSnaps: WidgetSnapshot[] = widgets
    .map((w) => ({
      id: w.id,
      title: w.title,
      visual_type: w.visual_type,
      source: w.source,
      sources: w.sources,
      split_by_source: w.split_by_source,
      dimensions: w.dimensions,
      metrics: w.metrics,
      filters: w.filters,
      settings: w.settings,
      grid_position: w.grid_position,
      sort_order: w.sort_order,
    }))
    .sort((a, b) =>
      a.sort_order !== b.sort_order
        ? a.sort_order - b.sort_order
        : a.id.localeCompare(b.id)
    );

  const cellSnaps: CellSnapshot[] = cells
    .map((c) => ({
      widget_id: c.widget_id,
      row_key: c.row_key,
      col_key: c.col_key,
      value: c.value,
    }))
    .sort(
      (a, b) =>
        a.widget_id.localeCompare(b.widget_id) ||
        a.row_key.localeCompare(b.row_key) ||
        a.col_key.localeCompare(b.col_key)
    );

  return { name, settings, widgets: widgetSnaps, cells: cellSnaps };
}
