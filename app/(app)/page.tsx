// Versão: 4.0 | Data: 12/09/2026
// v4.0 (12/09/2026): DISPOSIÇÃO CONFIGURÁVEL (0141). Os cards saíram daqui para
//   components/home/hub-cards.tsx (a mesma régua serve o painel de /operacao) e
//   as três cópias da grade viraram <CardGrid>, que aceita grade↔lista e número
//   de colunas. O que cada card MOSTRA passa a ser preferência resolvida em
//   três camadas (padrão do app → org, com trava → usuário):
//   lib/config/ui-prefs.ts. Descrição nasce DESLIGADA nas duas famílias — o
//   card é botão de entrada, não texto de ajuda — e o nível de acesso virou
//   opcional e ganhou equivalente nos cards de Operação (areaAccessLabel).
//   Cada card ganhou alfinete de "fixar na barra lateral" (fora do menu ⋮, que
//   não existe para quem só lê).
// v3.0 (08/09/2026): cards de FORMULÁRIO (Workflow 0126) entram no hub ao
//   lado dos módulos. A key deles é dinâmica (form:<chave>), então o mapa
//   de ícones ganha um fallback POR ORIGEM — sem isso todo formulário
//   cairia no ícone genérico. Segue sem menu "⋮": criar/excluir é no
//   Workflow, o hub nunca destrói nada.
// v2.9 (08/09/2026): ícone do card `workflow` (0125) em OPERACAO_ICONS.
// Home = lista de dashboards (Fase 6A) e kanbans (dashboards.kind, 0062).
// v2.8 (05/08/2026): hub com DUAS ABAS internas por query param (?aba=,
//   default "paineis" — RSC puro, barra de abas = <Link>s): "Painéis" é todo
//   o conteúdo anterior (grids + Criar/Importar) e "Operação" traz os CARDS
//   DE OPERAÇÃO (lib/operacao/cards.ts — catálogo em código, sem menu ⋮/UI de
//   exclusão): Agenda e Tarefas (padrões; ex-itens do nav lateral) e módulos
//   org-específicos como Remuneração (checkSettingsArea via
//   allowedOperacaoCards). validateLastView migra o lastView legado "/agenda"
//   p/ /operacao/agenda na leitura.
// v2.5 (26/07/2026): a seção Kanbans lista TAMBÉM os widgets kanban dos
//   dashboards ativos (RLS de widgets = visibilidade do pai; sem linha espelho
//   em dashboards) — card "No dashboard X" abrindo a página cheia
//   /kanbans/w/[widgetId], que compartilha config/placements com o widget.
// v2.4 (23/07/2026): botão "Importar" ao lado do "Criar" — modo de criação de
//   dashboard via JSON gerado por IA (ImportDashboardSheet).
// v2.3 (22/07/2026): ciclo de vida (0087) — menu "⋮" nos cards e seções
//   recolhidas "Arquivados" e "Lixeira" (purga em 14 dias).
// v2.2 (17/07/2026): <RestoreLastView /> — ao REABRIR o app (sessão nova do
//   navegador), redireciona ao último board visitado (user_settings.lastView).
// v2.1 (16/07/2026): botão "Criar" (Dashboard | Kanban) no lugar do form fixo.
import Link from "next/link";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrg } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import { loadUserSettings } from "@/lib/config/user-settings";
import { RestoreLastView } from "@/components/layout/restore-last-view";
import type { FieldDefinition } from "@/lib/records/types";
import {
  mapWidgetKanbanRows,
  type WidgetKanbanHubRow,
} from "@/lib/kanban/hub";
import { CreateMenu } from "@/components/dashboards/create-menu";
import { ImportDashboardSheet } from "@/components/dashboards/import-dashboard-sheet";
import { loadOrgAiConfigPublic } from "@/lib/ai/config";
import { allowedOperacaoCards, applyCardDescriptions } from "@/lib/operacao/cards";
import { cn } from "@/lib/utils";
import { CardGrid } from "@/components/ui/card-grid";
import {
  resolveUiPrefs,
  userSidebarPins,
  userUiPrefs,
} from "@/lib/config/ui-prefs";
import {
  BoardCard,
  OperacaoCardItem,
  WidgetKanbanCard,
  withinTrashTtl,
  type DashboardRow,
  type HubCardDisplay,
} from "@/components/home/hub-cards";
import { HubLayoutControls } from "@/components/home/hub-layout-controls";

