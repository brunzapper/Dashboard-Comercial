// Versão: 1.0 | Data: 28/07/2026
// Página AGENDA do Workspace: calendário cheio que mistura as agendas dos
// dashboards (widgets 'agenda' visíveis — RLS auth_board_visible recorta) com
// as entradas diretas (tarefas + anotações), controlado por Conteúdo/
// Responsável/Operação (barra própria — a agenda fica FORA dos filtros de
// dashboard por design, invariante 12). Prefs por usuário em
// user_settings.agendaHub; TrackLastView grava "/agenda" p/ o RestoreLastView
// da Home (whitelist literal em validateLastView).
import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadUserSettings } from "@/lib/config/user-settings";
import { TrackLastView } from "@/components/layout/track-last-view";
import {
  WorkspaceAgendaClient,
  type WorkspaceAgendaOption,
} from "@/components/agenda/workspace-agenda-client";

interface AgendaHubRow {
  id: string;
  title: string | null;
  settings?: { agenda?: unknown } | null;
  dashboards: { id: string; name: string; kind: string; status: string } | null;
}

interface AgendaHubPrefs {
  content?: string;
  responsibleId?: string | null;
  operationId?: string | null;
  view?: string;
}

export default async function AgendaHubPage() {
  const session = await getSessionInfo();
  if (!session) return null; // proxy já redireciona sem sessão

  const orgId = await getActiveOrgId();
  const supabase = await createClient();

  // Widgets agenda visíveis p/ o picker de Conteúdo (espelho da query do hub
  // de widget kanbans na Home; RLS de widgets recorta a visibilidade).
  let query = supabase
    .from("widgets")
    .select(
      "id, title, settings, dashboards!inner(id, name, kind, status, organization_id)"
    )
    .eq("visual_type", "agenda")
    .eq("dashboards.kind", "dashboard")
    .eq("dashboards.status", "active");
  if (orgId) query = query.eq("dashboards.organization_id", orgId);
  const { data } = await query;
  const widgetOptions: WorkspaceAgendaOption[] = [];
  for (const row of (data ?? []) as unknown as AgendaHubRow[]) {
    const dash = row.dashboards;
    if (!dash || dash.kind !== "dashboard" || dash.status !== "active") continue;
    if (!row.settings?.agenda) continue; // sem config, nada a misturar
    widgetOptions.push({
      widgetId: row.id,
      label: row.title?.trim() || "Agenda (sem título)",
      dashboardName: dash.name,
    });
  }

  const settings = await loadUserSettings(session.user.id);
  const prefs = (settings.agendaHub as AgendaHubPrefs | undefined) ?? {};

  const canEditValues = session.permissions.includes("edit_record_values");
  const canManageFields = session.permissions.includes(
    "manage_field_definitions"
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <TrackLastView />
      <div>
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <p className="text-muted-foreground text-sm">
          Calendário do workspace: as agendas dos seus dashboards, tarefas e
          anotações num só lugar.
        </p>
      </div>
      <div className="min-h-0 flex-1">
        <WorkspaceAgendaClient
          widgetOptions={widgetOptions}
          initial={{
            content: typeof prefs.content === "string" ? prefs.content : "todas",
            responsibleId:
              typeof prefs.responsibleId === "string"
                ? prefs.responsibleId
                : null,
            operationId:
              typeof prefs.operationId === "string" ? prefs.operationId : null,
            view: prefs.view === "week" ? "week" : "month",
          }}
          userRoles={session.roles}
          canEditValues={canEditValues}
          canManageFields={canManageFields}
        />
      </div>
    </div>
  );
}
