// Versão: 2.3 | Data: 10/10/2026
// v2.3 (10/10/2026): formato LISTA vira LINHA DENSA (pontinhos com as cores
//   das abas, nº de abas e de widgets, última abertura, dono, ações no hover)
//   com os fixados agrupados no topo; recorte Todos | Meus | Compartilhados;
//   cards de Operação ganham o NÚMERO VIVO (metric) e o ícone em caixinha.
//
// v2.2 (03/10/2026): o nome do board ganha tooltip com o nome inteiro quando
// está cortado (OverflowTooltip — o modo prévia limita o título a 2 linhas).
// Cards do hub Workspace e do painel de Operação — servem às duas telas sem
// uma segunda régua.
//
// v2.1 (03/10/2026): os helpers da Lixeira (TTL e rótulo de expiração) saíram
// daqui para lib/dashboards/trash.ts. Este módulo é "use client", e o
// Workspace (Server Component) chamava withinTrashTtl dele: no servidor isso é
// uma referência de cliente, e a chamada derrubava a página assim que algum
// board ia para a Lixeira. Daqui o servidor só importa COMPONENTES e TIPOS.
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
import { OverflowTooltip } from "@/components/ui/overflow-tooltip";
import { PinButton } from "./pin-button";
import { useHubDisplay } from "./hub-display-context";
import { DashboardPreview, type PreviewImage } from "./dashboard-preview";
import { sortHubItems, type HubSortDates } from "@/lib/config/hub-sort";
import { nameInitials, relativeTimeLabel } from "@/lib/format/relative-time";
import { normalizeHexColor } from "@/lib/theme";
import { boardsTrashExpiryLabel } from "@/lib/dashboards/trash";

export interface DashboardRow extends HubSortDates {
  preview?: PreviewImage;
  id: string;
  name: string;
  description: string | null;
  owner_user_id: string | null;
  visible_to_roles: string[];
  kind: "dashboard" | "kanban";
  status: BoardStatus;
  trashed_at: string | null;
  // Só para o picker da IA (preset de fábrica ≠ import) — não exibido no card.
  // v2.3 (10/10/2026): `tabs` alimenta os pontinhos/contagem da lista densa.
  settings: {
    preset?: { key?: string };
    tabs?: { id?: string; color?: string }[];
  } | null;
  /** v2.3 (10/10/2026): quantos widgets o board tem (lista densa). */
  widget_count?: number;
  /** v2.3: nome do dono (responsável vinculado ao usuário), quando conhecido. */
  owner_name?: string | null;
}

/** v2.3 (10/10/2026): cores das abas para os pontinhos (máx. 5, só hex). */
export function boardTabColors(row: DashboardRow): string[] {
  const tabs = Array.isArray(row.settings?.tabs) ? row.settings!.tabs! : [];
  return tabs
    .map((t) => normalizeHexColor(t?.color))
    .filter((c): c is string => c !== null)
    .slice(0, 5);
}

export function boardTabCount(row: DashboardRow): number {
  const tabs = Array.isArray(row.settings?.tabs) ? row.settings!.tabs! : [];
  return Math.max(1, tabs.length);
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
    "relative min-w-0 justify-center break-words",
    layout === "list" && "gap-0 py-4",
    extra
  );
}

function headerClass(layout: HubLayout): string {
  return layout === "list"
    ? "flex flex-row flex-wrap items-baseline gap-x-3 gap-y-0.5 pr-20"
    : "pr-20";
}

