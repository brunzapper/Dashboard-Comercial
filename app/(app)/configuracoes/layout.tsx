// Versão: 1.0 | Data: 11/07/2026
// Seção "Configurações": agrupa as telas admin (Operações, Responsáveis, Metas,
// Usuários) + o Log de write-back como sub-abas. Cada sub-aba mantém o mesmo
// gating de papel/permissão de quando eram itens de topo. Sub-páginas ainda
// aplicam requireRole/requirePermission — este layout só decide quais abas mostrar.
import { redirect } from "next/navigation";

import { getSessionInfo } from "@/lib/auth/session";
import {
  SettingsTabs,
  type SettingsTab,
} from "@/components/configuracoes/settings-tabs";

// Moedas (só visualização p/ não-admin), Log (sincronizações) e Conta (senha
// própria) não têm gating: valem para qualquer autenticado. As demais seguem
// restritas por papel/permissão.
const ALL_TABS: (SettingsTab & { role?: string; permission?: string })[] = [
  { href: "/configuracoes/operacoes", label: "Operações", role: "admin" },
  { href: "/configuracoes/responsaveis", label: "Responsáveis", role: "admin" },
  { href: "/configuracoes/metas", label: "Metas", role: "admin" },
  { href: "/configuracoes/fontes", label: "Fontes", role: "admin" },
  { href: "/configuracoes/snapshots", label: "Snapshots", role: "admin" },
  { href: "/configuracoes/integracoes", label: "Integrações", role: "admin" },
  { href: "/configuracoes/moedas", label: "Moedas" },
  {
    href: "/configuracoes/usuarios",
    label: "Usuários",
    permission: "manage_users_roles",
  },
  { href: "/configuracoes/log", label: "Log" },
  { href: "/configuracoes/conta", label: "Conta" },
];

export function allowedSettingsTabs(
  roles: string[],
  permissions: string[]
): SettingsTab[] {
  return ALL_TABS.filter(
    (t) =>
      (!t.role || roles.includes(t.role)) &&
      (!t.permission || permissions.includes(t.permission))
  ).map(({ href, label }) => ({ href, label }));
}

export default async function ConfiguracoesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionInfo();
  if (!session) redirect("/login");

  const tabs = allowedSettingsTabs(session.roles, session.permissions);
  if (tabs.length === 0) redirect("/");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Configurações</h1>
      <SettingsTabs tabs={tabs} />
      <div>{children}</div>
    </div>
  );
}
