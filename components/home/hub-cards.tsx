// Versão: 2.0 | Data: 12/09/2026
// Cards do hub Workspace e do painel de Operação — servem às duas telas sem
// uma segunda régua.
//
// v2.0 (12/09/2026): CLIENT, lendo o que exibir do contexto de exibição
// (hub-display-context). Antes eram RSC com as decisões em props, e por isso
// marcar "exibir descrição" só aparecia depois de recarregar a página. O
// `accessLabel` dos cards de Operação passa a chegar PRONTO do servidor:
// derivá-lo aqui exigiria importar lib/auth/access.ts, que é server-only.
//
// Três decisões que valem para as três famílias de card:
//  - DESCRIÇÃO é opcional e nasce DESLIGADA. O botão existe para entrar no
//    lugar; a descrição é ajuda de quem está aprendendo, e ocupava a linha toda
//    para sempre.
//  - NÍVEL DE ACESSO é opcional e existe nas três: dashboards/kanbans derivam
//    de visible_to_roles (como já faziam) e os de Operação de areaAccessLabel.
//  - O rótulo da LIXEIRA ("Expira em N dias") NÃO é opcional: é ciclo de vida,
//    não acesso, e esconder isso perderia o prazo de recuperação.
// Em modo LISTA o card vira uma linha só, com altura mínima configurável.
"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  CalendarDays,
  HandCoins,
  LayoutGrid,
  ListChecks,
  FileInput,
  Shuffle,
  SquareKanban,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ROLE_LABELS, type RoleKey } from "@/lib/auth/roles";
import type { WidgetKanbanHubItem } from "@/lib/kanban/hub";
import type { HubLayout } from "@/lib/config/ui-prefs";
import {
  BoardCardMenu,
  type BoardStatus,
} from "@/components/dashboards/board-card-menu";
import { CardGrid } from "@/components/ui/card-grid";
import { PinButton } from "./pin-button";
import { useHubDisplay } from "./hub-display-context";

export const TRASH_TTL_MS = 14 * 86_400_000; // purga em 14 dias (0087)

export interface DashboardRow {
  id: string;
  name: string;
  description: string | null;
  owner_user_id: string | null;
  visible_to_roles: string[];
  kind: "dashboard" | "kanban";
  status: BoardStatus;
  trashed_at: string | null;
  // Só para o picker da IA (preset de fábrica ≠ import) — não exibido no card.
  settings: { preset?: { key?: string } } | null;
}

/** Item da Lixeira ainda dentro da janela de 14 dias? */
export function withinTrashTtl(trashedAt: string | null): boolean {
  return Date.now() - new Date(trashedAt ?? 0).getTime() < TRASH_TTL_MS;
}

/** "Expira em N dias" do card na Lixeira (teto: recém-excluído = 14 dias). */
export function trashExpiryLabel(trashedAt: string | null): string {
  const at = trashedAt ? new Date(trashedAt).getTime() : Date.now();
  const days = Math.ceil((at + TRASH_TTL_MS - Date.now()) / 86_400_000);
  if (days <= 0) return "Expira hoje";
  return days === 1 ? "Expira em 1 dia" : `Expira em ${days} dias`;
}

/** Nível de acesso de um board: papéis compartilhados, ou "Pessoal". */
export function boardAccessLabel(row: DashboardRow): string {
  return row.visible_to_roles.length > 0
    ? `Compartilhado: ${row.visible_to_roles
        .map((r) => ROLE_LABELS[r as RoleKey] ?? r)
        .join(", ")}`
    : "Pessoal";
}

// Em lista o conteúdo vai para uma linha só; em grade, tudo como antes. A
// altura mínima vem de --hub-card-h (data-hub-card + regra em globals.css).
function shellClass(layout: HubLayout, extra?: string): string {
  return cn(
    "relative justify-center",
    layout === "list" && "gap-0 py-4",
    extra
  );
}

function headerClass(layout: HubLayout): string {
  return layout === "list"
    ? "flex flex-row flex-wrap items-baseline gap-x-3 gap-y-0.5 pr-20"
    : "pr-8";
}

export function BoardCard({
  row,
  canManage,
  canDuplicate,
  pinned,
}: {
  row: DashboardRow;
  canManage: boolean;
  canDuplicate: boolean;
  pinned: boolean;
}) {
  const { display } = useHubDisplay();
  const kanban = row.kind === "kanban";
  const trashed = row.status === "trashed";
  const href = kanban ? `/kanbans/${row.id}` : `/dashboards/${row.id}`;
  const description = display.showDescription ? row.description : null;
  // Na Lixeira o prazo SUBSTITUI o nível de acesso (e ignora a preferência).
  const access = trashed
    ? trashExpiryLabel(row.trashed_at)
    : display.showAccess
      ? boardAccessLabel(row)
      : null;

  return (
    <Card
      data-hub-card
      className={shellClass(display.layout, trashed ? "opacity-70" : undefined)}
    >
      <CardHeader className={headerClass(display.layout)}>
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
        {description ? <CardDescription>{description}</CardDescription> : null}
        {access ? <CardDescription>{access}</CardDescription> : null}
      </CardHeader>
      <div className="absolute top-3 right-3 flex items-center">
        {trashed ? null : (
          <PinButton
            kind={kanban ? "kanban" : "dashboard"}
            id={row.id}
            label={row.name}
            pinned={pinned}
          />
        )}
        <BoardCardMenu
          id={row.id}
          kanban={kanban}
          status={row.status}
          canManage={canManage}
          canDuplicate={canDuplicate}
          description={row.description ?? ""}
        />
      </div>
    </Card>
  );
}