export function BoardCard({
  row,
  canManage,
  canDuplicate,
  pinned,
  previewScope,
}: {
  row: DashboardRow;
  canManage: boolean;
  canDuplicate: boolean;
  pinned: boolean;
  previewScope: string;
}) {
  const { display } = useHubDisplay();
  const kanban = row.kind === "kanban";
  const trashed = row.status === "trashed";
  const href = kanban ? `/kanbans/${row.id}` : `/dashboards/${row.id}`;
  const description = display.showDescription ? row.description : null;
  // Na Lixeira o prazo SUBSTITUI o nível de acesso (e ignora a preferência).
  const access = trashed
    ? boardsTrashExpiryLabel(row.trashed_at)
    : display.showAccess
      ? boardAccessLabel(row)
      : null;

  return (
    <Card
      data-hub-card
      data-hub-preview={display.layout === "preview" && !kanban && !trashed ? "true" : undefined}
      className={shellClass(display.layout, trashed ? "opacity-70" : undefined)}
    >
      <CardHeader className={headerClass(display.layout)}>
        <CardTitle className="flex items-center gap-2">
          {kanban ? (
            <SquareKanban className="text-muted-foreground size-4 shrink-0" />
          ) : null}
          {trashed ? (
            // Na Lixeira o board NÃO abre: título sem link (rotas dão 404).
            <OverflowTooltip text={row.name}>
              <span className="text-muted-foreground">{row.name}</span>
            </OverflowTooltip>
          ) : (
            // v2.2: nome cortado (line-clamp do modo prévia) mostra o nome
            // inteiro ao passar o mouse — só quando de fato não cabe.
            <OverflowTooltip text={row.name}>
              <Link href={href} className="hover:underline">
                {row.name}
              </Link>
            </OverflowTooltip>
          )}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {access ? <CardDescription>{access}</CardDescription> : null}
      </CardHeader>
      {display.layout === "preview" && !kanban && !trashed ? (
        <DashboardPreview id={row.id} name={row.name} preview={row.preview} scope={previewScope} />
      ) : null}
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

/**
 * v2.3 (10/10/2026): LINHA DENSA do formato "lista" — 38px em vez de um card,
 * e cada coluna carrega um dado real: as cores das abas (os pontinhos, que o
 * usuário já escolhe em dashboard-tabs.tsx — reconhecimento sem custo de
 * miniatura), nº de abas, nº de widgets, última abertura e dono. A regra: se
 * não mostra dado, não é card — é linha. Ações (alfinete e ⋮) aparecem no
 * hover/foco. Na Lixeira, o prazo de expiração ocupa a coluna do dono.
 */
export function BoardListRow({
  row,
  canManage,
  canDuplicate,
  pinned,
  isOwn,
}: {
  row: DashboardRow;
  canManage: boolean;
  canDuplicate: boolean;
  pinned: boolean;
  isOwn: boolean;
}) {
  const { display } = useHubDisplay();
  const kanban = row.kind === "kanban";
  const trashed = row.status === "trashed";
  const href = kanban ? `/kanbans/${row.id}` : `/dashboards/${row.id}`;
  const colors = kanban ? [] : boardTabColors(row);
  const tabs = kanban ? null : boardTabCount(row);
  const widgets = kanban ? null : (row.widget_count ?? null);
  const owner = row.owner_name ?? (isOwn ? "Você" : null);
  const description = display.showDescription ? row.description : null;
  const access = display.showAccess && !trashed ? boardAccessLabel(row) : null;

  return (
    <div
      data-hub-row
      className={cn(
        "group/row hover:bg-accent/50 ease-product grid h-[38px] items-center gap-3 border-b px-3 text-sm transition-colors last:border-b-0",
        "grid-cols-[26px_minmax(0,1fr)_56px] sm:grid-cols-[26px_minmax(0,1fr)_62px_74px_92px_26px_56px]",
        trashed && "opacity-70"
      )}
    >
      <span className="flex items-center" aria-hidden>
        {kanban ? (
          <SquareKanban className="text-muted-foreground size-3.5" />
        ) : colors.length > 0 ? (
          colors.map((c, i) => (
            <i
              key={i}
              className={cn("block size-[7px] rounded-[2px] ring-[1.5px] ring-card", i > 0 && "-ml-0.5")}
              style={{ background: c }}
            />
          ))
        ) : (
          <i className="bg-muted-foreground/40 block size-[7px] rounded-[2px]" />
        )}
      </span>
      <span className="flex min-w-0 items-baseline gap-2">
        {trashed ? (
          <span className="text-muted-foreground truncate font-semibold">{row.name}</span>
        ) : (
          <Link href={href} className="truncate font-semibold tracking-tight hover:underline">
            {row.name}
          </Link>
        )}
        {description ? (
          <em className="text-muted-foreground min-w-0 truncate text-xs not-italic">
            {description}
          </em>
        ) : null}
        {access ? (
          <em className="text-muted-foreground hidden min-w-0 truncate text-xs not-italic md:inline">
            {access}
          </em>
        ) : null}
      </span>
      <span className="text-muted-foreground hidden text-xs tabular-nums sm:inline">
        {tabs === null ? "Kanban" : `${tabs} ${tabs === 1 ? "aba" : "abas"}`}
      </span>
      <span className="text-muted-foreground hidden text-xs tabular-nums sm:inline">
        {widgets === null ? "" : `${widgets} ${widgets === 1 ? "widget" : "widgets"}`}
      </span>
      <span className="text-muted-foreground hidden truncate text-xs tabular-nums sm:inline">
        {trashed ? boardsTrashExpiryLabel(row.trashed_at) : relativeTimeLabel(row.last_opened_at)}
      </span>
      <span className="hidden sm:inline" title={owner ?? undefined}>
        {owner ? (
          <i className="bg-muted text-muted-foreground text-2xs grid size-5 place-items-center rounded-full font-semibold not-italic">
            {row.owner_name ? nameInitials(row.owner_name) : "EU"}
          </i>
        ) : null}
      </span>
      <span
        className={cn(
          "flex items-center justify-end transition-opacity",
          // O alfinete ativo fica sempre à vista: é estado, não ação.
          pinned ? "" : "opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100"
        )}
      >
        {trashed ? null : (
          <PinButton
            kind={kanban ? "kanban" : "dashboard"}
            id={row.id}
            label={row.name}
            pinned={pinned}
            className="p-1"
          />
        )}
        <span className="opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100">
          <BoardCardMenu
            id={row.id}
            kanban={kanban}
            status={row.status}
            canManage={canManage}
            canDuplicate={canDuplicate}
            description={row.description ?? ""}
          />
        </span>
      </span>
    </div>
  );
}

/** v2.3 (10/10/2026): rótulo de grupo com filete (Fixados / Todos). */
function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted-foreground mt-2 mb-1 flex items-center gap-2 text-xs font-semibold after:h-px after:flex-1 after:bg-border">
      {children}
    </p>
  );
}

