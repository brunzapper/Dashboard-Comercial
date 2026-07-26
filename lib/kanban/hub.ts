// Versão: 1.0 | Data: 26/07/2026
// Kanbans de WIDGET na seção "Kanbans" do hub (/): módulo PURO (sem I/O) que
// mapeia as linhas da query widgets+dashboards!inner do hub para os cards da
// seção. Um widget kanban não tem linha espelho em `dashboards` — a página
// cheia (/kanbans/w/[widgetId]) renderiza o MESMO kanban do widget (mesma
// config widgets.settings.kanban, mesmos kanban_placements.widget_id).

/** Shape da linha do select do hub (embed `dashboards!inner` vira objeto). */
export interface WidgetKanbanHubRow {
  id: string;
  title: string | null;
  dashboard_id: string;
  settings?: { kanban?: unknown } | null;
  dashboards: {
    id: string;
    name: string;
    kind: string;
    status: string;
  } | null;
}

export interface WidgetKanbanHubItem {
  widgetId: string;
  label: string;
  dashboardId: string;
  dashboardName: string;
  href: string;
}

/** Rota da página cheia de um widget kanban. */
export function widgetKanbanHref(widgetId: string): string {
  return `/kanbans/w/${widgetId}`;
}

// Defesa em profundidade (além dos filtros da query do hub): só widgets de
// dashboards ATIVOS comuns e já CONFIGURADOS (sem settings.kanban o host do
// widget mostra erro — não ganha página cheia). Ordena por dashboard e título.
export function mapWidgetKanbanRows(
  rows: WidgetKanbanHubRow[]
): WidgetKanbanHubItem[] {
  const items: WidgetKanbanHubItem[] = [];
  for (const row of rows) {
    const dash = row.dashboards;
    if (!dash || dash.kind !== "dashboard" || dash.status !== "active") {
      continue;
    }
    if (!row.settings?.kanban) continue;
    items.push({
      widgetId: row.id,
      label: row.title?.trim() || "Kanban (sem título)",
      dashboardId: dash.id,
      dashboardName: dash.name,
      href: widgetKanbanHref(row.id),
    });
  }
  return items.sort(
    (a, b) =>
      a.dashboardName.localeCompare(b.dashboardName, "pt-BR") ||
      a.label.localeCompare(b.label, "pt-BR")
  );
}