// Ícone por key de card de Operação — mapeado AQUI (o catálogo de
// lib/operacao/cards.ts fica dados puros); key nova cai no fallback.
const OPERACAO_ICONS: Record<string, LucideIcon> = {
  agenda: CalendarDays,
  tarefas: ListChecks,
  remuneracao: HandCoins,
  mapeamentos: Shuffle,
  workflow: Workflow,
};

// Ícone por ORIGEM — vale para os cards cuja key é dinâmica (formulários
// criados no Workflow).
const OPERACAO_KIND_ICONS: Record<string, LucideIcon> = {
  formulario: FileInput,
};

/** Card de Operação já serializado pelo servidor (o catálogo é server-only). */
export interface OperacaoCardView {
  key: string;
  label: string;
  description: string;
  href: string;
  kind?: string;
  /** Quem alcança a área — derivado de AREA_GATES no SERVIDOR. */
  accessLabel: string;
}

// Card de OPERAÇÃO: módulo do catálogo em código ou formulário do Workflow —
// sem menu "⋮" e sem UI de exclusão POR CONSTRUÇÃO (não é linha de dashboards;
// criar/excluir formulário é dentro do Workflow). O alfinete não é exclusão:
// mexe só na barra de quem clicou.
export function OperacaoCardItem({
  card,
  pinned,
}: {
  card: OperacaoCardView;
  pinned: boolean;
}) {
  const { display } = useHubDisplay();
  // Lookup INLINE (e não um helper que devolve componente): a regra
  // react-hooks "Cannot create components during render" trata uma chamada de
  // função que devolve componente como criação em render.
  const Icon =
    OPERACAO_ICONS[card.key] ??
    (card.kind ? OPERACAO_KIND_ICONS[card.kind] : undefined) ??
    LayoutGrid;
  return (
    <Card data-hub-card className={shellClass(display.layout)}>
      <CardHeader className={headerClass(display.layout)}>
        <CardTitle className="flex items-center gap-2">
          <Icon className="text-muted-foreground size-4 shrink-0" />
          <Link href={card.href} className="hover:underline">
            {card.label}
          </Link>
        </CardTitle>
        {display.showDescription ? (
          <CardDescription>{card.description}</CardDescription>
        ) : null}
        {display.showAccess ? (
          <CardDescription>{card.accessLabel}</CardDescription>
        ) : null}
      </CardHeader>
      <PinButton
        kind="operacao"
        id={card.key}
        label={card.label}
        pinned={pinned}
        className="absolute top-3 right-3"
      />
    </Card>
  );
}

// Card de um kanban de WIDGET: sem menu "⋮" (ciclo de vida é do dashboard pai;
// renomear é o título do widget no builder). A linha "No dashboard X" é
// PROCEDÊNCIA, não descrição — segue a preferência de descrição porque é
// exatamente o texto secundário que o usuário pediu para poder esconder.
export function WidgetKanbanCard({
  item,
  pinned,
}: {
  item: WidgetKanbanHubItem;
  pinned: boolean;
}) {
  const { display } = useHubDisplay();
  return (
    <Card data-hub-card className={shellClass(display.layout)}>
      <CardHeader className={headerClass(display.layout)}>
        <CardTitle className="flex items-center gap-2">
          <SquareKanban className="text-muted-foreground size-4 shrink-0" />
          <Link href={item.href} className="hover:underline">
            {item.label}
          </Link>
        </CardTitle>
        {display.showDescription ? (
          <CardDescription>
            No dashboard{" "}
            <Link
              href={`/dashboards/${item.dashboardId}`}
              className="hover:text-foreground hover:underline"
            >
              {item.dashboardName}
            </Link>
          </CardDescription>
        ) : null}
      </CardHeader>
      <PinButton
        kind="widget-kanban"
        id={item.widgetId}
        label={item.label}
        pinned={pinned}
        className="absolute top-3 right-3"
      />
    </Card>
  );
}

/** Grade/lista do hub ligada ao contexto de exibição. */
export function HubGrid({ children }: { children: ReactNode }) {
  const { display } = useHubDisplay();
  return (
    <CardGrid
      layout={display.layout}
      columns={display.columns}
      cardHeight={display.cardHeight}
    >
      {children}
    </CardGrid>
  );
}
