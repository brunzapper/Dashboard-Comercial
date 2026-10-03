// Versão: 1.3 | Data: 03/10/2026
// Helpers de sessão no servidor: usuário autenticado + seus papéis/permissões.
// v1.3 (03/10/2026): redução de LOG INGESTION do Supabase, mesma semântica.
//   (a) getClaims() no lugar de getUser(): o JWT é ES256 (assimétrico), então
//   a assinatura é verificada LOCALMENTE (JWKS em cache) — getUser era uma ida
//   de rede ao servidor de auth por request/action. Mesma garantia que o
//   PostgREST/RLS já dá (assinatura + exp). (b) papéis, permissões e
//   memberships (com a org de cada uma) saem de UMA RPC SECURITY INVOKER
//   (`session_context`, 0151 — as RLS valem como nas 4 consultas que ela
//   substitui); `lib/auth/org.ts` lê as memberships do MESMO loader. Sem a
//   RPC, as consultas de sempre. `SessionInfo.user` virou `SessionUser`
//   ({ id, email }) — era tudo o que o app lia do `User`.
// v1.1 (04/07/2026): adicionados requireSession/requirePermission (guards de
//   páginas server-side, complementando o proxy).
// v1.2 (17/07/2026): getUser/getSessionInfo em React cache() — auth.getUser()
//   é chamada de REDE ao servidor de auth; layout + página + sino chamavam
//   getSessionInfo 3-4× por navegação, cada uma revalidando o mesmo token.
//   Com cache(), 1 validação (+ 1 consulta de papéis) por render/request.
import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/** v1.3: o que o app usa do usuário autenticado (das claims do JWT). */
export interface SessionUser {
  id: string;
  email?: string;
}

export interface SessionInfo {
  user: SessionUser;
  roles: string[];
  permissions: string[];
}

/** v1.3: org embutida numa membership (`session_context`). */
export interface SessionMembershipOrg {
  id: string;
  name: string | null;
  app_name: string | null;
  theme: unknown;
  ui_prefs: unknown;
}

export interface SessionMembership {
  organization_id: string;
  is_org_admin: boolean;
  /** null = a RLS não deixou ver a org (mesmo efeito da consulta antiga). */
  org: SessionMembershipOrg | null;
}

interface SessionContext {
  info: SessionInfo;
  /** null = RPC indisponível — `lib/auth/org.ts` consulta como antes. */
  memberships: SessionMembership[] | null;
}

/**
 * Converte as claims do JWT no usuário da sessão. PURO (testável): sem `sub`
 * não há usuário.
 */
export function sessionUserFromClaims(
  claims: Record<string, unknown> | null | undefined
): SessionUser | null {
  const sub = claims?.sub;
  if (typeof sub !== "string" || sub === "") return null;
  const email = claims?.email;
  return typeof email === "string" && email !== ""
    ? { id: sub, email }
    : { id: sub };
}

/** Lê o jsonb de `session_context` (null se o formato não fechar). */
export function parseSessionContext(
  raw: unknown
): { roles: string[]; permissions: string[]; memberships: SessionMembership[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.roles) || !Array.isArray(d.permissions)) return null;
  if (!Array.isArray(d.memberships)) return null;
  const roles = d.roles.filter((r): r is string => typeof r === "string");
  const permissions = Array.from(
    new Set(d.permissions.filter((p): p is string => typeof p === "string"))
  );
  const memberships: SessionMembership[] = [];
  for (const m of d.memberships) {
    if (!m || typeof m !== "object") continue;
    const row = m as Record<string, unknown>;
    if (typeof row.organization_id !== "string") continue;
    const org =
      row.org && typeof row.org === "object"
        ? (row.org as SessionMembershipOrg)
        : null;
    memberships.push({
      organization_id: row.organization_id,
      is_org_admin: row.is_org_admin === true,
      org,
    });
  }
  return { roles, permissions, memberships };
}

/** Usuário + contexto, UMA vez por request/render. */
const loadSessionContext = cache(async function loadSessionContext(): Promise<
  SessionContext | null
> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const user = sessionUserFromClaims(
    data?.claims as Record<string, unknown> | undefined
  );
  if (!user) return null;

  try {
    const { data: ctx, error } = await supabase.rpc("session_context");
    const parsed = error ? null : parseSessionContext(ctx);
    if (parsed) {
      return {
        info: { user, roles: parsed.roles, permissions: parsed.permissions },
        memberships: parsed.memberships,
      };
    }
  } catch {
    // cai nas consultas de sempre
  }

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

  return { info: { user, roles, permissions }, memberships: null };
});

/** Retorna o usuário autenticado ou null (não lança). */
export const getUser = cache(async function getUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return sessionUserFromClaims(
    data?.claims as Record<string, unknown> | undefined
  );
});

/**
 * Retorna usuário + papéis + permissões efetivas, ou null se não autenticado.
 * Papéis vêm de user_roles; permissões são derivadas de role_permissions.
 */
export const getSessionInfo = cache(async function getSessionInfo(): Promise<SessionInfo | null> {
  const ctx = await loadSessionContext();
  return ctx?.info ?? null;
});

/**
 * v1.3: memberships do usuário com a org embutida (RPC), ou null quando a RPC
 * não está disponível — `lib/auth/org.ts` então consulta como antes.
 */
export async function getSessionMemberships(): Promise<SessionMembership[] | null> {
  const ctx = await loadSessionContext();
  return ctx?.memberships ?? null;
}

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
