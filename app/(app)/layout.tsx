// Versão: 1.4 | Data: 16/07/2026
// Layout autenticado: shell com navegação lateral filtrada por papel/permissão.
// v1.1 (05/07/2026): itens de admin da Fase 6B (Operações/Responsáveis/Metas)
//   gated por papel; NavItem ganha `role`.
// v1.2 (15/07/2026): SourceLabelsProvider — rótulos curtos das fontes
//   (Configurações → Fontes) para os dropdowns de campo em todo o app.
// v1.3 (16/07/2026): SourcesProvider — catálogo de fontes dinâmicas
//   (data_sources, 0060) para pickers/abas em todo o app.
// v1.4 (16/07/2026): item "Tarefas" na navegação (todos os papéis — a RLS de
//   tasks escopa o vendedor às próprias tarefas).
import { redirect } from "next/navigation";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import { loadSourceLabels } from "@/lib/config/source-labels";
import { ROLE_LABELS, type RoleKey } from "@/lib/auth/roles";
import { LogoutButton } from "@/components/layout/logout-button";
import { SidebarNav, type NavItem } from "@/components/layout/sidebar-nav";
import { AppShell } from "@/components/layout/app-shell";
import { SourceLabelsProvider } from "@/components/source-labels-context";
import { SourcesProvider } from "@/components/sources-context";

// Cada item pode exigir uma `permission`, um `role` ou qualquer papel em `roles`;
// sem nenhum, é visível a todos. Operações/Responsáveis/Metas/Usuários viraram
// sub-abas de "Configurações" — o item pai é inserido abaixo conforme o acesso.
// Registros só é visível a Gestores/Administradores.
const NAV: (NavItem & { permission?: string; role?: string; roles?: string[] })[] = [
  { href: "/", label: "Dashboards" },
  { href: "/tarefas", label: "Tarefas" },
  { href: "/registros", label: "Registros", roles: ["admin", "gestor"] },
  { href: "/campos", label: "Campos", permission: "manage_field_definitions" },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionInfo();
  if (!session) {
    redirect("/login");
  }

  const { user, roles, permissions } = session;
  const items = NAV.filter(
    (item) =>
      (!item.permission || permissions.includes(item.permission)) &&
      (!item.role || roles.includes(item.role)) &&
      (!item.roles || item.roles.some((r) => roles.includes(r)))
  );

  // "Configurações" agrupa as telas admin (Operações/Responsáveis/Metas/Usuários)
  // + Moedas, Log e Conta. As abas admin seguem gated dentro da seção; Moedas
  // (visualização), Log (sincronizações) e Conta (senha) valem para todo mundo,
  // então a seção aparece para qualquer autenticado.
  items.push({ href: "/configuracoes", label: "Configurações" });
  const roleLabel = roles
    .map((r) => ROLE_LABELS[r as RoleKey] ?? r)
    .join(", ");

  // Preferência global do usuário: barra lateral fixada (default = oculta).
  // Catálogo de fontes + rótulos curtos: carregados uma vez por request para
  // os providers (rótulos derivam do catálogo — nomes curtos por fonte).
  const supabase = await createClient();
  const [{ data: userSettings }, sources] = await Promise.all([
    supabase
      .from("user_settings")
      .select("settings")
      .eq("user_id", user.id)
      .maybeSingle(),
    loadSources(supabase),
  ]);
  const sourceLabels = await loadSourceLabels(supabase, sources);
  const initialPinned =
    (userSettings?.settings as { sidebarPinned?: boolean } | null)
      ?.sidebarPinned ?? false;

  // Conteúdo da barra montado no server (itens já filtrados por papel);
  // o AppShell (client) controla ocultar/fixar/tela cheia.
  const sidebarContent = (
    <>
      <div className="mb-6 px-3 pr-8">
        <p className="text-sm font-semibold">Dashboard Comercial</p>
        <p className="text-muted-foreground text-xs">Zapper</p>
      </div>
      <SidebarNav items={items} />
      <div className="mt-auto border-t pt-3">
        <div className="px-3 pb-2">
          <p className="truncate text-xs font-medium">{user.email}</p>
          <p className="text-muted-foreground text-xs">
            {roleLabel || "Sem papel atribuído"}
          </p>
        </div>
        <LogoutButton />
      </div>
    </>
  );

  return (
    <SourcesProvider sources={sources}>
      <SourceLabelsProvider labels={sourceLabels}>
        <AppShell initialPinned={initialPinned} sidebar={sidebarContent}>
          {children}
        </AppShell>
      </SourceLabelsProvider>
    </SourcesProvider>
  );
}
