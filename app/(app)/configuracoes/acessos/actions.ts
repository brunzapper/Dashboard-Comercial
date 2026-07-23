// Versão: 1.0 | Data: 23/07/2026
// Server Actions da tela Configurações → Acessos (0094): overrides
// individuais por usuário — áreas de Configurações (allow/deny), bases
// (deny) e boards (reusa board_access/0088 via setBoardAccessEntry). Gate
// admin; RLS de user_access_overrides (admin da org) é a barreira definitiva.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrg } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { type OverrideEffect } from "@/lib/auth/access";
import type { BoardAccessLevel } from "@/app/(app)/dashboards/access-actions";

export interface AccessActionState {
  ok?: boolean;
  message?: string;
}

export interface UserAccessState {
  ok: boolean;
  message?: string;
  // settings_area → effect; source key → effect (só deny é útil em bases).
  areas: Record<string, OverrideEffect>;
  sources: Record<string, OverrideEffect>;
  // board_access do usuário (dashboard_id → level).
  boards: Record<string, BoardAccessLevel>;
}

async function ensureAdmin(): Promise<
  { orgId: string | null } | { error: string }
> {
  const session = await getSessionInfo();
  if (!session) return { error: "Sessão expirada." };
  if (!session.roles.includes("admin")) return { error: "Apenas administradores." };
  const org = await getActiveOrg();
  return { orgId: org?.id ?? null };
}

export async function getUserAccessState(
  userId: string
): Promise<UserAccessState> {
  const gate = await ensureAdmin();
  if ("error" in gate) {
    return { ok: false, message: gate.error, areas: {}, sources: {}, boards: {} };
  }
  const supabase = await createClient();
  const [{ data: overrides }, { data: boardRows }] = await Promise.all([
    supabase
      .from("user_access_overrides")
      .select("resource_type, resource_key, effect")
      .eq("user_id", userId),
    supabase
      .from("board_access")
      .select("dashboard_id, level")
      .eq("user_id", userId),
  ]);
  const areas: Record<string, OverrideEffect> = {};
  const sources: Record<string, OverrideEffect> = {};
  for (const o of overrides ?? []) {
    const key = o.resource_key as string;
    const effect = o.effect as OverrideEffect;
    if (o.resource_type === "settings_area") areas[key] = effect;
    else sources[key] = effect;
  }
  const boards: Record<string, BoardAccessLevel> = {};
  for (const b of boardRows ?? []) {
    boards[b.dashboard_id as string] = b.level as BoardAccessLevel;
  }
  return { ok: true, areas, sources, boards };
}

export async function setAccessOverride(
  userId: string,
  resourceType: "source" | "settings_area",
  resourceKey: string,
  effect: OverrideEffect | null
): Promise<AccessActionState> {
  const gate = await ensureAdmin();
  if ("error" in gate) return { ok: false, message: gate.error };
  if (!gate.orgId) return { ok: false, message: "Organização não encontrada." };
  if (!userId || !resourceKey) return { ok: false, message: "Dados inválidos." };
  const session = await getSessionInfo();
  if (effect === "deny" && userId === session?.user.id) {
    // Anti-lockout básico: admin não se auto-nega (poderia perder a própria
    // tela de Acessos).
    return { ok: false, message: "Você não pode negar acesso a si mesmo." };
  }

  const supabase = await createClient();
  const { error } = effect
    ? await supabase.from("user_access_overrides").upsert(
        {
          organization_id: gate.orgId,
          user_id: userId,
          resource_type: resourceType,
          resource_key: resourceKey,
          effect,
          granted_by: session?.user.id ?? null,
        },
        { onConflict: "organization_id,user_id,resource_type,resource_key" }
      )
    : await supabase
        .from("user_access_overrides")
        .delete()
        .eq("organization_id", gate.orgId)
        .eq("user_id", userId)
        .eq("resource_type", resourceType)
        .eq("resource_key", resourceKey);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/configuracoes/acessos");
  return { ok: true };
}
