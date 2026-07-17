// Versão: 1.2 | Data: 17/07/2026
// Helpers de sessão no servidor: usuário autenticado + seus papéis/permissões.
// v1.1 (04/07/2026): adicionados requireSession/requirePermission (guards de
//   páginas server-side, complementando o proxy).
// v1.2 (17/07/2026): getUser/getSessionInfo em React cache() — auth.getUser()
//   é chamada de REDE ao servidor de auth; layout + página + sino chamavam
//   getSessionInfo 3-4× por navegação, cada uma revalidando o mesmo token.
//   Com cache(), 1 validação (+ 1 consulta de papéis) por render/request.
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export interface SessionInfo {
  user: User;
  roles: string[];
  permissions: string[];
}

/** Retorna o usuário autenticado ou null (não lança). */
export const getUser = cache(async function getUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
});

/**
 * Retorna usuário + papéis + permissões efetivas, ou null se não autenticado.
 * Papéis vêm de user_roles; permissões são derivadas de role_permissions.
 */
export const getSessionInfo = cache(async function getSessionInfo(): Promise<SessionInfo | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role_key")
    .eq("user_id", user.id);

  const roles = (roleRows ?? []).map((r) => r.role_key as string);

  let permissions: string[] = [];
  if (roles.length > 0) {
    const { data: permRows } = await supabase
      .from("role_permissions")
      .select("permission_key")
      .in("role_key", roles);
    permissions = Array.from(
      new Set((permRows ?? []).map((p) => p.permission_key as string))
    );
  }

  return { user, roles, permissions };
});

/** Exige sessão; redireciona para /login se ausente. */
export async function requireSession(): Promise<SessionInfo> {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  return session;
}

/**
 * Exige uma permissão específica. Redireciona para a home se o usuário estiver
 * autenticado mas sem a permissão (a RLS ainda é a barreira definitiva).
 */
export async function requirePermission(
  permission: string
): Promise<SessionInfo> {
  const session = await requireSession();
  if (!session.permissions.includes(permission)) {
    redirect("/");
  }
  return session;
}

/** Exige um papel específico (ex.: 'admin'). */
export async function requireRole(role: string): Promise<SessionInfo> {
  const session = await requireSession();
  if (!session.roles.includes(role)) {
    redirect("/");
  }
  return session;
}
