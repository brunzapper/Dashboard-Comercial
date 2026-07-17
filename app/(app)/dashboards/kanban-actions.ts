// Versão: 1.0 | Data: 16/07/2026
// Widget KANBAN — computação DEFERIDA (server action chamada pelo widget após
// o mount, padrão da Tabela Livre/runQuickTable): resolve o período efetivo do
// widget com o MESMO resolver da page (lib/widgets/period-resolve.ts) e monta
// o quadro via lib/kanban/data.ts (modo registros) ou lib/tasks/kanban.ts
// (modo tarefas — tasks de um board apontado ou "minhas tarefas"). Devolve
// também o contexto de registros (defs/opções) p/ os painéis dos cards.
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { FieldDefinition, OptionItem } from "@/lib/records/types";
import { loadSources } from "@/lib/config/sources";
import { fieldAppliesToSource } from "@/lib/sources";
import { hasAnyRole, type RoleKey } from "@/lib/auth/roles";
import { buildAvailableFields } from "@/lib/widgets/fields";
import { loadCorrespondences } from "@/lib/correspondences";
import {
  createPeriodResolver,
  type PeriodPrefs,
} from "@/lib/widgets/period-resolve";
import type { DashboardSettings, Widget } from "@/lib/widgets/types";
import { runKanban, type KanbanBoardData } from "@/lib/kanban/data";
import type { KanbanSettings } from "@/lib/kanban/types";
import { taskBoardData } from "@/lib/tasks/kanban";
import { TASK_COLS_WITH_RECORD, type TaskRow } from "@/lib/tasks/types";

export interface KanbanWidgetResult {
  data: KanbanBoardData | null;
  kanban: KanbanSettings | null;
  // Contexto p/ os painéis de edição/criação dos cards.
  fields: FieldDefinition[];
  responsibles: OptionItem[];
  operations: OptionItem[];
  // Fonte com criação manual habilitada (quick-create) — null quando não.
  quickCreateSource: { key: string; label: string } | null;
  error?: string;
}

const EMPTY: KanbanWidgetResult = {
  data: null,
  kanban: null,
  fields: [],
  responsibles: [],
  operations: [],
  quickCreateSource: null,
};

/** Kanbans dedicados de TAREFAS visíveis ao usuário (destinos do widget). */
export async function listTaskBoards(): Promise<{ id: string; name: string }[]> {
  const session = await getSessionInfo();
  if (!session) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("dashboards")
    .select("id, name, settings")
    .eq("kind", "kanban")
    .order("name");
  return (data ?? [])
    .filter(
      (d) =>
        ((d.settings as DashboardSettings | null)?.kanban?.mode ?? "registros") ===
        "tarefas"
    )
    .map((d) => ({ id: d.id as string, name: d.name as string }));
}

