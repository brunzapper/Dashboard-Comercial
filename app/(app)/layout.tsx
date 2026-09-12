// Versão: 1.10 | Data: 12/09/2026
// v1.10 (12/09/2026): <RouteTracker /> — registra a rota atual para o botão
//   "voltar" levar à tela ANTERIOR. Antes ele apontava para um destino fixo e
//   mandava ao Workspace quem tinha chegado de outro lugar.
// v1.9 (12/09/2026): a barra lateral virou PERSONALIZÁVEL (0141) — seção
//   "Fixados" com os dashboards, kanbans e módulos de Operação que o usuário
//   alfinetou no hub, resolvidos aqui (resolveSidebarPins) porque só o servidor
//   sabe o rótulo atual e o que a RLS ainda entrega. O custo fica em ZERO para
//   quem não fixou nada: sem lista, nenhuma consulta nova — e este layout roda
//   em toda página. Também desce as preferências da barra (fixar / abrir ao
//   aproximar da borda) já resolvidas nas três camadas, com as travas da org.
// v1.8 (05/08/2026): Agenda e Tarefas saíram do nav lateral — viraram cards
//   padrão de OPERAÇÃO no hub Workspace (aba "Operação" de /; páginas em
//   /operacao/*, catálogo em lib/operacao/cards.ts). O TaskBell segue
//   linkando /operacao/tarefas; as rotas antigas viraram stubs de redirect.
// v1.7 (27/07/2026): ThemeSync — reconcilia os cookies de tema (theme_mode/
//   theme_accent) com a preferência do usuário × padrão da org (resolveTheme).
// v1.6 (26/07/2026): SourceFoldersProvider — pastas de bases (source_folders,
//   0107) para navegação/abas/pickers agrupados por pasta em todo o app.
// Layout autenticado: shell com navegação lateral filtrada por papel/permissão.
// v1.5 (23/07/2026): multi-org (0089+) — branding do sidebar sai de
//   organizations (app_name/name, editáveis em Configurações → Organização);
//   catálogo/rótulos escopados pela org ativa; usuário multi-org sem escolha
//   é levado a /escolher-organizacao; link "Trocar organização" no rodapé;
//   badges de Owner/Admin de Organização junto ao papel.
// v1.1 (05/07/2026): itens de admin da Fase 6B (Operações/Responsáveis/Metas)
//   gated por papel; NavItem ganha `role`.
// v1.2 (15/07/2026): SourceLabelsProvider — rótulos curtos das fontes
//   (Registros → Bases) para os dropdowns de campo em todo o app.
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
import { loadSourceFolders } from "@/lib/config/source-folders";
import {
  loadSourceLabelsValue,
  mergeSourceLabels,
} from "@/lib/config/source-labels";
import { loadUserSettings } from "@/lib/config/user-settings";
import {
  resolveUiPrefs,
  userSidebarPins,
  userUiPrefs,
} from "@/lib/config/ui-prefs";
import { resolveSidebarPins } from "@/lib/config/sidebar-pins";
import { allowedOperacaoCards } from "@/lib/operacao/cards";
import { loadGoalMetrics } from "@/lib/config/goal-metrics";
import { resolveTheme, resolveThemeTokens } from "@/lib/theme";
import { ROLE_LABELS, type RoleKey } from "@/lib/auth/roles";
import { ThemeSync } from "@/components/layout/theme-sync";
import { LogoutButton } from "@/components/layout/logout-button";
import { SidebarNav, type NavItem } from "@/components/layout/sidebar-nav";
import { AppShell } from "@/components/layout/app-shell";
import { TaskBell } from "@/components/layout/task-bell";
import { countTaskAlerts } from "@/lib/tasks/actions";
import { SourceLabelsProvider } from "@/components/source-labels-context";
import { SourcesProvider } from "@/components/sources-context";
import { GoalMetricsProvider } from "@/components/goal-metrics-context";
import { SourceFoldersProvider } from "@/components/source-folders-context";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { RouteTracker } from "@/components/layout/route-tracker";
import { Toaster } from "@/components/ui/sonner";

// Cada item pode exigir uma `permission`, um `role` ou qualquer papel em `roles`;
// sem nenhum, é visível a todos. Operações/Responsáveis/Metas/Usuários viraram
// sub-abas de "Configurações" — o item pai é inserido abaixo conforme o acesso.
// Agenda/Tarefas viraram cards de Operação no hub (aba "Operação" de /).
// Registros só é visível a Gestores/Administradores.
const NAV: (NavItem & { permission?: string; role?: string; roles?: string[] })[] = [
  { href: "/", label: "Workspace" },
  { href: "/registros", label: "Registros", roles: ["admin", "gestor"] },
  { href: "/campos", label: "Campos", permission: "manage_field_definitions" },
];

