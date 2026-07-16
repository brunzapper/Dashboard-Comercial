// Versão: 1.0 | Data: 16/07/2026
// Server Actions da AGENDA (fetch deferido — o calendário navega por mês/
// semana e refaz a busca do range visível). Duas frentes:
//  * fetchAgendaWidget: widget 'agenda' num dashboard (config em
//    settings.agenda). A agenda tem navegação própria — não participa da
//    barra de período do dashboard.
//  * fetchBoardAgenda: 3ª visão da página de kanban dedicado (fonte/campo do
//    board; tarefas visíveis no range).
// Ambas devolvem o contexto de registros p/ os painéis dos itens.
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { hasAnyRole, type RoleKey } from "@/lib/auth/roles";
import { fieldAppliesToSource } from "@/lib/sources";
import { loadSources } from "@/lib/config/sources";
import type { FieldDefinition, OptionItem } from "@/lib/records/types";
import type { DashboardSettings } from "@/lib/widgets/types";
import { runAgenda } from "./data";
import type { AgendaData, AgendaSettings } from "./types";

export interface AgendaResult {
  data: AgendaData | null;
  settings: AgendaSettings | null;
  fields: FieldDefinition[];
  responsibles: OptionItem[];
  operations: OptionItem[];
  error?: string;
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
        .eq("show_in_builder", true)
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
      (!source || fieldAppliesToSource(f.applies_to, source)) &&
      (isAdmin || hasAnyRole(roles, f.visible_to_roles as RoleKey[]))
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
  return { fields, responsibles, operations };
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
  return { data, settings, ...ctx };
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
  };

  const ctx = await loadContext(supabase, session.roles, settings.source);
  const data = await runAgenda(
    supabase,
    settings,
    { from: fromIso, to: toIso },
    Object.fromEntries(ctx.responsibles.map((r) => [r.id, r.label]))
  );
  return { data, settings, ...ctx };
}
