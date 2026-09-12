// Versão: 1.7 | Data: 12/09/2026
// v1.7 (12/09/2026): areaAccessLabel — rótulo pt-BR de QUEM alcança uma área,
//   derivado de AREA_GATES. É o "nível de acesso" dos cards de Operação no hub
//   (o que dashboards/kanbans já exibiam a partir de visible_to_roles). PURO:
//   descreve a régua da área, não o veredito de quem está olhando.
// v1.6 (08/09/2026): área `workflow` (0125) — SEM gate de papel, como
//   `remuneracao`: a page ramifica (admin configura os esquemas; os demais
//   só EXECUTAM o formulário). A escrita dos esquemas segue admin nas
//   actions + RLS de workflow_schemas.
// Acessos customizados por usuário (0094): overrides individuais de ÁREAS de
// Configurações e de BASES — deny vence tudo; allow vence o gate de papel;
// v1.5 (05/08/2026): Remuneração moveu p/ /operacao/remuneracao (área
//   Operação, cards do hub) — chave "remuneracao" segue histórica; só o
//   rótulo da matriz de Acessos ganhou o sufixo de localização.
// v1.4 (31/07/2026): recursos SOB DEMANDA por org (0114) — AREA_FEATURES liga
//   área → feature de org_features; feature-off vence TUDO (até override
//   allow: não dá para "allowar" recurso que a org não contratou). Precedência
//   completa: feature-off > deny > allow > gate de papel. Vale na page
//   (requireSettingsArea/checkSettingsArea) E na escrita (isSettingsAreaDenied).
// v1.3 (30/07/2026): área "remuneracao" (0112) — sem gate de papel (a page
//   ramifica: admin gere, vendedor vê a própria; RLS protege os valores).
// sem override vale o gate atual. AREA_GATES é a fonte ÚNICA dos gates por
// aba (o layout de Configurações e o guard requireSettingsArea leem daqui).
// v1.2 (27/07/2026): chaves de área são HISTÓRICAS e desacopladas da rota —
//   fontes/log vivem em /registros/*, moedas em /campos; NUNCA renomear uma
//   chave (user_access_overrides gravados a referenciam). Novo helper
//   checkSettingsArea (gate sem redirect, p/ esconder links) e área "tema".
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
import {
  ROLE_LABELS,
  SPECIAL_ROLE_LABELS,
  type RoleKey,
} from "@/lib/auth/roles";
import {
  loadOrgFeatures,
  type OrgFeatureKey,
} from "@/lib/config/org-features";

export type OverrideEffect = "allow" | "deny";

// Gates por área. A chave é HISTÓRICA (foi o último segmento da rota original
// de Configurações) e NUNCA muda — user_access_overrides gravados a
// referenciam. Hoje fontes/log vivem em /registros/* e moedas em /campos;
// as demais espelham o ALL_TABS do layout de Configurações.
export const AREA_GATES: Record<
  string,
  { role?: string; permission?: string; orgAdmin?: boolean }
> = {
  organizacao: { orgAdmin: true },
  operacoes: { role: "admin" },
  responsaveis: { role: "admin" },
  metas: { role: "admin" },
  // Remuneração variável (0112): SEM gate de papel — a page ramifica por papel
  // (admin = gestão completa; demais = "Minha remuneração", read-only, com a
  // RLS de comp_entries entregando só o próprio grupo canônico). Deny esconde
  // a área inteira; a escrita segue admin nas actions + RLS.
  // Chave histórica — página em /operacao/remuneracao desde 05/08/2026 (card
  // de Operação do hub Workspace; precedente fontes/log/moedas).
  remuneracao: {},
  // Mapeamentos de valores (0117): card de Operação org-específico (feature
  // "mapeamentos"); gestão é de admin (escreve em value_mappings + registros).
  mapeamentos: { role: "admin" },
  // Workflow (0125): card de Operação org-específico (feature "workflow").
  // SEM gate de papel — quem tem permissão de criar registros EXECUTA o
  // formulário; configurar o esquema é admin (actions + RLS). Deny esconde a
  // área inteira. Chave histórica a partir de 08/09/2026 — nunca renomear.
  workflow: {},
  fontes: { role: "admin" }, // chave histórica — página em /registros/bases
  presets: { role: "admin" },
  snapshots: { role: "admin" },
  integracoes: { role: "admin" },
  acessos: { role: "admin" },
  moedas: {}, // chave histórica — aba Moedas de /campos
  usuarios: { permission: "manage_users_roles" },
  log: {}, // chave histórica — página em /registros/log
  tema: {}, // preferências visuais próprias — qualquer autenticado
  conta: {},
};

