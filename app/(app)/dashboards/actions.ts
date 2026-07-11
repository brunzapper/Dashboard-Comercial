// Versão: 1.0 | Data: 05/07/2026
// Server Actions de dashboards e widgets (client do usuário → RLS:
// dashboards/widgets exigem create_dashboards p/ criar; owner/admin p/ editar).
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PRESETS, PRESET_FIELDS } from "@/lib/presets/definitions";
import type { SourceKey } from "@/lib/sources";
import type { SavedPeriod } from "@/lib/widgets/period";
import type {
  DashboardSettings,
  Dimension,
  GridPosition,
  Metric,
  VisualType,
  WidgetFilter,
  WidgetSettings,
} from "@/lib/widgets/types";

export interface ActionState {
  ok?: boolean;
  message?: string;
}

export interface WidgetInput {
  title: string | null;
  visual_type: VisualType;
  sources?: SourceKey[];
  splitBySource?: boolean;
  dimensions: Dimension[];
  metrics: Metric[];
  filters: WidgetFilter[];
  settings?: WidgetSettings;
  grid_position?: GridPosition;
}

// ---------------- Dashboards ----------------

export async function createDashboard(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.permissions.includes("create_dashboards")) {
    return { ok: false, message: "Você não tem permissão para criar dashboards." };
  }
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "Informe um nome." };
  const visible = formData.getAll("visible_to_roles").map(String).filter(Boolean);

  const supabase = await createClient();
  const { error } = await supabase.from("dashboards").insert({
    name,
    owner_user_id: session.user.id,
    visible_to_roles: visible,
    is_shared: visible.length > 0,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/");
  return { ok: true, message: `Dashboard "${name}" criado.` };
}

export async function deleteDashboard(formData: FormData): Promise<void> {
  const session = await getSessionInfo();
  if (!session) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("dashboards").delete().eq("id", id);
  revalidatePath("/");
}

// Config por dashboard (settings jsonb): hoje só a barra de período global.
// RLS restringe update a owner/admin.
export async function updateDashboardSettings(
  dashboardId: string,
  settings: DashboardSettings
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("dashboards")
    .update({ settings })
    .eq("id", dashboardId);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/dashboards/${dashboardId}`);
  return { ok: true };
}

// Atualiza a visibilidade (papéis) de um dashboard já criado. `is_shared` é
// derivado (compartilhado quando há ao menos um papel). RLS restringe a owner/admin.
export async function updateDashboardVisibility(
  dashboardId: string,
  roles: string[]
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const clean = roles.map(String).filter(Boolean);
  const supabase = await createClient();
  const { error } = await supabase
    .from("dashboards")
    .update({ visible_to_roles: clean, is_shared: clean.length > 0 })
    .eq("id", dashboardId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/");
  revalidatePath(`/dashboards/${dashboardId}`);
  return { ok: true };
}

// Salva o último período consultado do usuário NESTE dashboard (user_preferences).
// Chamado (fire-and-forget) quando a barra de período navega. Não revalida —
// só persiste para reidratar o default na próxima visita.
export async function saveLastPeriod(
  dashboardId: string,
  period: SavedPeriod
): Promise<void> {
  const session = await getSessionInfo();
  if (!session) return;
  const supabase = await createClient();
  // Remove chaves vazias para não poluir o jsonb.
  const clean: SavedPeriod = {};
  if (period.periodo) clean.periodo = period.periodo;
  if (period.de) clean.de = period.de;
  if (period.ate) clean.ate = period.ate;
  if (period.campo) clean.campo = period.campo;
  await supabase.from("user_preferences").upsert(
    {
      user_id: session.user.id,
      dashboard_id: dashboardId,
      settings: { lastPeriod: clean },
    },
    { onConflict: "user_id,dashboard_id" }
  );
}

// Preferências GLOBAIS do usuário (user_settings), não por dashboard. Hoje só a
// barra lateral fixada. Read-modify-write para preservar chaves futuras. RLS
// garante que cada usuário só toca a própria linha. Fire-and-forget no cliente.
export interface UserAppSettings {
  sidebarPinned?: boolean;
}

export async function updateUserSettings(
  patch: UserAppSettings
): Promise<void> {
  const session = await getSessionInfo();
  if (!session) return;
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_settings")
    .select("settings")
    .eq("user_id", session.user.id)
    .maybeSingle();
  const current = (data?.settings as UserAppSettings | null) ?? {};
  await supabase.from("user_settings").upsert(
    {
      user_id: session.user.id,
      settings: { ...current, ...patch },
    },
    { onConflict: "user_id" }
  );
}

// ---------------- Widgets ----------------

export async function createWidget(
  dashboardId: string,
  input: WidgetInput
): Promise<ActionState & { id?: string }> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("widgets")
    .insert({
      dashboard_id: dashboardId,
      title: input.title,
      visual_type: input.visual_type,
      source: "records",
      sources: input.sources ?? [],
      split_by_source: input.splitBySource ?? false,
      dimensions: input.dimensions,
      metrics: input.metrics,
      filters: input.filters,
      settings: input.settings ?? {},
      grid_position: input.grid_position ?? { x: 0, y: 100, w: 6, h: 8 },
    })
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/dashboards/${dashboardId}`);
  return { ok: true, id: (data?.id as string) ?? undefined };
}