export async function runKanbanWidget(
  dashboardId: string,
  widgetId: string,
  // window.location.search do cliente — período/aba/filtros são parâmetros de
  // URL, e a action os resolve exatamente como a page (resolver único).
  search: string
): Promise<KanbanWidgetResult> {
  const session = await getSessionInfo();
  if (!session) return { ...EMPTY, error: "Sessão expirada." };
  const supabase = await createClient();

  const sp: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of new URLSearchParams(search ?? "")) {
    const cur = sp[k];
    sp[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
  }

  const [
    { data: dash },
    { data: widgetsData },
    { data: fieldsData },
    correspondences,
    { data: prefData },
    sources,
    { data: respData },
    { data: opsData },
  ] = await Promise.all([
    supabase
      .from("dashboards")
      .select("id, settings")
      .eq("id", dashboardId)
      .maybeSingle(),
    supabase
      .from("widgets")
      .select(
        "id, dashboard_id, title, visual_type, source, sources, split_by_source, dimensions, metrics, filters, settings, grid_position, sort_order"
      )
      .eq("dashboard_id", dashboardId),
    supabase
      .from("field_definitions")
      .select(
        "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, show_in_builder, formula, allow_negative, currency_code, currency_mode, show_as_percent, sort_order, applies_to, source_system, source_field_id, write_back"
      )
      .eq("show_in_builder", true)
      .order("sort_order", { ascending: true }),
    loadCorrespondences(supabase),
    supabase
      .from("user_preferences")
      .select("settings")
      .eq("user_id", session.user.id)
      .eq("dashboard_id", dashboardId)
      .maybeSingle(),
    loadSources(supabase),
    supabase
      .from("responsibles")
      .select("id, display_name, bitrix_user_id")
      .eq("active", true)
      .order("display_name"),
    supabase.from("operations").select("id, name").eq("active", true).order("name"),
  ]);
  if (!dash) return { ...EMPTY, error: "Dashboard não encontrado." };

  const widgets = (widgetsData ?? []) as Widget[];
  const widget = widgets.find((w) => w.id === widgetId);
  if (!widget || widget.visual_type !== "kanban") {
    return { ...EMPTY, error: "Widget não encontrado." };
  }
  const kanban = widget.settings?.kanban;
  if (!kanban) return { ...EMPTY, error: "Widget sem configuração." };

  const isAdmin = session.roles.includes("admin");
  const allFields = (fieldsData ?? []) as FieldDefinition[];
  const fields = allFields.filter(
    (f) =>
      f.data_type !== "calculado_agg" &&
      (!kanban.source || fieldAppliesToSource(f.applies_to, kanban.source)) &&
      (isAdmin || hasAnyRole(session.roles, f.visible_to_roles as RoleKey[]))
  );

  // Garante a definição do campo de agrupamento (mesmo fora do construtor/oculto
  // ao papel) para que as OPÇÕES do selecao virem colunas — ver kanbans/[id].
  const groupRef = kanban.dateBucket ? kanban.dateField : kanban.groupField;
  if (groupRef?.startsWith("custom:")) {
    const groupKey = groupRef.slice("custom:".length);
    if (!fields.some((f) => f.field_key === groupKey)) {
      const { data: groupDefData } = await supabase
        .from("field_definitions")
        .select(
          "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, show_in_builder, formula, allow_negative, currency_code, currency_mode, show_as_percent, sort_order, applies_to, source_system, source_field_id, write_back"
        )
        .eq("field_key", groupKey)
        .maybeSingle();
      if (groupDefData) fields.push(groupDefData as FieldDefinition);
    }
  }
  const responsibles: OptionItem[] = (respData ?? []).map((r) => ({
    id: r.id as string,
    label: r.display_name as string,
    bitrixLinked: Boolean(r.bitrix_user_id),
  }));
  const operations: OptionItem[] = (opsData ?? []).map((o) => ({
    id: o.id as string,
    label: o.name as string,
  }));
  const responsibleLabels = Object.fromEntries(
    responsibles.map((r) => [r.id, r.label])
  );

  // ---- modo tarefas: tasks do board apontado (ou todas as visíveis) ----
  if (kanban.mode === "tarefas") {
    let boardSettings: KanbanSettings = kanban;
    let q = supabase
      .from("tasks")
      .select(TASK_COLS_WITH_RECORD)
      // Subtarefas não viram card — aparecem no feed da tarefa pai.
      .is("parent_task_id", null)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(500);
    if (kanban.taskBoardId) {
      q = q.eq("board_id", kanban.taskBoardId);
      // Fases do board apontado (colunas dele).
      const { data: boardRow } = await supabase
        .from("dashboards")
        .select("settings")
        .eq("id", kanban.taskBoardId)
        .maybeSingle();
      const bk = (boardRow?.settings as DashboardSettings | null)?.kanban;
      if (bk?.columns) boardSettings = { ...kanban, columns: bk.columns };
    }
    const { data: tasksData, error } = await q;
    if (error) return { ...EMPTY, error: error.message };
    return {
      data: taskBoardData(
        (tasksData ?? []) as unknown as TaskRow[],
        boardSettings,
        responsibleLabels
      ),
      kanban: boardSettings,
      fields,
      responsibles,
      operations,
      quickCreateSource: null,
    };
  }

  // ---- modo registros: período efetivo do widget (resolver único da page) ----
  const dashSettings = (dash.settings ?? {}) as DashboardSettings;
  const prefSettings = (prefData?.settings ?? {}) as PeriodPrefs;
  const available = buildAvailableFields(allFields, correspondences, sources);
  const resolver = createPeriodResolver({
    sp,
    available,
    correspondences,
    dashSettings,
    prefSettings,
    sources,
  });
  const dataWidgets = widgets.filter(
    (w) =>
      w.visual_type !== "filtro" &&
      w.visual_type !== "filtro_campo" &&
      w.visual_type !== "forma"
  );
  const filterWidgets = widgets.filter((w) => w.visual_type === "filtro");
  const { periodByWidget } = resolver.computeWidgetPeriods(
    dataWidgets,
    filterWidgets
  );
  const period = periodByWidget[widgetId] ?? null;

  try {
    const data = await runKanban(
      supabase,
      kanban,
      period,
      fields,
      {
        responsibles: responsibleLabels,
        operations: Object.fromEntries(operations.map((o) => [o.id, o.label])),
      },
      // Colunas "Personalizar": posicionamentos escopados a ESTE widget.
      { kind: "widget", id: widgetId }
    );
    const sourceDef = sources.find((s) => s.key === kanban.source);
    const canEditValues = session.permissions.includes("edit_record_values");
    return {
      data,
      kanban,
      fields,
      responsibles,
      operations,
      quickCreateSource:
        canEditValues && sourceDef?.manualEntry
          ? { key: sourceDef.key, label: sourceDef.label }
          : null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[kanban] widget ${widgetId} falhou:`, msg);
    return { ...EMPTY, error: msg };
  }
}