// Título da aba segue o branding da org ativa (multi-org, 0089+). O template
// permite que cada página filha exporte um título curto ("Registros",
// "NomeDoBoard") e a aba do navegador vire "Registros — {appName}" — antes,
// 25 das 29 páginas herdavam o mesmo título e as abas eram indistinguíveis.
export async function generateMetadata() {
  const org = await getActiveOrg();
  const appName = org?.appName ?? "Dashboard Comercial";
  return {
    title: {
      default: org ? `${appName} — ${org.name}` : appName,
      template: `%s — ${appName}`,
    },
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

  // "Configurações" agrupa as telas admin (Operações/Responsáveis/Metas/
  // Usuários) + Tema e Conta. As abas admin seguem gated dentro da seção; Tema
  // (preferências visuais) e Conta (senha) valem para todo mundo, então a
  // seção aparece para qualquer autenticado. Bases/Log vivem em /registros/* e
  // Moedas em /campos.
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
  const [settings, sources, sourceFolders, labelsValue, dueCount, goalMetrics] =
    await Promise.all([
      loadUserSettings(user.id),
      loadSources(supabase, org?.id),
      loadSourceFolders(supabase, org?.id),
      loadSourceLabelsValue(supabase, org?.id),
      countTaskAlerts().catch(() => 0),
      loadGoalMetrics(supabase),
    ]);
  const sourceLabels = mergeSourceLabels(labelsValue, sources);
  // Preferências de interface: padrão do app → org (com trava) → usuário.
  const uiPrefs = resolveUiPrefs(userUiPrefs(settings), org?.uiPrefs);
  // Itens fixados: só consulta se houver lista (o caso comum é vazio, e este
  // layout roda em TODA navegação). allowedOperacaoCards é cache()d por
  // request — o hub e o layout de /operacao reusam sem custo.
  const pins = userSidebarPins(settings);
  const pinnedItems =
    pins.length > 0
      ? await resolveSidebarPins(
          supabase,
          pins,
          org?.id ?? null,
          await allowedOperacaoCards()
        )
      : [];
  // Tema efetivo (usuário ?? org ?? padrão) — o ThemeSync abaixo corrige
  // cookie defasado (dispositivo novo / padrão da org alterado).
  const resolvedTheme = resolveTheme(
    settings as { theme?: string | null; accentColor?: string | null },
    org?.theme ?? null
  );
  // Tokens de tema (0141): mesma precedência, token a token.
  const resolvedTokens = resolveThemeTokens(
    (settings as { themeTokens?: unknown }).themeTokens,
    org?.theme?.tokens
  );

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
      <SidebarNav items={items} pinned={pinnedItems} />
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
      <GoalMetricsProvider metrics={goalMetrics}>
      <SourceFoldersProvider folders={sourceFolders}>
      <SourceLabelsProvider labels={sourceLabels}>
        {/* Sinal realtime (records/tasks/comments) → event bus + refresh
            coalescido; só no app autenticado (o viewer /s/ fica fora). */}
        <RealtimeRefresher />
        {/* Rastro de navegação: alimenta o destino do botão "voltar" (ele leva
            à tela anterior, não a um lugar fixo). */}
        <RouteTracker />
        {/* Feedback global de falha para ações fora de form (lib/feedback/
            notify.ts); só no app autenticado — o viewer /s/ fica sem toasts. */}
        <Toaster />
        <ThemeSync resolved={resolvedTheme} tokens={resolvedTokens} />
        <AppShell
          initialPinned={uiPrefs.values.sidebarPinned}
          initialHoverEdge={uiPrefs.values.sidebarHoverEdge}
          pinnedLocked={uiPrefs.locked.has("sidebarPinned")}
          hoverEdgeLocked={uiPrefs.locked.has("sidebarHoverEdge")}
          sidebar={sidebarContent}
          topRight={<TaskBell initialCount={dueCount ?? 0} />}
        >
          {children}
        </AppShell>
      </SourceLabelsProvider>
      </SourceFoldersProvider>
      </GoalMetricsProvider>
    </SourcesProvider>
  );
}
