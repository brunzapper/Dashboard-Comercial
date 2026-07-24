// Versão: 1.1 | Data: 24/07/2026
// Acessos customizados por usuário (0094): overrides individuais de ÁREAS de
// Configurações e de BASES — deny vence tudo; allow vence o gate de papel;
// sem override vale o gate atual. AREA_GATES é a fonte ÚNICA dos gates por
// aba (o layout de Configurações e o guard requireSettingsArea leem daqui).
// v1.1 (24/07/2026): o override `deny` de uma área agora BARRA também a ESCRITA
//   (isSettingsAreaDenied), não só a page/aba — antes um admin negado ainda
//   escrevia chamando a server action direto. `allow` continua NÃO concedendo
//   escrita (segue o papel/RLS): é um estreitamento puro, nunca concede acesso
//   novo a quem não tem o papel.
import { cache } from "react";
import { redirect } from "next/navigation";

import { getSessionInfo, type SessionInfo } from "@/lib/auth/session";
import { getActiveOrg } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";

export type OverrideEffect = "allow" | "deny";

// Gates por área (slug = último segmento da rota de Configurações). Espelha o
// ALL_TABS do layout — mudou lá, muda aqui.
export const AREA_GATES: Record<
  string,
  { role?: string; permission?: string; orgAdmin?: boolean }
> = {
  organizacao: { orgAdmin: true },
  operacoes: { role: "admin" },
  responsaveis: { role: "admin" },
  metas: { role: "admin" },
  fontes: { role: "admin" },
  presets: { role: "admin" },
  snapshots: { role: "admin" },
  integracoes: { role: "admin" },
  acessos: { role: "admin" },
  moedas: {},
  usuarios: { permission: "manage_users_roles" },
  log: {},
  conta: {},
};

// Rótulos p/ a matriz da tela de Acessos (subset gerenciável — áreas sem gate
// também entram: deny as esconde).
export const AREA_LABELS: Record<string, string> = {
  operacoes: "Operações",
  responsaveis: "Responsáveis",
  metas: "Metas",
  fontes: "Bases",
  presets: "Presets",
  snapshots: "Snapshots",
  integracoes: "Integrações",
  moedas: "Moedas",
  usuarios: "Usuários",
  log: "Log",
};

/** Overrides de settings_area do PRÓPRIO usuário (RLS: linhas próprias). */
export const loadOwnSettingsOverrides = cache(
  async function loadOwnSettingsOverrides(): Promise<
    Map<string, OverrideEffect>
  > {
    const session = await getSessionInfo();
    if (!session) return new Map();
    try {
      const supabase = await createClient();
      const { data } = await supabase
        .from("user_access_overrides")
        .select("resource_key, effect")
        .eq("user_id", session.user.id)
        .eq("resource_type", "settings_area");
      return new Map(
        (data ?? []).map((r) => [
          r.resource_key as string,
          r.effect as OverrideEffect,
        ])
      );
    } catch {
      // Pré-migração (tabela ausente): sem overrides.
      return new Map();
    }
  }
);

/**
 * A área está DENY para o usuário atual? Usado pelos guards de ESCRITA das
 * server actions de Configurações: o override `deny` passa a barrar a escrita,
 * não só a page (fecha o bypass da action direta). NÃO substitui o gate de
 * papel — compõe com ele (o guard segue exigindo admin/permissão). Fail-open no
 * erro de leitura (loadOwnSettingsOverrides já devolve mapa vazio) = status quo:
 * jamais concede escrita a quem não tem o papel.
 */
export async function isSettingsAreaDenied(areaKey: string): Promise<boolean> {
  const overrides = await loadOwnSettingsOverrides();
  return overrides.get(areaKey) === "deny";
}

/** O gate de papel/permissão/orgAdmin da área permite este usuário? */
export function areaRoleAllowed(
  areaKey: string,
  roles: string[],
  permissions: string[],
  isOrgAdmin: boolean
): boolean {
  const gate = AREA_GATES[areaKey];
  if (!gate) return false;
  if (gate.role && !roles.includes(gate.role)) return false;
  if (gate.permission && !permissions.includes(gate.permission)) return false;
  if (gate.orgAdmin && !isOrgAdmin) return false;
  return true;
}

/** Resolução efetiva: deny vence tudo; allow vence o papel; senão o gate. */
export function canAccessSettingsArea(
  roleAllowed: boolean,
  override: OverrideEffect | undefined
): boolean {
  if (override === "deny") return false;
  if (override === "allow") return true;
  return roleAllowed;
}

/**
 * Guard de sub-page de Configurações: substitui requireRole("admin")/
 * requirePermission nas pages — honra os overrides individuais (allow E deny).
 */
export async function requireSettingsArea(
  areaKey: string
): Promise<SessionInfo> {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  const [org, overrides] = await Promise.all([
    getActiveOrg(),
    loadOwnSettingsOverrides(),
  ]);
  const allowed = canAccessSettingsArea(
    areaRoleAllowed(
      areaKey,
      session.roles,
      session.permissions,
      org?.isOrgAdmin ?? false
    ),
    overrides.get(areaKey)
  );
  if (!allowed) redirect("/");
  return session;
}
