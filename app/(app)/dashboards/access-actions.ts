// Versão: 1.0 | Data: 23/07/2026
// Server Actions do dialog "Acesso" do board (menu ⋮): compartilhamento por
// FUNÇÃO (visible_to_roles — camada existente) + por PESSOA (board_access,
// 0088 — 'view'/'edit'/'blocked'; override individual vence o papel; dono e
// admin nunca são bloqueáveis). Gestão restrita a dono/admin — espelho do
// helper auth_board_manageable (a RLS de board_access é a barreira
// definitiva); a listagem de contas usa service role (auth.users não é
// listável pelo client), por isso o gate manual abre cada action.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo, type SessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { ActionState } from "./actions";

export type BoardAccessLevel = "view" | "edit" | "blocked";

export interface BoardAccessEntry {
  userId: string;
  email: string;
  level: BoardAccessLevel;
}

export interface BoardAccessState {
  ok: boolean;
  message?: string;
  // Papéis com acesso (visible_to_roles do board).
  roles: string[];
  // Overrides individuais vigentes.
  entries: BoardAccessEntry[];
  // Contas disponíveis p/ conceder (todas menos o dono — dono não é alvo).
  users: { id: string; email: string }[];
}

const EMPTY: BoardAccessState = { ok: false, roles: [], entries: [], users: [] };

// Dono do board ou admin? (mesma regra do auth_board_manageable/0088)
async function ensureManageBoard(
  boardId: string
): Promise<
  | { session: SessionInfo; ownerUserId: string; kind: string }
  | { error: string }
> {
  const session = await getSessionInfo();
  if (!session) return { error: "Sessão expirada." };
  const supabase = await createClient();
  const { data: dash } = await supabase
    .from("dashboards")
    .select("id, owner_user_id, kind")
    .eq("id", boardId)
    .maybeSingle();
  if (!dash) return { error: "Board não encontrado." };
  const isAdmin = session.roles.includes("admin");
  const isOwner = dash.owner_user_id === session.user.id;
  if (!isAdmin && !isOwner) return { error: "Sem permissão." };
  return {
    session,
    ownerUserId: dash.owner_user_id as string,
    kind: (dash.kind as string) ?? "dashboard",
  };
}

function revalidateBoard(boardId: string, kind: string) {
  revalidatePath("/");
  revalidatePath(
    kind === "kanban" ? `/kanbans/${boardId}` : `/dashboards/${boardId}`
  );
}

// Estado do dialog (lazy, no open): papéis + overrides + contas.
export async function getBoardAccessState(
  boardId: string
): Promise<BoardAccessState> {
  const access = await ensureManageBoard(boardId);
  if ("error" in access) return { ...EMPTY, message: access.error };

  const supabase = await createClient();
  const service = createServiceClient();
  const [{ data: dash }, { data: accessRows }, { data: usersData }] =
    await Promise.all([
      supabase
        .from("dashboards")
        .select("visible_to_roles, organization_id")
        .eq("id", boardId)
        .maybeSingle(),
      supabase
        .from("board_access")
        .select("user_id, level")
        .eq("dashboard_id", boardId),
      service.auth.admin.listUsers({ perPage: 1000 }),
    ]);

  // Multi-org (0089): só contas da MESMA org do board podem receber override.
  const boardOrgId = (dash?.organization_id as string | null) ?? null;
  let memberIds: Set<string> | null = null;
  if (boardOrgId) {
    const { data: memberRows } = await service
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", boardOrgId);
    memberIds = new Set((memberRows ?? []).map((m) => m.user_id as string));
  }

  const emailById = new Map<string, string>(
    (usersData?.users ?? []).map((u) => [u.id, u.email ?? "(sem email)"])
  );
  const entries: BoardAccessEntry[] = (accessRows ?? [])
    .map((r) => ({
      userId: r.user_id as string,
      email: emailById.get(r.user_id as string) ?? "(conta removida)",
      level: r.level as BoardAccessLevel,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
  // Dono fora da lista de alvos (nunca bloqueável; override seria inócuo).
  const users = (usersData?.users ?? [])
    .filter((u) => u.id !== access.ownerUserId)
    .filter((u) => !memberIds || memberIds.has(u.id))
    .map((u) => ({ id: u.id, email: u.email ?? "(sem email)" }))
    .sort((a, b) => a.email.localeCompare(b.email));

  return {
    ok: true,
    roles: ((dash?.visible_to_roles ?? []) as string[]).map(String),
    entries,
    users,
  };
}

// Define/remove o override de UMA pessoa (level null = remover — volta a valer
// só o papel). Upsert pelo client autenticado: a RLS board_access_write
// (dono/admin) é a barreira definitiva.
export async function setBoardAccessEntry(
  boardId: string,
  userId: string,
  level: BoardAccessLevel | null
): Promise<ActionState> {
  const access = await ensureManageBoard(boardId);
  if ("error" in access) return { ok: false, message: access.error };
  if (!userId) return { ok: false, message: "Usuário inválido." };
  if (userId === access.ownerUserId) {
    return { ok: false, message: "O dono do board não pode receber override." };
  }
  if (level && !["view", "edit", "blocked"].includes(level)) {
    return { ok: false, message: "Nível inválido." };
  }

  const supabase = await createClient();
  const { error } = level
    ? await supabase.from("board_access").upsert(
        {
          dashboard_id: boardId,
          user_id: userId,
          level,
          granted_by: access.session.user.id,
        },
        { onConflict: "dashboard_id,user_id" }
      )
    : await supabase
        .from("board_access")
        .delete()
        .eq("dashboard_id", boardId)
        .eq("user_id", userId);
  if (error) return { ok: false, message: error.message };
  revalidateBoard(boardId, access.kind);
  return { ok: true };
}

// Compartilhamento por FUNÇÃO (visible_to_roles) — mesmo efeito do
// updateDashboardVisibility, mas revalida também a rota de kanban.
export async function setBoardRoles(
  boardId: string,
  roles: string[]
): Promise<ActionState> {
  const access = await ensureManageBoard(boardId);
  if ("error" in access) return { ok: false, message: access.error };
  const clean = roles.map(String).filter(Boolean);
  const supabase = await createClient();
  const { error } = await supabase
    .from("dashboards")
    .update({ visible_to_roles: clean, is_shared: clean.length > 0 })
    .eq("id", boardId);
  if (error) return { ok: false, message: error.message };
  revalidateBoard(boardId, access.kind);
  return { ok: true };
}
