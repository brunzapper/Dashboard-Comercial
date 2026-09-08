// Versão: 2.0 | Data: 28/07/2026
// Server Actions da AGENDA (fetch deferido — o calendário navega por mês/
// semana e refaz a busca do range visível). Três frentes:
//  * fetchAgendaWidget: widget 'agenda' num dashboard (config em
//    settings.agenda). A agenda tem navegação própria — não participa da
//    barra de período do dashboard.
//  * fetchBoardAgenda: 3ª visão da página de kanban dedicado (fonte/campo do
//    board; tarefas visíveis no range).
//  * fetchWorkspaceAgenda (v2.0, 28/07/2026): página /agenda do Workspace —
//    mistura os record-legs de TODOS os widgets agenda visíveis (ou de um
//    específico, ou nenhum), com recorte por responsável/operação. Operação é
//    TRADUZIDA aqui pelo caminho canônico (loadOperationScopes +
//    operationFilterSet — nunca `operation_id eq` literal, coluna derivada).
//    Configs deduplicadas por (source, dateField) e capadas em
//    MAX_RECORD_LEGS; registros deduplicados por id|dia (mergeAgendaItems).
// Todas devolvem o contexto de registros p/ os painéis dos itens.
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { hasAnyRole, type RoleKey } from "@/lib/auth/roles";
import { fieldAppliesToSource } from "@/lib/sources";
import { loadSources } from "@/lib/config/sources";
import {
  loadOperationScopes,
  operationFilterSet,
} from "@/lib/config/operation-scope";
import type { FieldDefinition, OptionItem } from "@/lib/records/types";
import { isCoreDef } from "@/lib/records/core-defs";
import type { DashboardSettings, WidgetFilter } from "@/lib/widgets/types";
import {
  redactRestrictedFields,
  restrictedFieldKeys,
} from "@/lib/records/field-acl";
import { runAgenda } from "./data";
import { mergeAgendaItems } from "./day-items";
import type { AgendaData, AgendaSettings } from "./types";

export interface AgendaResult {
  data: AgendaData | null;
  settings: AgendaSettings | null;
  fields: FieldDefinition[];
  responsibles: OptionItem[];
  operations: OptionItem[];
  error?: string;
  // Aviso não-fatal (ex.: Workspace com mais bases do que o teto de legs).
  warning?: string;
}

const EMPTY: AgendaResult = {
  data: null,
  settings: null,
  fields: [],
  responsibles: [],
  operations: [],
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function loadContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  roles: string[],
  source: string | undefined
) {
  const isAdmin = roles.includes("admin");
  const [{ data: fieldsData }, { data: respData }, { data: opsData }] =
    await Promise.all([
      supabase
        .from("field_definitions")
        .select(
          "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, show_in_builder, formula, sort_order, applies_to, source_system, source_field_id, write_back, currency_code, currency_mode, show_as_percent"
        )
        // Linhas core (0086) entram MESMO ocultas: o olho do /campos é aplicado
      // no merge (buildAvailableFields) — sem a linha, o hardcoded reapareceria.
      .or("show_in_builder.eq.true,source_system.eq.core")
        .order("sort_order", { ascending: true }),
      supabase
        .from("responsibles")
        .select("id, display_name, bitrix_user_id")
        .eq("active", true)
        .order("display_name"),
      supabase
        .from("operations")
        .select("id, name")
        .eq("active", true)
        .order("name"),
    ]);
  const fields = ((fieldsData ?? []) as FieldDefinition[]).filter(
    (f) =>
      f.data_type !== "calculado_agg" &&
      // Linhas core (0086) são overrides das colunas núcleo — nunca campo custom.
      !isCoreDef(f) &&
      (!source || fieldAppliesToSource(f.applies_to, source)) &&
      (isAdmin || hasAnyRole(roles, f.visible_to_roles as RoleKey[]))
  );
  // O ACL acima recorta o CATÁLOGO exibido; os VALORES vêm no
  // AgendaItem.record (RecordRow com custom_fields inteiro), então a agenda
  // precisa da deny-list para peneirar as linhas antes de virarem payload —
  // filtrar só o catálogo esconderia o campo restrito da tela, não do payload.
  const denied = restrictedFieldKeys(
    (fieldsData ?? []) as FieldDefinition[],
    roles,
    isAdmin
  );
  const responsibles: OptionItem[] = (respData ?? []).map((r) => ({
    id: r.id as string,
    label: r.display_name as string,
    bitrixLinked: Boolean(r.bitrix_user_id),
  }));
  const operations: OptionItem[] = (opsData ?? []).map((o) => ({
    id: o.id as string,
    label: o.name as string,
  }));
  return { fields, responsibles, operations, denied };
}