export async function updateWidget(
  widgetId: string,
  dashboardId: string,
  input: WidgetInput
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("widgets")
    .update({
      title: input.title,
      visual_type: input.visual_type,
      sources: input.sources ?? [],
      split_by_source: input.splitBySource ?? false,
      dimensions: input.dimensions,
      metrics: input.metrics,
      filters: input.filters,
      settings: input.settings ?? {},
    })
    .eq("id", widgetId);
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/dashboards/${dashboardId}`);
  return { ok: true };
}

// Grava uma célula de um widget "Tabela editável" (Fase 2). Editável por
// qualquer visualizador do dashboard — a RLS de dashboard_table_cells reforça.
// value vazio (null/"") apaga a célula; senão faz upsert. router.refresh() no
// cliente recomputa o widget; revalida por garantia para outros caminhos.
export async function saveTableCell(
  dashboardId: string,
  widgetId: string,
  rowKey: string,
  colKey: string,
  value: number | string | null
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();

  const empty = value == null || value === "";
  if (empty) {
    const { error } = await supabase
      .from("dashboard_table_cells")
      .delete()
      .eq("widget_id", widgetId)
      .eq("row_key", rowKey)
      .eq("col_key", colKey);
    if (error) return { ok: false, message: error.message };
  } else {
    const { error } = await supabase.from("dashboard_table_cells").upsert(
      {
        widget_id: widgetId,
        row_key: rowKey,
        col_key: colKey,
        value,
        updated_by: session.user.id,
      },
      { onConflict: "widget_id,row_key,col_key" }
    );
    if (error) return { ok: false, message: error.message };
  }
  revalidatePath(`/dashboards/${dashboardId}`);
  return { ok: true };
}

// Coage o valor cru (string do input) para o tipo do campo antes de gravar em
// entity_custom_values. Espelha a coerção de lib/records/actions.ts (numero/moeda,
// booleano, e texto/data/seleção como string). '' → null (apaga a célula).
function coerceEntityValue(
  dataType: string,
  raw: string
): number | string | boolean | null {
  const s = raw.trim();
  if (s === "") return null;
  if (dataType === "numero" || dataType === "moeda") {
    const n = Number(s.replace(/\./g, "").replace(",", "."));
    return Number.isNaN(Number(s)) ? (Number.isNaN(n) ? null : n) : Number(s);
  }
  if (dataType === "booleano") {
    return s === "true" ? true : s === "false" ? false : null;
  }
  return s; // texto, data (ISO), seleção
}

// Grava um valor de campo personalizado ligado a uma ENTIDADE (responsável ou
// operação), usado pelas tabelas de dashboard em modo lista por entidade. Valida
// a permissão global (edit_record_values) e a editabilidade do campo por papel
// (editable_by_roles); campos calculados nunca são graváveis. value vazio apaga.
export async function updateEntityField(
  entityType: "responsible" | "operation",
  entityId: string,
  fieldKey: string,
  rawValue: string
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.permissions.includes("edit_record_values")) {
    return { ok: false, message: "Você não tem permissão para editar valores." };
  }
  const supabase = await createClient();

  // Confere o campo: existe, não é calculado e é editável pelo papel do usuário.
  const { data: def } = await supabase
    .from("field_definitions")
    .select("data_type, editable_by_roles")
    .eq("field_key", fieldKey)
    .maybeSingle();
  if (!def) return { ok: false, message: "Campo não encontrado." };
  if ((def.data_type as string) === "calculado") {
    return { ok: false, message: "Campo calculado não é editável." };
  }
  const editable = ((def.editable_by_roles as string[]) ?? []).some((r) =>
    session.roles.includes(r)
  );
  if (!editable) {
    return { ok: false, message: "Você não pode editar este campo." };
  }

  const value = coerceEntityValue(def.data_type as string, rawValue);
  if (value == null) {
    const { error } = await supabase
      .from("entity_custom_values")
      .delete()
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .eq("field_key", fieldKey);
    if (error) return { ok: false, message: error.message };
  } else {
    const { error } = await supabase.from("entity_custom_values").upsert(
      {
        entity_type: entityType,
        entity_id: entityId,
        field_key: fieldKey,
        value,
        updated_by: session.user.id,
      },
      { onConflict: "entity_type,entity_id,field_key" }
    );
    if (error) return { ok: false, message: error.message };
  }
  revalidatePath("/dashboards/[id]", "page");
  return { ok: true };
}

// Atualiza só a coluna `settings` de um widget (usado pelas edições de aparência
// in-loco: reordenar/ordenar/colorir direto na tabela ou no gráfico). O cliente
// envia o settings completo já mesclado ({ ...widget.settings, appearance }).
// RLS restringe a owner/admin (widgets_write). router.refresh() no cliente
// recomputa; não revalidamos aqui p/ manter a edição fluida.
export async function saveWidgetSettings(
  widgetId: string,
  dashboardId: string,
  settings: WidgetSettings
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("widgets")
    .update({ settings })
    .eq("id", widgetId)
    .eq("dashboard_id", dashboardId);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function deleteWidget(
  widgetId: string,
  dashboardId: string
): Promise<void> {
  const session = await getSessionInfo();
  if (!session) return;
  const supabase = await createClient();
  await supabase.from("widgets").delete().eq("id", widgetId);
  revalidatePath(`/dashboards/${dashboardId}`);
}

// Gera os dashboards preset (idempotente): cria campos de apoio que faltam e
// os dashboards que ainda não existem para este usuário. Só admin.
export async function generatePresets(): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.roles.includes("admin")) {
    return { ok: false, message: "Apenas administradores podem gerar presets." };
  }
  const supabase = await createClient();

  // 1) Campos de apoio (pula os que já existem)
  const { data: existingFields } = await supabase
    .from("field_definitions")
    .select("field_key");
  const have = new Set((existingFields ?? []).map((f) => f.field_key as string));
  const toCreate = PRESET_FIELDS.filter((f) => !have.has(f.field_key));
  if (toCreate.length > 0) {
    await supabase.from("field_definitions").insert(
      toCreate.map((f, i) => ({
        field_key: f.field_key,
        label: f.label,
        data_type: f.data_type,
        options: f.options,
        visible_to_roles: f.visible_to_roles,
        editable_by_roles: f.editable_by_roles,
        is_local: f.is_local,
        sort_order: 100 + i,
      }))
    );
  }

  // 2) Dashboards (pula os que já existem por nome, deste usuário)
  const { data: existingDash } = await supabase
    .from("dashboards")
    .select("name")
    .eq("owner_user_id", session.user.id);
  const haveDash = new Set((existingDash ?? []).map((d) => d.name as string));

  let created = 0;
  for (const preset of PRESETS) {
    if (haveDash.has(preset.name)) continue;
    const { data: dash, error } = await supabase
      .from("dashboards")
      .insert({
        name: preset.name,
        owner_user_id: session.user.id,
        visible_to_roles: preset.visible_to_roles,
        is_shared: preset.visible_to_roles.length > 0,
      })
      .select("id")
      .maybeSingle();
    if (error || !dash?.id) continue;
    await supabase.from("widgets").insert(
      preset.widgets.map((w, i) => ({
        dashboard_id: dash.id as string,
        title: w.title,
        visual_type: w.visual_type,
        source: "records",
        dimensions: w.dimensions,
        metrics: w.metrics,
        filters: w.filters,
        settings: w.settings ?? {},
        grid_position: w.grid_position,
        sort_order: i,
      }))
    );
    created += 1;
  }

  revalidatePath("/");
  return {
    ok: true,
    message:
      created > 0
        ? `${created} dashboard(s) preset criado(s).`
        : "Presets já existiam (nada a criar).",
  };
}

export async function saveLayout(
  dashboardId: string,
  items: { id: string; x: number; y: number; w: number; h: number }[]
): Promise<ActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  for (const it of items) {
    await supabase
      .from("widgets")
      .update({ grid_position: { x: it.x, y: it.y, w: it.w, h: it.h } })
      .eq("id", it.id)
      .eq("dashboard_id", dashboardId);
  }
  return { ok: true };
}
