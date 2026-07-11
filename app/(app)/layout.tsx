// Versão: 1.1 | Data: 05/07/2026
// Layout autenticado: shell com navegação lateral filtrada por papel/permissão.
// v1.1 (05/07/2026): itens de admin da Fase 6B (Operações/Responsáveis/Metas)
//   gated por papel; NavItem ganha `role`.
import { redirect } from "next/navigation";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type RoleKey } from "@/lib/auth/roles";
import { LogoutButton } from "@/components/layout/logout-button";
import { SidebarNav, type NavItem } from "@/components/layout/sidebar-nav";
import { AppShell } from "@/components/layout/app-shell";

// Cada item pode exigir uma `permission`, um `role` ou qualquer papel em `roles`;
// sem nenhum, é visível a todos. Operações/Responsáveis/Metas/Usuários viraram
// sub-abas de "Configurações" — o item pai é inserido abaixo conforme o acesso.
// Registros só é visível a Gestores/Administradores.
const NAV: (NavItem & { permission?: string; role?: string; roles?: string[] })[] = [
  { href: "/", label: "Dashboards" },
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
  // + o Log de write-back. Aparece para quem alcança QUALQUER sub-aba: admin
  // (as três primeiras) ou quem gerencia usuários.
  if (roles.includes("admin") || permissions.includes("manage_users_roles")) {
    items.push({ href: "/configuracoes", label: "Configurações" });
  }
  const roleLabel = roles
    .map((r) => ROLE_LABELS[r as RoleKey] ?? r)
    .join(", ");

  // Preferência global do usuário: barra lateral fixada (default = oculta).
  const supabase = await createClient();
  const { data: userSettings } = await supabase
    .from("user_settings")
    .select("settings")
    .eq("user_id", user.id)
    .maybeSingle();
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
    <AppShell initialPinned={initialPinned} sidebar={sidebarContent}>
      {children}
    </AppShell>
  );
}