/** Peneira de ACL nos registros da agenda (ver nota em loadContext). */
function redactAgendaData(
  data: AgendaData | null,
  denied: Set<string>
): AgendaData | null {
  if (!data || denied.size === 0) return data;
  return {
    ...data,
    items: data.items.map((item) => {
      if (!item.record) return item;
      const [record] = redactRestrictedFields([item.record], denied);
      return record === item.record ? item : { ...item, record };
    }),
  };
}

/** Agenda de um widget 'agenda' (config própria em settings.agenda). */
export async function fetchAgendaWidget(
  dashboardId: string,
  widgetId: string,
  fromIso: string,
  toIso: string
): Promise<AgendaResult> {
  const session = await getSessionInfo();
  if (!session) return { ...EMPTY, error: "Sessão expirada." };
  if (!DATE_RE.test(fromIso) || !DATE_RE.test(toIso)) {
    return { ...EMPTY, error: "Intervalo inválido." };
  }
  const supabase = await createClient();
  const { data: w } = await supabase
    .from("widgets")
    .select("id, visual_type, settings")
    .eq("id", widgetId)
    .eq("dashboard_id", dashboardId)
    .maybeSingle();
  if (!w || w.visual_type !== "agenda") {
    return { ...EMPTY, error: "Widget não encontrado." };
  }
  const settings =
    ((w.settings as { agenda?: AgendaSettings } | null)?.agenda ??
      {}) as AgendaSettings;

  const ctx = await loadContext(supabase, session.roles, settings.source);
  const data = await runAgenda(
    supabase,
    settings,
    { from: fromIso, to: toIso },
    Object.fromEntries(ctx.responsibles.map((r) => [r.id, r.label]))
  );
  const { denied, ...rest } = ctx;
  return { data: redactAgendaData(data, denied), settings, ...rest };
}

// ---------------------------------------------------------------------------
// Agenda do WORKSPACE (/agenda)
// ---------------------------------------------------------------------------

// Teto de record-legs por consulta ("Todas as agendas" com muitos widgets):
// cada par (source, dateField) distinto vira um runRecordList — sem teto, um
// workspace com dezenas de agendas custaria dezenas de janelas de 1000 linhas.
const MAX_RECORD_LEGS = 12;

export interface WorkspaceAgendaControls {
  // "todas" = record-legs de todos os widgets agenda visíveis;
  // "propria" = só entradas diretas (tarefas + anotações);
  // { widgetId } = record-leg de um widget específico.
  content: "todas" | "propria" | { widgetId: string };
  responsibleId?: string | null;
  operationId?: string | null;
}

interface AgendaWidgetRow {
  id: string;
  settings?: { agenda?: AgendaSettings } | null;
  dashboards: { kind: string; status: string } | null;
}

// Widgets agenda visíveis (RLS de widgets = auth_board_visible do pai) de
// dashboards ATIVOS comuns, na org ativa — espelho da query do hub de widget
// kanbans (app/(app)/page.tsx).
async function loadVisibleAgendaWidgets(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string | null,
  widgetId?: string
): Promise<AgendaWidgetRow[]> {
  let query = supabase
    .from("widgets")
    .select("id, settings, dashboards!inner(kind, status, organization_id)")
    .eq("visual_type", "agenda")
    .eq("dashboards.kind", "dashboard")
    .eq("dashboards.status", "active");
  if (orgId) query = query.eq("dashboards.organization_id", orgId);
  if (widgetId) query = query.eq("id", widgetId);
  const { data } = await query;
  return (data ?? []) as unknown as AgendaWidgetRow[];
}

/**
 * Agenda do Workspace: mistura configurável de record-legs dos widgets agenda
 * + tarefas + anotações. Controles fora dos filtros de dashboard POR DESIGN
 * (barra própria — mesma regra do widget e da página cheia do kanban).
 */
