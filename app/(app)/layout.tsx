// Versão: 1.1 | Data: 05/07/2026
// Layout autenticado: shell com navegação lateral filtrada por papel/permissão.
// v1.1 (05/07/2026): itens de admin da Fase 6B (Operações/Responsáveis/Metas)
//   gated por papel; NavItem ganha `role`.
import { redirect } from "next/navigation";

import { getSessionInfo } from "@/lib/auth/session";
import { ROLE_LABELS, type RoleKey } from "@/lib/auth/roles";
import { LogoutButton } from "@/components/layout/logout-button";
import { SidebarNav, type NavItem } from "@/components/layout/sidebar-nav";

// Cada item pode exigir uma `permission` e/ou um `role`; sem nenhum, é visível a todos.
const NAV: (NavItem & { permission?: string; role?: string })[] = [
  { href: "/", label: "Dashboards" },
  { href: "/registros", label: "Registros" },
  { href: "/campos", label: "Campos", permission: "manage_field_definitions" },
  { href: "/admin/operacoes", label: "Operações", role: "admin" },
  { href: "/admin/responsaveis", label: "Responsáveis", role: "admin" },
  { href: "/admin/metas", label: "Metas", role: "admin" },
  {
    href: "/admin/usuarios",
    label: "Usuários",
    permission: "manage_users_roles",
  },
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
      (!item.role || roles.includes(item.role))
  );
  const roleLabel = roles
    .map((r) => ROLE_LABELS[r as RoleKey] ?? r)
    .join(", ");

  return (
    <div className="flex min-h-screen">
      <aside className="bg-sidebar text-sidebar-foreground flex w-60 shrink-0 flex-col border-r p-4">
        <div className="mb-6 px-3">
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
      </aside>
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
