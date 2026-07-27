// Versão: 1.2 | Data: 27/07/2026
// Seção "Configurações": agrupa as telas admin (Operações, Responsáveis, Metas,
// Usuários) como sub-abas. Cada sub-aba mantém o mesmo
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
import {
  areaRoleAllowed,
  canAccessSettingsArea,
  loadOwnSettingsOverrides,
  type OverrideEffect,
} from "@/lib/auth/access";
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
  overrides: Map<string, OverrideEffect> = new Map()
): SettingsTab[] {
  return ALL_TABS.filter((t) => {
    const key = areaKeyOf(t.href);
    // "conta" é sempre do próprio usuário — override não a esconde.
    if (key === "conta") return true;
    return canAccessSettingsArea(
      areaRoleAllowed(key, roles, permissions, isOrgAdmin),
      overrides.get(key)
    );
  }).map(({ href, label }) => ({ href, label }));
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
  const tabs = allowedSettingsTabs(
    session.roles,
    session.permissions,
    org?.isOrgAdmin ?? false,
    overrides
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
