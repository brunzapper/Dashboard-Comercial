// Versão: 1.5 | Data: 23/07/2026
// Layout autenticado: shell com navegação lateral filtrada por papel/permissão.
// v1.5 (23/07/2026): multi-org (0089+) — branding do sidebar sai de
//   organizations (app_name/name, editáveis em Configurações → Organização);
//   catálogo/rótulos escopados pela org ativa; usuário multi-org sem escolha
//   é levado a /escolher-organizacao; link "Trocar organização" no rodapé;
//   badges de Owner/Admin de Organização junto ao papel.
// v1.1 (05/07/2026): itens de admin da Fase 6B (Operações/Responsáveis/Metas)
//   gated por papel; NavItem ganha `role`.
// v1.2 (15/07/2026): SourceLabelsProvider — rótulos curtos das fontes
//   (Configurações → Fontes) para os dropdowns de campo em todo o app.
// v1.3 (16/07/2026): SourcesProvider — catálogo de fontes dinâmicas
//   (data_sources, 0060) para pickers/abas em todo o app.
// v1.4 (16/07/2026): item "Tarefas" na navegação (todos os papéis — a RLS de
//   tasks escopa o vendedor às próprias tarefas) + sino de alertas de prazo
//   (TaskBell; contagem inicial computada aqui no server).
import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrg, getMemberships } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import {
  loadSourceLabelsValue,
  mergeSourceLabels,
} from "@/lib/config/source-labels";
import { loadUserSettings } from "@/lib/config/user-settings";
import { ROLE_LABELS, type RoleKey } from "@/lib/auth/roles";
import { LogoutButton } from "@/components/layout/logout-button";
import { SidebarNav, type NavItem } from "@/components/layout/sidebar-nav";
import { AppShell } from "@/components/layout/app-shell";
import { TaskBell } from "@/components/layout/task-bell";
import { countTaskAlerts } from "@/lib/tasks/actions";
import { SourceLabelsProvider } from "@/components/source-labels-context";
import { SourcesProvider } from "@/components/sources-context";
import { RealtimeRefresher } from "@/components/realtime-refresher";

// Cada item pode exigir uma `permission`, um `role` ou qualquer papel em `roles`;
// sem nenhum, é visível a todos. Operações/Responsáveis/Metas/Usuários viraram
// sub-abas de "Configurações" — o item pai é inserido abaixo conforme o acesso.
// Registros só é visível a Gestores/Administradores.
const NAV: (NavItem & { permission?: string; role?: string; roles?: string[] })[] = [
  { href: "/", label: "Workspace" },
  { href: "/tarefas", label: "Tarefas" },
  { href: "/registros", label: "Registros", roles: ["admin", "gestor"] },
  { href: "/campos", label: "Campos", permission: "manage_field_definitions" },
];

// Título da aba segue o branding da org ativa (multi-org, 0089+).
export async function generateMetadata() {
  const org = await getActiveOrg();
  return {
    title: org ? `${org.appName} — ${org.name}` : "Dashboard Comercial",
  };
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionInfo();
  if (!session) {
    redirect("/login");
  }

  // Org ativa (multi-org, 0089+): usuário com 2+ orgs e sem escolha válida no
  // cookie vai à tela de seleção; usuário comum (1 org) entra direto. Sem
  // membership nenhuma (pré-migração) o app segue como single-tenant.
  const org = await getActiveOrg();
  if (!org) {
    const memberships = await getMemberships();
    if (memberships.length > 1) redirect("/escolher-organizacao");
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

  // Preferência global do usuário (loader cache()d — o sino relê a mesma linha
  // na mesma request sem nova consulta), catálogo de fontes + valor bruto dos
  // rótulos e a contagem do sino: tudo em UM Promise.all — antes eram 4 ondas
  // seriais. O merge dos rótulos depende de `sources`, mas o FETCH não.
  // Sino: erro (ex.: migrações 0063/0066 pendentes) cai em 0 sem quebrar.
  const supabase = await createClient();
  const [settings, sources, labelsValue, dueCount] = await Promise.all([
    loadUserSettings(user.id),
    loadSources(supabase, org?.id),
    loadSourceLabelsValue(supabase, org?.id),
    countTaskAlerts().catch(() => 0),
  ]);
  const sourceLabels = mergeSourceLabels(labelsValue, sources);
  const initialPinned =
    (settings as { sidebarPinned?: boolean }).sidebarPinned ?? false;

  // Conteúdo da barra montado no server (itens já filtrados por papel);
  // o AppShell (client) controla ocultar/fixar/tela cheia.
  const sidebarContent = (
    <>
      <div className="mb-6 px-3 pr-8">
        <p className="text-sm font-semibold">
          {org?.appName ?? "Dashboard Comercial"}
        </p>
        <p className="text-muted-foreground text-xs">{org?.name ?? "Zapper"}</p>
      </div>
      <SidebarNav items={items} />
      <div className="mt-auto border-t pt-3">
        <div className="px-3 pb-2">
          <p className="truncate text-xs font-medium">{user.email}</p>
          <p className="text-muted-foreground text-xs">
            {[org?.isOrgAdmin ? "Administrador de Organização" : null, roleLabel]
              .filter(Boolean)
              .join(", ") || "Sem papel atribuído"}
          </p>
          {org?.multiOrg ? (
            <Link
              href="/escolher-organizacao"
              className="text-muted-foreground hover:text-foreground text-xs underline"
            >
              Trocar organização
            </Link>
          ) : null}
        </div>
        <LogoutButton />
      </div>
    </>
  );

  return (
    <SourcesProvider sources={sources}>
      <SourceLabelsProvider labels={sourceLabels}>
        {/* Sinal realtime (records/tasks/comments) → event bus + refresh
            coalescido; só no app autenticado (o viewer /s/ fica fora). */}
        <RealtimeRefresher />
        <AppShell
          initialPinned={initialPinned}
          sidebar={sidebarContent}
          topRight={<TaskBell initialCount={dueCount ?? 0} />}
        >
          {children}
        </AppShell>
      </SourceLabelsProvider>
    </SourcesProvider>
  );
}
