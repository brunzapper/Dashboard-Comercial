// Versão: 2.4 | Data: 23/07/2026
// Home = lista de dashboards (Fase 6A) e kanbans (dashboards.kind, 0062).
// v2.4 (23/07/2026): botão "Importar" ao lado do "Criar" — modo de criação de
//   dashboard via JSON gerado por IA (ImportDashboardSheet).
// v2.3 (22/07/2026): ciclo de vida (0087) — menu "⋮" nos cards (Duplicar/
//   Arquivar/Excluir via BoardCardMenu, no lugar do botão de lixeira) e
//   seções recolhidas "Arquivados" (segue abrindo) e "Lixeira" (não abre;
//   purga em 14 dias — o hub esconde vencidos mesmo sem o cron).
// v2.2 (17/07/2026): <RestoreLastView /> — ao REABRIR o app (sessão nova do
//   navegador), redireciona ao último board visitado (user_settings.lastView,
//   gravado pelo TrackLastView); visita in-session à Home limpa o lastView.
// v2.1 (16/07/2026): botão "Criar" (Dashboard | Kanban) no lugar do form fixo;
//   seções separadas p/ dashboards e kanbans (mesma tabela, kinds distintos).
import Link from "next/link";
import { SquareKanban } from "lucide-react";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { loadSources } from "@/lib/config/sources";
import { loadUserSettings } from "@/lib/config/user-settings";
import { RestoreLastView } from "@/components/layout/restore-last-view";
import type { FieldDefinition } from "@/lib/records/types";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ROLE_LABELS, type RoleKey } from "@/lib/auth/roles";
import { CreateMenu } from "@/components/dashboards/create-menu";
import { ImportDashboardSheet } from "@/components/dashboards/import-dashboard-sheet";
import {
  BoardCardMenu,
  type BoardStatus,
} from "@/components/dashboards/board-card-menu";

const TRASH_TTL_MS = 14 * 86_400_000; // purga em 14 dias (0087)

interface DashboardRow {
  id: string;
  name: string;
  owner_user_id: string | null;
  visible_to_roles: string[];
  kind: "dashboard" | "kanban";
  status: BoardStatus;
  trashed_at: string | null;
}

// Valida o lastView gravado (user_settings): só /dashboards/<uuid> ou
// /kanbans/<uuid> (+ ?tab= opcional), e o board precisa estar na lista visível
// (RLS) com o kind da rota — board excluído/sem acesso não redireciona, e
// nenhum outro valor vira alvo de router.replace (sem open redirect).
// Receber só linhas ABRÍVEIS (ativas + arquivadas): board na Lixeira não abre.
function validateLastView(
  view: string | null,
  rows: DashboardRow[]
): string | null {
  if (!view) return null;
  const m = /^\/(dashboards|kanbans)\/([0-9a-f-]{36})(?:\?tab=[\w%-]+)?$/.exec(
    view
  );
  if (!m) return null;
  const row = rows.find((r) => r.id === m[2]);
  if (!row || (row.kind === "kanban") !== (m[1] === "kanbans")) return null;
  return view;
}

// Item da Lixeira ainda dentro da janela de 14 dias? (Vencidos somem do hub
// mesmo antes de o cron de purga removê-los fisicamente.)
function withinTrashTtl(trashedAt: string | null): boolean {
  return Date.now() - new Date(trashedAt ?? 0).getTime() < TRASH_TTL_MS;
}

// "Expira em N dias" do card na Lixeira (teto: recém-excluído = 14 dias).
function trashExpiryLabel(trashedAt: string | null): string {
  const at = trashedAt ? new Date(trashedAt).getTime() : Date.now();
  const days = Math.ceil((at + TRASH_TTL_MS - Date.now()) / 86_400_000);
  if (days <= 0) return "Expira hoje";
  return days === 1 ? "Expira em 1 dia" : `Expira em ${days} dias`;
}