/** Contêiner único da lista densa: borda, cantos e divisórias entre linhas. */
function DenseList({ children }: { children: ReactNode }) {
  return (
    <div data-hub-dense className="bg-card overflow-hidden rounded-lg border">
      {children}
    </div>
  );
}

/** v2.3: aplica o recorte efêmero por dono (Todos | Meus | Compartilhados). */
function applyOwnerFilter(
  rows: DashboardRow[],
  filter: "todos" | "meus" | "compartilhados",
  userId?: string
): DashboardRow[] {
  if (filter === "meus") return rows.filter((r) => r.owner_user_id === userId);
  if (filter === "compartilhados") {
    return rows.filter((r) => r.visible_to_roles.length > 0);
  }
  return rows;
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
  /** v2.3 (10/10/2026): número vivo (lib/operacao/metrics.ts); ausente = sem. */
  metric?: OperacaoMetricView | null;
}

/** v2.3 (10/10/2026): "12 vencem hoje", "2 falharam" — um número dá motivo
 * para clicar e diz onde é urgente antes de entrar. */
export interface OperacaoMetricView {
  value: string;
  caption: string;
  tone: "neutral" | "ok" | "warn" | "bad";
}

const METRIC_TONE: Record<OperacaoMetricView["tone"], string> = {
  neutral: "text-foreground",
  ok: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
};

