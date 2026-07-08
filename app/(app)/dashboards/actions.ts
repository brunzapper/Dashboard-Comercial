// Versão: 1.0 | Data: 05/07/2026
// Server Actions de dashboards e widgets (client do usuário → RLS:
// dashboards/widgets exigem create_dashboards p/ criar; owner/admin p/ editar).
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type {
  Dimension,
  GridPosition,
  Metric,
  VisualType,
  WidgetFilter,
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
