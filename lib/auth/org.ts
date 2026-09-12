// Versão: 1.2 | Data: 12/09/2026
// v1.2 (12/09/2026): ActiveOrg.uiPrefs — padrão de INTERFACE da org + travas
//   por chave (ui_prefs, 0141), consumido por resolveUiPrefs
//   (lib/config/ui-prefs.ts). O select tolera a coluna ausente pelo MESMO
//   fallback do theme (pré-migração ⇒ padrão vazio).
// v1.1 (27/07/2026): ActiveOrg.theme — padrão visual da org (0108), consumido
//   por resolveTheme (lib/theme.ts); select tolera a coluna ausente
//   (pré-migração ⇒ theme null).
// Contexto de ORGANIZAÇÃO ativa (multi-org, 0089+): a org escolhida no
// pós-login vive num cookie httpOnly, mas o cookie NUNCA é confiado — toda
// leitura revalida a membership no banco (organization_members, via RLS).
// Usuário comum tem UMA org (o cookie é redundante); o cookie existe para o
// multi-org (Owner/admin de várias orgs) escolher o recorte da vez. A RLS é a
// muralha (isolamento vale mesmo sem o .eq dos loaders); o filtro explícito
// por organization_id só resolve a VISÃO de quem pertence a 2+ orgs.
// Resiliência pré-migração: tabela ausente/sem memberships ⇒ null (o app
// segue funcionando como single-tenant até a 0089 ser aplicada).
import { cache } from "react";
import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { getSessionInfo } from "@/lib/auth/session";
import { normalizeOrgTheme, type OrgThemeDefault } from "@/lib/theme";
import {
  EMPTY_ORG_UI_PREFS,
  normalizeOrgUiPrefs,
  type OrgUiPrefs,
} from "@/lib/config/ui-prefs";

export const ORG_COOKIE = "active_org";

export interface ActiveOrg {
  id: string;
  name: string;
  appName: string;
  isOrgAdmin: boolean;
  // O usuário pertence a 2+ orgs (mostra "Trocar organização" no sidebar).
  multiOrg: boolean;
  // Padrão visual da org (0108) — null sem padrão/pré-migração.
  theme: OrgThemeDefault | null;
  // Padrão de INTERFACE da org + travas por chave (0141). Pré-migração /
  // sem padrão ⇒ EMPTY_ORG_UI_PREFS (nunca null: resolveUiPrefs itera sempre).
  uiPrefs: OrgUiPrefs;
}

interface Membership {
  organization_id: string;
  is_org_admin: boolean;
}

/** Memberships do usuário logado (RLS: só as próprias). */
export const getMemberships = cache(async function getMemberships(): Promise<
  Membership[]
> {
  const session = await getSessionInfo();
  if (!session) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("organization_members")
      .select("organization_id, is_org_admin")
      .eq("user_id", session.user.id);
    return (data ?? []) as Membership[];
  } catch {
    return [];
  }
});

/**
 * Org ATIVA do usuário: cookie validado contra membership; sem cookie válido,
 * cai na única membership (usuário comum). Multi-org sem cookie ⇒ null org —
 * o layout redireciona para /escolher-organizacao.
 */
export const getActiveOrg = cache(async function getActiveOrg(): Promise<
  ActiveOrg | null
> {
  const memberships = await getMemberships();
  if (memberships.length === 0) return null;

  const cookieStore = await cookies();
  const wanted = cookieStore.get(ORG_COOKIE)?.value;
  const chosen =
    memberships.find((m) => m.organization_id === wanted) ??
    (memberships.length === 1 ? memberships[0] : null);
  if (!chosen) return null;

  const supabase = await createClient();
  // Pré-migração 0108/0141 (coluna theme/ui_prefs ausente): o select completo
  // falha — refaz sem as colunas para não derrubar o contexto de org inteiro.
  let { data: org } = await supabase
    .from("organizations")
    .select("id, name, app_name, theme, ui_prefs")
    .eq("id", chosen.organization_id)
    .maybeSingle();
  if (!org) {
    const fallback = await supabase
      .from("organizations")
      .select("id, name, app_name")
      .eq("id", chosen.organization_id)
      .maybeSingle();
    org = fallback.data
      ? { ...fallback.data, theme: null, ui_prefs: null }
      : null;
  }
  if (!org) return null;
  return {
    id: org.id as string,
    name: (org.name as string) ?? "",
    appName: (org.app_name as string) || "Dashboard Comercial",
    isOrgAdmin: chosen.is_org_admin,
    multiOrg: memberships.length > 1,
    theme: normalizeOrgTheme(org.theme),
    uiPrefs: org.ui_prefs ? normalizeOrgUiPrefs(org.ui_prefs) : EMPTY_ORG_UI_PREFS,
  };
});

/** Atalho: id da org ativa (null pré-migração/sem escolha). */
export async function getActiveOrgId(): Promise<string | null> {
  const org = await getActiveOrg();
  return org?.id ?? null;
}