function BoardCard({
  row,
  canManage,
  canDuplicate,
}: {
  row: DashboardRow;
  canManage: boolean;
  canDuplicate: boolean;
}) {
  const kanban = row.kind === "kanban";
  const trashed = row.status === "trashed";
  const href = kanban ? `/kanbans/${row.id}` : `/dashboards/${row.id}`;
  return (
    <Card className={`relative${trashed ? " opacity-70" : ""}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {kanban ? (
            <SquareKanban className="text-muted-foreground size-4 shrink-0" />
          ) : null}
          {trashed ? (
            // Na Lixeira o board NÃO abre: título sem link (rotas dão 404).
            <span className="text-muted-foreground">{row.name}</span>
          ) : (
            <Link href={href} className="hover:underline">
              {row.name}
            </Link>
          )}
        </CardTitle>
        <CardDescription>
          {trashed
            ? trashExpiryLabel(row.trashed_at)
            : row.visible_to_roles.length > 0
              ? `Compartilhado: ${row.visible_to_roles
                  .map((r) => ROLE_LABELS[r as RoleKey] ?? r)
                  .join(", ")}`
              : "Pessoal"}
        </CardDescription>
      </CardHeader>
      <BoardCardMenu
        id={row.id}
        kanban={kanban}
        status={row.status}
        canManage={canManage}
        canDuplicate={canDuplicate}
      />
    </Card>
  );
}

export default async function HomePage() {
  const session = await getSessionInfo();
  const canCreate = session?.permissions.includes("create_dashboards") ?? false;
  const isAdmin = session?.roles.includes("admin") ?? false;
  // Org ativa (multi-org): a RLS já escopa às orgs do usuário; o .eq resolve a
  // visão de quem pertence a 2+ orgs (Owner). null pré-migração = sem filtro.
  const orgId = await getActiveOrgId();

  const supabase = await createClient();
  let boardsQuery = supabase
    .from("dashboards")
    .select("id, name, owner_user_id, visible_to_roles, kind, status, trashed_at")
    .order("created_at", { ascending: false });
  if (orgId) boardsQuery = boardsQuery.eq("organization_id", orgId);
  const { data } = await boardsQuery;
  const rows = (data ?? []) as DashboardRow[];
  const canManageRow = (r: DashboardRow) =>
    isAdmin || r.owner_user_id === session?.user.id;

  const active = rows.filter((r) => r.status === "active");
  const dashboards = active.filter((r) => r.kind !== "kanban");
  const kanbans = active.filter((r) => r.kind === "kanban");
  const archived = rows.filter((r) => r.status === "archived");
  // Lixeira: só de quem pode geri-la (dono/admin), e nunca itens vencidos —
  // mesmo antes de o cron de purga (pg-cron-purge-trash.sql) removê-los.
  const trashed = rows.filter(
    (r) => r.status === "trashed" && canManageRow(r) && withinTrashTtl(r.trashed_at)
  );

  // Última view p/ restaurar na REABERTURA do app (RestoreLastView). Leitura
  // de custo zero: o layout já chamou loadUserSettings (React cache()).
  const settings = session ? await loadUserSettings(session.user.id) : {};
  const storedView =
    typeof settings.lastView === "string" ? settings.lastView : null;
  const restoreTarget = validateLastView(
    storedView,
    rows.filter((r) => r.status !== "trashed")
  );

  // Insumos do diálogo "Criar kanban" (fontes + campos p/ o agrupamento).
  let sources: Awaited<ReturnType<typeof loadSources>> = [];
  let fields: FieldDefinition[] = [];
  if (canCreate) {
    sources = await loadSources(supabase, orgId);
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
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((r) => (
        <BoardCard
          key={r.id}
          row={r}
          canManage={canManageRow(r)}
          canDuplicate={canCreate}
        />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <RestoreLastView
        target={restoreTarget}
        hadStored={storedView !== null}
      />
      {/* pr-8: afasta o cluster de botões do sino fixo (TaskBell, topo-direito) */}
      <div className="flex items-start justify-between gap-4 pr-8">
        <div>
          <h1 className="text-2xl font-semibold">Workspace</h1>
          <p className="text-muted-foreground text-sm">
            Seu workspace: crie dashboards e kanbans a partir dos seus
            registros.
          </p>
        </div>
        {canCreate ? (
          <div className="flex items-center gap-2">
            <ImportDashboardSheet sources={sources} />
            <CreateMenu sources={sources} fields={fields} />
          </div>
        ) : null}
      </div>

      {dashboards.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nenhum dashboard no workspace ainda.
          {canCreate ? " Use o botão Criar acima." : ""}
        </p>
      ) : (
        cardGrid(dashboards)
      )}

      {kanbans.length > 0 ? (
        <>
          <div>
            <h2 className="text-lg font-semibold">Kanbans</h2>
            <p className="text-muted-foreground text-sm">
              Quadros de cards para gerir projetos e funis — mover um card
              altera o valor do campo no registro.
            </p>
          </div>
          {cardGrid(kanbans)}
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
    </div>
  );
}
