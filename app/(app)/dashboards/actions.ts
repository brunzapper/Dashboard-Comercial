// Versão: 1.0 | Data: 05/07/2026
// Server Actions de dashboards e widgets (client do usuário → RLS:
// dashboards/widgets exigem create_dashboards p/ criar; owner/admin p/ editar).
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PRESETS, PRESET_FIELDS } from "@/lib/presets/definitions";
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