export async function fetchWorkspaceAgenda(
  fromIso: string,
  toIso: string,
  controls: WorkspaceAgendaControls
): Promise<AgendaResult> {
  const session = await getSessionInfo();
  if (!session) return { ...EMPTY, error: "Sessão expirada." };
  if (!DATE_RE.test(fromIso) || !DATE_RE.test(toIso)) {
    return { ...EMPTY, error: "Intervalo inválido." };
  }
  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  const range = { from: fromIso, to: toIso };

  // ---- recortes (responsável / operação traduzida) ----
  const extraFilters: WidgetFilter[] = [];
  let taskResponsibleIds: string[] = [];
  const respId =
    typeof controls.responsibleId === "string" && controls.responsibleId
      ? controls.responsibleId
      : null;
  const opId =
    typeof controls.operationId === "string" && controls.operationId
      ? controls.operationId
      : null;
  if (respId) {
    // O choke point do record-list expande o grupo do apelido (0101).
    extraFilters.push({ field: "responsible_id", op: "in", value: [respId] });
    taskResponsibleIds = [respId];
  }
  if (opId) {
    const scopes = await loadOperationScopes(supabase, [opId]);
    extraFilters.push(...operationFilterSet([opId], scopes));
    const opRespIds = scopes.get(opId)?.responsibleIds ?? [];
    // Tarefas só têm responsible_id — filtros de PERFIL (profile-only) não se
    // aplicam a elas; operação sem vínculo deixa as tarefas sem recorte.
    if (taskResponsibleIds.length === 0) taskResponsibleIds = opRespIds;
  }

  // ---- record-legs conforme o controle de conteúdo ----
  const legConfigs: { source: string; dateField: string }[] = [];
  let warning: string | undefined;
  let ctxSource: string | undefined;
  if (controls.content !== "propria") {
    const wantedId =
      typeof controls.content === "object" ? controls.content.widgetId : undefined;
    const rows = await loadVisibleAgendaWidgets(supabase, orgId, wantedId);
    if (wantedId && rows.length === 0) {
      return { ...EMPTY, error: "Agenda não encontrada." };
    }
    const seen = new Set<string>();
    for (const row of rows) {
      const cfg = row.settings?.agenda;
      if (!cfg?.source || !cfg.dateField) continue;
      const key = `${cfg.source}|${cfg.dateField}`;
      if (seen.has(key)) continue;
      seen.add(key);
      legConfigs.push({ source: cfg.source, dateField: cfg.dateField });
    }
    if (legConfigs.length > MAX_RECORD_LEGS) {
      warning = `Muitas agendas no workspace — exibindo as ${MAX_RECORD_LEGS} primeiras bases.`;
      legConfigs.length = MAX_RECORD_LEGS;
    }
    if (wantedId) ctxSource = legConfigs[0]?.source;
  }

  const ctx = await loadContext(supabase, session.roles, ctxSource);
  const labels = Object.fromEntries(ctx.responsibles.map((r) => [r.id, r.label]));

  // Legs sequenciais (evita rajada de janelas de 1000 linhas em paralelo).
  const legs: AgendaData[] = [];
  for (const cfg of legConfigs) {
    legs.push(
      await runAgenda(supabase, cfg, range, labels, {
        includeTasks: false,
        includeNotes: false,
        extraFilters,
      })
    );
  }
  // Tarefas + anotações: UMA vez, fora dos widgets (entradas diretas).
  legs.push(
    await runAgenda(
      supabase,
      { showTasks: true, showNotes: true },
      range,
      labels,
      { taskResponsibleIds }
    )
  );

  const data: AgendaData = {
    from: fromIso,
    to: toIso,
    items: mergeAgendaItems(legs.map((l) => l.items)),
  };
  const { denied, ...rest } = ctx;
  return {
    data: redactAgendaData(data, denied),
    settings: null,
    ...rest,
    ...(warning ? { warning } : {}),
  };
}

/** Agenda da página de um kanban dedicado (fonte/campo de data do board). */
export async function fetchBoardAgenda(
  boardId: string,
  fromIso: string,
  toIso: string
): Promise<AgendaResult> {
  const session = await getSessionInfo();
  if (!session) return { ...EMPTY, error: "Sessão expirada." };
  if (!DATE_RE.test(fromIso) || !DATE_RE.test(toIso)) {
    return { ...EMPTY, error: "Intervalo inválido." };
  }
  const supabase = await createClient();
  const { data: board } = await supabase
    .from("dashboards")
    .select("id, settings, kind")
    .eq("id", boardId)
    .eq("kind", "kanban")
    .maybeSingle();
  if (!board) return { ...EMPTY, error: "Kanban não encontrado." };
  const kanban = (board.settings as DashboardSettings | null)?.kanban;

  // Campo de data da agenda do board: o do bucket, ou o padrão da fonte.
  let dateField = kanban?.dateField;
  if (!dateField && kanban?.source) {
    const sources = await loadSources(supabase);
    dateField =
      sources.find((s) => s.key === kanban.source)?.defaultPeriodField ??
      "source_created_at";
  }
  const settings: AgendaSettings = {
    source: kanban?.source,
    dateField,
    showTasks: true,
    showNotes: true,
  };

  const ctx = await loadContext(supabase, session.roles, settings.source);
  const data = await runAgenda(
    supabase,
    settings,
    { from: fromIso, to: toIso },
    Object.fromEntries(ctx.responsibles.map((r) => [r.id, r.label]))
  );
  const { denied, ...rest } = ctx;
  return { data: redactAgendaData(data, denied), settings, ...rest };
}