// Rótulos p/ a matriz da tela de Acessos (subset gerenciável — áreas sem gate
// também entram: deny as esconde). "tema"/"conta" ficam de fora (pref pessoal).
export const AREA_LABELS: Record<string, string> = {
  operacoes: "Operações",
  responsaveis: "Responsáveis",
  metas: "Metas",
  remuneracao: "Remuneração (Operação)",
  mapeamentos: "Mapeamentos (Operação)",
  workflow: "Workflow (Operação)",
  fontes: "Bases (Registros)",
  presets: "Presets",
  snapshots: "Snapshots",
  integracoes: "Integrações",
  moedas: "Moedas (Campos)",
  usuarios: "Usuários",
  log: "Log (Registros)",
};

/** Rótulos de acesso por permissão (só as usadas como gate de área). */
const PERMISSION_ACCESS_LABELS: Record<string, string> = {
  manage_users_roles: "Quem gerencia usuários",
  manage_field_definitions: "Quem gerencia campos",
  create_dashboards: "Quem cria dashboards",
};

/**
 * Rótulo pt-BR de QUEM alcança uma área — o "nível de acesso" exibido nos cards
 * de Operação do hub, espelho do que dashboards/kanbans já mostravam. PURO
 * (deriva de AREA_GATES; nada de consulta): descreve a régua, não o veredito de
 * quem está olhando — quem não alcança a área nem vê o card.
 * Área sem gate de papel e card sem área ⇒ "Todos os usuários".
 */
export function areaAccessLabel(areaKey?: string): string {
  const gate = areaKey ? AREA_GATES[areaKey] : undefined;
  if (!gate) return "Todos os usuários";
  if (gate.orgAdmin) return SPECIAL_ROLE_LABELS.org_admin;
  if (gate.role) return `${ROLE_LABELS[gate.role as RoleKey] ?? gate.role}es`;
  if (gate.permission) return PERMISSION_ACCESS_LABELS[gate.permission] ?? "Restrito";
  return "Todos os usuários";
}

// Áreas que só existem com o recurso SOB DEMANDA da org ligado (org_features,
// 0114). Feature-off vence TUDO — inclusive override allow — e barra page,
// aba e escrita. A chave de área segue HISTÓRICA; a de feature vem do
// catálogo ORG_FEATURES (lib/config/org-features.ts).
export const AREA_FEATURES: Partial<Record<string, OrgFeatureKey>> = {
  remuneracao: "remuneracao",
  mapeamentos: "mapeamentos",
  workflow: "workflow", // v1.6 (08/09/2026)
};

/** O recurso sob demanda da área está ligado para a org ativa? Áreas sem
 * entrada em AREA_FEATURES passam direto. Fail-closed (sem org = off). */
const areaFeatureEnabled = cache(async function areaFeatureEnabled(
  areaKey: string
): Promise<boolean> {
  const feature = AREA_FEATURES[areaKey];
  if (!feature) return true;
  const org = await getActiveOrg();
  if (!org) return false;
  const supabase = await createClient();
  const features = await loadOrgFeatures(supabase, org.id);
  return features[feature];
});

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
  // Recurso sob demanda desligado barra a escrita como um deny (precedência
  // máxima — fecha o bypass da action direta numa org sem o recurso).
  if (!(await areaFeatureEnabled(areaKey))) return true;
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
  const allowed = await checkSettingsArea(areaKey);
  if (!allowed) redirect("/");
  return session;
}

/**
 * Variante SEM redirect do gate de área: decide se o usuário atual pode ver
 * uma página/link de área (mesma composição papel × overrides). Usada p/
 * condicionar links de navegação (ex.: botões Bases/Log no header de
 * Registros) — a page destino segue autoprotegida por requireSettingsArea.
 */
export async function checkSettingsArea(areaKey: string): Promise<boolean> {
  const session = await getSessionInfo();
  if (!session) return false;
  // Feature-off vence tudo (antes de deny/allow): área de recurso sob demanda
  // simplesmente não existe numa org sem o recurso.
  if (!(await areaFeatureEnabled(areaKey))) return false;
  const [org, overrides] = await Promise.all([
    getActiveOrg(),
    loadOwnSettingsOverrides(),
  ]);
  return canAccessSettingsArea(
    areaRoleAllowed(
      areaKey,
      session.roles,
      session.permissions,
      org?.isOrgAdmin ?? false
    ),
    overrides.get(areaKey)
  );
}
