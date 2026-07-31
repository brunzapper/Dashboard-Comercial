// Versão: 1.4 | Data: 31/07/2026
// Seção "Configurações": agrupa as telas admin (Operações, Responsáveis, Metas,
// Usuários) como sub-abas. Cada sub-aba mantém o mesmo
// v1.4 (31/07/2026): recursos SOB DEMANDA por org (0114) — a aba de área com
//   entrada em AREA_FEATURES some quando o feature da org está off
//   (disabledAreas, computado aqui via loadOrgFeatures; a page/action seguem
//   autoprotegidas pelo gate de access.ts).
// v1.3 (30/07/2026): aba "Remuneração" (0112) — sem gate de papel (a page
//   ramifica admin/vendedor; ver AREA_GATES.remuneracao).
// gating de papel/permissão de quando eram itens de topo. Sub-páginas ainda
// aplicam requireRole/requirePermission — este layout só decide quais abas mostrar.
// v1.2 (27/07/2026): Bases (fontes) e Log moveram para /registros/*, Moedas
//   virou aba de /campos — saem do ALL_TABS, mas as CHAVES de área seguem em
//   AREA_GATES (histórico — overrides gravados; nunca renomear). Nova aba
//   "Tema" (preferências visuais — qualquer autenticado).
// v1.1 (23/07/2026): aba "Organização" (multi-org, 0089) — gate orgAdmin
//   (flag de organization_members, não é papel de user_roles) — e aba
//   "Acessos" (0094). A filtragem passa a honrar os OVERRIDES individuais
//   (lib/auth/access.ts): deny esconde a aba mesmo de quem o papel daria;
//   allow a concede além do papel. Os gates por área vivem em AREA_GATES
//   (fonte única — o ALL_TABS daqui só nomeia/ordena).
import { redirect } from "next/navigation";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrg } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import {
  AREA_FEATURES,
  areaRoleAllowed,
  canAccessSettingsArea,
  loadOwnSettingsOverrides,
  type OverrideEffect,
} from "@/lib/auth/access";
import { loadOrgFeatures } from "@/lib/config/org-features";
import {
  SettingsTabs,
  type SettingsTab,
} from "@/components/configuracoes/settings-tabs";

// Tema (preferências visuais) e Conta (senha própria) não têm gating: valem
// para qualquer autenticado. As demais seguem restritas por papel/permissão;
// "Organização" exige org_admin (0089). Bases/Log vivem em /registros/* e
// Moedas em /campos (mesmas chaves de área — ver AREA_GATES).
const ALL_TABS: SettingsTab[] = [
  { href: "/configuracoes/organizacao", label: "Organização" },
  { href: "/configuracoes/operacoes", label: "Operações" },
  { href: "/configuracoes/responsaveis", label: "Responsáveis" },
  { href: "/configuracoes/metas", label: "Metas" },
  { href: "/configuracoes/remuneracao", label: "Remuneração" },
  { href: "/configuracoes/presets", label: "Presets" },
  { href: "/configuracoes/snapshots", label: "Snapshots" },
  { href: "/configuracoes/integracoes", label: "Integrações" },
  { href: "/configuracoes/acessos", label: "Acessos" },
  { href: "/configuracoes/usuarios", label: "Usuários" },
  { href: "/configuracoes/tema", label: "Tema" },
  { href: "/configuracoes/conta", label: "Conta" },
];

const areaKeyOf = (href: string) => href.split("/").pop() ?? "";

export function allowedSettingsTabs(
  roles: string[],
  permissions: string[],
  isOrgAdmin = false,
  overrides: Map<string, OverrideEffect> = new Map(),
  // Áreas de recurso sob demanda DESLIGADO na org (0114) — somem antes de
  // qualquer override (feature-off vence allow).
  disabledAreas: ReadonlySet<string> = new Set()
): SettingsTab[] {
  return ALL_TABS.filter((t) => {
    const key = areaKeyOf(t.href);
    if (disabledAreas.has(key)) return false;
    // "conta" é sempre do próprio usuário — override não a esconde.
    if (key === "conta") return true;
    return canAccessSettingsArea(
      areaRoleAllowed(key, roles, permissions, isOrgAdmin),
      overrides.get(key)
    );
  }).map(({ href, label }) => ({ href, label }));
}

/** Áreas com recurso sob demanda DESLIGADO para a org ativa (0114). */
export async function loadDisabledFeatureAreas(
  org: { id: string } | null
): Promise<Set<string>> {
  const supabase = await createClient();
  const features = await loadOrgFeatures(supabase, org?.id ?? null);
  return new Set(
    Object.entries(AREA_FEATURES)
      .filter(([, feature]) => !feature || !features[feature])
      .map(([area]) => area)
  );
}

export default async function ConfiguracoesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionInfo();
  if (!session) redirect("/login");

  const [org, overrides] = await Promise.all([
    getActiveOrg(),
    loadOwnSettingsOverrides(),
  ]);
  const disabledAreas = await loadDisabledFeatureAreas(org);
  const tabs = allowedSettingsTabs(
    session.roles,
    session.permissions,
    org?.isOrgAdmin ?? false,
    overrides,
    disabledAreas
  );
  if (tabs.length === 0) redirect("/");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Configurações</h1>
      <SettingsTabs tabs={tabs} />
      <div>{children}</div>
    </div>
  );
}