function OperacaoMetric({ metric }: { metric: OperacaoMetricView }) {
  return (
    <span className="ml-auto shrink-0 text-right whitespace-nowrap">
      <b className={cn("block text-sm font-semibold tracking-tight tabular-nums", METRIC_TONE[metric.tone])}>
        {metric.value}
      </b>
      <span className="text-muted-foreground block text-micro">{metric.caption}</span>
    </span>
  );
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
          <span className="bg-muted text-muted-foreground grid size-7 shrink-0 place-items-center rounded-md">
            <Icon className="size-4" />
          </span>
          <Link href={card.href} className="hover:underline">
            {card.label}
          </Link>
          {card.metric ? <OperacaoMetric metric={card.metric} /> : null}
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
export function BoardGrid({ rows, canCreate, userId, isAdmin, pins }: {
  rows: DashboardRow[];
  canCreate: boolean;
  userId?: string;
  isAdmin: boolean;
  pins: string[];
}) {
  const { display, ownerFilter } = useHubDisplay();
  const sorted = sortHubItems(
    applyOwnerFilter(rows, ownerFilter, userId),
    display.sort ?? "created_desc"
  );
  const canManage = (row: DashboardRow) => isAdmin || row.owner_user_id === userId;

  // v2.3 (10/10/2026): no formato LISTA, linhas densas com os fixados no topo
  // (o mesmo alfinete da barra lateral). Cartão e prévia seguem como antes.
  if (display.layout === "list") {
    if (sorted.length === 0) {
      return <p className="text-muted-foreground text-sm">Nada neste recorte.</p>;
    }
    const renderRow = (row: DashboardRow) => (
      <BoardListRow key={row.id} row={row} canManage={canManage(row)}
        canDuplicate={canCreate} pinned={pins.includes(row.id)} isOwn={row.owner_user_id === userId} />
    );
    const pinnedRows = sorted.filter((r) => pins.includes(r.id) && r.status !== "trashed");
    const rest = sorted.filter((r) => !pinnedRows.includes(r));
    if (pinnedRows.length === 0) return <DenseList>{rest.map(renderRow)}</DenseList>;
    return (
      <div className="flex flex-col">
        <GroupLabel>Fixados</GroupLabel>
        <DenseList>{pinnedRows.map(renderRow)}</DenseList>
        {rest.length > 0 ? (
          <>
            <GroupLabel>Todos</GroupLabel>
            <DenseList>{rest.map(renderRow)}</DenseList>
          </>
        ) : null}
      </div>
    );
  }

  return <HubGrid>{sorted.map((row) => (
    <BoardCard key={row.id} row={row} previewScope={userId ?? "anonymous"} canManage={canManage(row)}
      canDuplicate={canCreate} pinned={pins.includes(row.id)} />
  ))}</HubGrid>;
}

export function WidgetKanbanGrid({ items, pins }: { items: (WidgetKanbanHubItem & HubSortDates)[]; pins: string[] }) {
  const { display } = useHubDisplay();
  return <HubGrid>{sortHubItems(items, display.sort ?? "created_desc").map((item) => (
    <WidgetKanbanCard key={item.widgetId} item={item} pinned={pins.includes(item.widgetId)} />
  ))}</HubGrid>;
}

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

/**
 * v2.3 (10/10/2026): recorte Todos | Meus | Compartilhados da aba Painéis.
 * "Meus" = sou o dono; "Compartilhados" = visível a algum papel.
 */
export function HubOwnerFilterChips() {
  const { ownerFilter, setOwnerFilter } = useHubDisplay();
  const options = [
    { value: "todos", label: "Todos" },
    { value: "meus", label: "Meus" },
    { value: "compartilhados", label: "Compartilhados" },
  ] as const;
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Recorte por dono">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={ownerFilter === o.value}
          onClick={() => setOwnerFilter(o.value)}
          className={cn(
            "h-7 rounded-md border px-2.5 text-xs font-medium transition-colors",
            ownerFilter === o.value
              ? "border-brand/40 bg-brand/10 text-brand"
              : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