// A geração direta por IA (ImportDashboardSheet → generateDashboardWithAi) roda
// como server action DESTA rota; o laço de autocorreção pode levar alguns
// segundos. maxDuration amplia o teto da função serverless (clampado ao teto do
// plano da Vercel).
export const maxDuration = 300;

// Valida o lastView gravado (user_settings): só /dashboards/<uuid>,
// /kanbans/<uuid> (+ ?tab= opcional) ou /kanbans/w/<uuid> (página cheia de
// widget kanban), e o alvo precisa estar na lista visível (RLS) com o kind da
// rota — board/widget excluído/sem acesso não redireciona, e nenhum outro
// valor vira alvo de router.replace (sem open redirect).
// Receber só linhas ABRÍVEIS (ativas + arquivadas): board na Lixeira não abre.
function validateLastView(
  view: string | null,
  rows: DashboardRow[],
  widgetKanbanIds: Set<string>
): string | null {
  if (!view) return null;
  // Agenda do Workspace: rota fixa, sem id — literal exato (sem open
  // redirect). O valor legado "/agenda" (pré-Operação) migra na leitura.
  if (view === "/agenda" || view === "/operacao/agenda")
    return "/operacao/agenda";
  const w = /^\/kanbans\/w\/([0-9a-f-]{36})$/.exec(view);
  if (w) return widgetKanbanIds.has(w[1]) ? view : null;
  const m = /^\/(dashboards|kanbans)\/([0-9a-f-]{36})(?:\?tab=[\w%-]+)?$/.exec(
    view
  );
  if (!m) return null;
  const row = rows.find((r) => r.id === m[2]);
  if (!row || (row.kind === "kanban") !== (m[1] === "kanbans")) return null;
  return view;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Aba interna do hub (?aba=): "paineis" (default) = dashboards/kanbans;
  // "operacao" = cards de Operação. Qualquer outro valor cai no default.
  const sp = await searchParams;
  const aba = sp.aba === "operacao" ? "operacao" : "paineis";
  const session = await getSessionInfo();
  const canCreate = session?.permissions.includes("create_dashboards") ?? false;
  const isAdmin = session?.roles.includes("admin") ?? false;
  // Org ativa (multi-org): a RLS já escopa às orgs do usuário; o .eq resolve a
  // visão de quem pertence a 2+ orgs (Owner). null pré-migração = sem filtro.
  const org = await getActiveOrg();
  const orgId = org?.id ?? null;

  const supabase = await createClient();
  let boardsQuery = supabase
    .from("dashboards")
    .select(
      "id, name, description, owner_user_id, visible_to_roles, kind, status, trashed_at, settings"
    )
    .order("created_at", { ascending: false });
  if (orgId) boardsQuery = boardsQuery.eq("organization_id", orgId);
  const { data } = await boardsQuery;
  const rows = (data ?? []) as DashboardRow[];

  // Widgets kanban dos dashboards ativos: entram na seção Kanbans como acesso
  // à página cheia (/kanbans/w/[widgetId]) do MESMO kanban do widget. A RLS de
  // widgets (auth_board_visible do pai, 0088) já recorta a visibilidade; o .eq
  // de org espelha a query de dashboards acima.
  let widgetKanbanQuery = supabase
    .from("widgets")
    .select(
      "id, title, dashboard_id, settings, dashboards!inner(id, name, kind, status, organization_id)"
    )
    .eq("visual_type", "kanban")
    .eq("dashboards.kind", "dashboard")
    .eq("dashboards.status", "active");
  if (orgId) {
    widgetKanbanQuery = widgetKanbanQuery.eq(
      "dashboards.organization_id",
      orgId
    );
  }
  const { data: widgetKanbanRows } = await widgetKanbanQuery;
  const widgetKanbans = mapWidgetKanbanRows(
    (widgetKanbanRows ?? []) as unknown as WidgetKanbanHubRow[]
  );
  const canManageRow = (r: DashboardRow) =>
    isAdmin || r.owner_user_id === session?.user.id;

  const active = rows.filter((r) => r.status === "active");
  const dashboards = active.filter((r) => r.kind !== "kanban");
  const kanbans = active.filter((r) => r.kind === "kanban");
  const archived = rows.filter((r) => r.status === "archived");
  // Lixeira: só de quem pode geri-la (dono/admin), e nunca itens vencidos —
  // mesmo antes de o cron de purga (pg-cron-purge-trash.sql) removê-los.
  const trashed = rows.filter(
    (r) =>
      r.status === "trashed" && canManageRow(r) && withinTrashTtl(r.trashed_at)
  );

  // Última view p/ restaurar na REABERTURA do app (RestoreLastView). Leitura
  // de custo zero: o layout já chamou loadUserSettings (React cache()).
  const settings = session ? await loadUserSettings(session.user.id) : {};
  const storedView =
    typeof settings.lastView === "string" ? settings.lastView : null;
  const restoreTarget = validateLastView(
    storedView,
    rows.filter((r) => r.status !== "trashed"),
    new Set(widgetKanbans.map((w) => w.widgetId))
  );

  // Preferências de INTERFACE (0141): padrão do app → org (com trava) → usuário.
  const prefs = resolveUiPrefs(userUiPrefs(settings), org?.uiPrefs);
  const lockedKeys = [...prefs.locked];
  const pins = userSidebarPins(settings);
  const isPinned = (kind: string, id: string) =>
    pins.some((p) => p.kind === kind && p.id === id);

  const boardDisplay: HubCardDisplay = {
    layout: prefs.values.hubLayout,
    showDescription: prefs.values.hubShowDescription,
    showAccess: prefs.values.hubShowAccess,
  };
  const operacaoDisplay: HubCardDisplay = {
    layout: prefs.values.operacaoLayout,
    showDescription: prefs.values.operacaoShowDescription,
    showAccess: prefs.values.operacaoShowAccess,
  };

  // Insumos do diálogo "Criar kanban" (fontes + campos p/ o agrupamento).
  // Boards elegíveis aos modos "Criar a partir de"/"Editar" da IA: dashboards
  // ativos que o usuário pode gerir (owner/admin — espelha o motor de apply e
  // a RLS de escrita). O flag de preset de fábrica alimenta o aviso do picker.
  const aiBoards = dashboards
    .filter((r) => canManageRow(r))
    .map((r) => {
      const presetKey = r.settings?.preset?.key;
      return {
        id: r.id,
        name: r.name,
        factoryPreset: Boolean(presetKey && !presetKey.startsWith("import:")),
      };
    });

  // Cards de Operação (aba "Operação"): catálogo em código recortado por
  // área (checkSettingsArea é cache()d — o layout de /operacao reusa), com a
  // descrição eventualmente sobrescrita pela organização.
  const operacaoCards =
    aba === "operacao"
      ? applyCardDescriptions(
          await allowedOperacaoCards(),
          org?.uiPrefs.operacaoDescriptions
        )
      : [];

  let sources: Awaited<ReturnType<typeof loadSources>> = [];
  let fields: FieldDefinition[] = [];
  let aiConfig: Awaited<ReturnType<typeof loadOrgAiConfigPublic>> = null;
  // Insumos dos botões Criar/Importar — só existem na aba Painéis.
  if (canCreate && aba === "paineis") {
    sources = await loadSources(supabase, orgId);
    aiConfig = await loadOrgAiConfigPublic(orgId);
    // Campos p/ o seletor de colunas do kanban: NÃO filtramos por show_in_builder
    // (esse gate é dos construtores BI). Definir as colunas do quadro é escolha de
    // exibição — inclusive campos LOCAIS criados só para servir de "fase" (nunca
    // vêm da Sync). O filtro por tipo/fonte é feito no create-menu.
    const { data: fieldsData } = await supabase
      .from("field_definitions")
      .select("id, field_key, label, data_type, options, applies_to")
      .order("sort_order", { ascending: true });
    fields = (fieldsData ?? []) as FieldDefinition[];
  }

  const cardGrid = (list: DashboardRow[]) => (
    <CardGrid layout={boardDisplay.layout} columns={prefs.values.hubColumns}>
      {list.map((r) => (
        <BoardCard
          key={r.id}
          row={r}
          canManage={canManageRow(r)}
          canDuplicate={canCreate}
          display={boardDisplay}
          pinned={isPinned(r.kind === "kanban" ? "kanban" : "dashboard", r.id)}
        />
      ))}
    </CardGrid>
  );

  return (
    <div className="flex flex-col gap-6">
      <RestoreLastView target={restoreTarget} hadStored={storedView !== null} />
      {/* pr-8: afasta o cluster de botões do sino fixo (TaskBell, topo-direito) */}
      <div className="flex items-start justify-between gap-4 pr-8">
        <div>
          <h1 className="text-2xl font-semibold">Workspace</h1>
          <p className="text-muted-foreground text-sm">
            {aba === "operacao"
              ? "Módulos de operação do dia a dia: agenda, tarefas e os módulos da sua organização."
              : "Seu workspace: crie dashboards e kanbans a partir dos seus registros."}
          </p>
        </div>
        {canCreate && aba === "paineis" ? (
          <div className="flex items-center gap-2">
            <ImportDashboardSheet
              sources={sources}
              ai={aiConfig}
              boards={aiBoards}
            />
            <CreateMenu sources={sources} fields={fields} />
          </div>
        ) : null}
      </div>

      {/* Abas internas do hub (?aba=) — <Link>s puros, estilo do SettingsTabs
          (que não serve aqui: destaca por usePathname, cego a query). */}
      <nav className="flex flex-wrap gap-1 border-b">
        {(
          [
            { key: "paineis", href: "/", label: "Painéis" },
            { key: "operacao", href: "/?aba=operacao", label: "Operação" },
          ] as const
        ).map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              aba === t.key
                ? "border-brand text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {aba === "operacao" ? (
        <>
          <HubLayoutControls
            keys={{
              layout: "operacaoLayout",
              columns: "operacaoColumns",
              showDescription: "operacaoShowDescription",
              showAccess: "operacaoShowAccess",
            }}
            layout={operacaoDisplay.layout}
            columns={prefs.values.operacaoColumns}
            showDescription={operacaoDisplay.showDescription}
            showAccess={operacaoDisplay.showAccess}
            locked={lockedKeys}
            accessLabel="Quem acessa"
          />
          <CardGrid
            layout={operacaoDisplay.layout}
            columns={prefs.values.operacaoColumns}
          >
            {operacaoCards.map((c) => (
              <OperacaoCardItem
                key={c.key}
                card={c}
                display={operacaoDisplay}
                pinned={isPinned("operacao", c.key)}
              />
            ))}
          </CardGrid>
        </>
      ) : (
        <>
          <HubLayoutControls
            keys={{
              layout: "hubLayout",
              columns: "hubColumns",
              showDescription: "hubShowDescription",
              showAccess: "hubShowAccess",
            }}
            layout={boardDisplay.layout}
            columns={prefs.values.hubColumns}
            showDescription={boardDisplay.showDescription}
            showAccess={boardDisplay.showAccess}
            locked={lockedKeys}
          />

          {dashboards.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nenhum dashboard no workspace ainda.
              {canCreate ? " Use o botão Criar acima." : ""}
            </p>
          ) : (
            cardGrid(dashboards)
          )}

          {kanbans.length > 0 || widgetKanbans.length > 0 ? (
            <>
              <div>
                <h2 className="text-lg font-semibold">Kanbans</h2>
                <p className="text-muted-foreground text-sm">
                  Quadros de cards para gerir projetos e funis — mover um card
                  altera o valor do campo no registro.
                </p>
              </div>
              {kanbans.length > 0 ? cardGrid(kanbans) : null}
              {widgetKanbans.length > 0 ? (
                <CardGrid
                  layout={boardDisplay.layout}
                  columns={prefs.values.hubColumns}
                >
                  {widgetKanbans.map((w) => (
                    <WidgetKanbanCard
                      key={w.widgetId}
                      item={w}
                      display={boardDisplay}
                      pinned={isPinned("widget-kanban", w.widgetId)}
                    />
                  ))}
                </CardGrid>
              ) : null}
            </>
          ) : null}

          {/* Seções recolhidas do ciclo de vida (0087): arquivados seguem abrindo;
          a Lixeira não abre e é purgada em 14 dias. <details> = RSC puro. */}
          {archived.length > 0 ? (
            <details className="group">
              <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-sm font-medium select-none">
                Arquivados ({archived.length})
              </summary>
              <p className="text-muted-foreground mt-1 mb-3 text-sm">
                Fora da tela principal, mas ainda podem ser abertos.
              </p>
              {cardGrid(archived)}
            </details>
          ) : null}

          {trashed.length > 0 ? (
            <details className="group">
              <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-sm font-medium select-none">
                Lixeira ({trashed.length})
              </summary>
              <p className="text-muted-foreground mt-1 mb-3 text-sm">
                Excluídos automaticamente após 14 dias. Itens aqui não podem ser
                abertos — restaure para voltar a usar.
              </p>
              {cardGrid(trashed)}
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}
