// Versão: 1.6 | Data: 27/07/2026
// Quadro Kanban (client): colunas + cards com drag & drop HTML5 nativo (D5 do
// plano — sem lib de DnD; o handle do react-grid-layout é `.widget-drag`, então
// o arraste interno não conflita com o grid do dashboard). Move otimista:
// atualiza o estado local, chama a action de move e faz router.refresh(); erro
// reverte e mostra banner inline (padrão do app — não há toast). Usado pela
// página dedicada (/kanbans/[id]), pelo widget kanban (compact) e pelos
// quadros de TAREFAS (v1.1: cards de tarefa com prazo/concluir, `onMove`
// injetável e `columnExtra` p/ o quick-create de cada modo).
// v1.6 (27/07/2026): SELEÇÃO EM MASSA + fila otimista — checkbox no card
//   (hover/Ctrl+clique; select-all no cabeçalho da coluna; Esc limpa), barra
//   flutuante de ações (Mover para / Gerar tarefa / Concluir tarefas /
//   Excluir — registros só admin, com confirmação) e TODO movimento (inclusive
//   card único e multi-drag via payload.items) passa pela fila
//   use-kanban-bulk-queue: aplica local na hora, grava em background e
//   reverte SÓ os itens que falharam (painel persistente + Tentar novamente).
//   O resync com `data` é GUARDADO enquanto a fila está em voo (e o dado que
//   chegou durante a fila é descartado como stale — o settle dispara um
//   refresh que traz o fresco).
// v1.2 (17/07/2026): FEED nos cards — clique no corpo abre o CardDetailSheet
//   (abas Feed|Dados; instância única içada aqui) e o rodapé ganha os chips
//   "+tarefa"/"+comentário"; o lápis de hover passou a abrir a aba Dados do
//   mesmo painel. Sucessos emitem emitDataChanged (event bus W1).
// v1.3 (17/07/2026): reordenação de COLUNAS por arrasto do cabeçalho (payload
//   próprio application/x-kanban-column; persiste via onReorderColumns →
//   settings.columns, ordem autoritativa p/ todas as fontes), coluna fantasma
//   "+" (onAddColumn — modos tarefas/Personalizar) e `owner` p/ o move das
//   colunas "Personalizar" (kanban_placements).
// v1.5 (27/07/2026): campos extras do card exibem SÓ o valor (nome do campo
//   vira title/hover — pedido do usuário: o rótulo poluía o card).
// v1.4 (26/07/2026): campos extras do card aparecem também no modo `compact`
//   (o gate escondia os extras no widget de dashboard — único lugar com picker;
//   `compact` fica só para a largura de coluna).
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Lock, Pencil, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { FieldDefinition, OptionItem } from "@/lib/records/types";
import { DEFAULT_DATE_FORMAT, formatDateValue } from "@/lib/widgets/format";
import {
  completeTasksBulk,
  createTasksBulk,
  deleteRecordsBulk,
  deleteTasksBulk,
  moveRecordCardsBulk,
} from "@/lib/kanban/bulk-actions";
import { completeTask, reopenTask } from "@/lib/tasks/actions";
import { emitDataChanged } from "@/lib/tasks/events";
import { useDebouncedRefresh } from "@/lib/use-debounced-refresh";
import { classifyDue, DUE_STATUS_LABELS } from "@/lib/tasks/alerts";
import { useFontScale } from "@/components/dashboards/font-scale-context";
import {
  KANBAN_MAX_COLUMNS,
  KANBAN_NO_VALUE_KEY,
  KANBAN_OVERFLOW_KEY,
  type KanbanAppearance,
  type KanbanSettings,
} from "@/lib/kanban/types";
import type {
  KanbanBoardData,
  KanbanCard,
  KanbanCardBadge,
  KanbanColumnCards,
  KanbanOwner,
} from "@/lib/kanban/data";
import { badgeFormat, boardMetricFormat, formatKanbanMetric } from "./format";
import {
  CardDetailSheet,
  type CardDetailTab,
  type CardDetailTarget,
} from "@/components/feed/card-detail-sheet";
import {
  TaskSheet,
  type TaskFormContext,
} from "@/components/tarefas/task-sheet";
import { BulkActionBar, type BulkTaskInput } from "./bulk-action-bar";
import {
  useKanbanBulkQueue,
  type QueueItem,
} from "./use-kanban-bulk-queue";

// Contexto de registros p/ os painéis de edição abertos pelos cards.
export interface KanbanRecordContext {
  fields: FieldDefinition[];
  responsibles: OptionItem[];
  operations: OptionItem[];
  userRoles: string[];
  canEditValues: boolean;
  canManageFields: boolean;
}

export interface KanbanMoveResult {
  ok?: boolean;
  message?: string;
}

export interface KanbanDragPayload {
  cardId: string;
  fromKey: string;
  dateValue: string | null;
  // v1.6 (seleção em massa): presentes quando o card arrastado faz parte da
  // seleção — o drop move TODOS. Payload antigo (sem items) segue válido.
  items?: { cardId: string; fromKey: string; dateValue: string | null }[];
}

// Canal próprio do drag de COLUNA (cards continuam em text/plain; no dragover
// só os TYPES são legíveis — é assim que os dois arrastes coexistem).
const COLUMN_DND_TYPE = "application/x-kanban-column";

// Cor estável a partir de um valor categórico (faixa lateral do card).
function colorFromValue(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) % 360;
  }
  return `hsl(${h} 65% 45%)`;
}

// Texto de um badge do card (métricas 28/07/2026). Tarefas mantêm os textos
// dos pills ("N tarefa(s)"/"N atrasada(s)"); conectados levam o rótulo junto
// ("2 Leads vinculados"); idade = "N d"; campo = só o valor (nome no hover,
// como os campos extras).
function badgeText(b: KanbanCardBadge): string {
  const v = b.value ?? 0;
  if (b.kind === "tasks") {
    return b.key === "tasks:overdue" ? `${v} atrasada(s)` : `${v} tarefa(s)`;
  }
  if (b.kind === "linked") {
    return `${formatKanbanMetric(v, "number")} ${b.label}`;
  }
  return formatKanbanMetric(v, badgeFormat(b));
}

// Badges do rodapé do card. `badges` ausente (quadro legado/modo tarefas/
// lean) = pill de tarefas abertas de sempre. value null (fato indisponível)
// fica OCULTO — nunca um 0 enganoso; tasks com 0 idem (paridade com o pill
// legado, que só aparecia com openTasks > 0).
function KanbanCardBadges({ card }: { card: KanbanCard }) {
  const badges =
    card.badges ??
    (card.openTasks > 0
      ? [
          {
            key: "tasks:open",
            label: "Tarefas abertas",
            kind: "tasks" as const,
            value: card.openTasks,
          },
        ]
      : []);
  const visible = badges.filter(
    (b) => b.value != null && (b.kind !== "tasks" || b.value > 0)
  );
  if (visible.length === 0) return null;
  return (
    <div className="mt-1 ml-1.5 flex flex-wrap gap-1">
      {visible.map((b) => (
        <span
          key={b.key}
          title={b.label}
          className={cn(
            "inline-block rounded px-1.5 py-0.5 text-[11px]",
            b.kind === "tasks" && b.key === "tasks:overdue"
              ? "bg-destructive/10 text-destructive"
              : b.kind === "tasks"
                ? "bg-brand/10 text-brand"
                : "bg-muted text-muted-foreground"
          )}
        >
          {badgeText(b)}
        </span>
      ))}
    </div>
  );
}

// Coluna fantasma "+": adiciona uma fase inline (modos tarefas/Personalizar).
function AddColumnGhost({
  onAdd,
  atLimit,
}: {
  onAdd: (label: string) => Promise<KanbanMoveResult>;
  atLimit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (saving) return;
    setSaving(true);
    setError(null);
    const res = await onAdd(label);
    setSaving(false);
    if (!res.ok) {
      setError(res.message ?? "Falha ao adicionar a coluna.");
      return;
    }
    setLabel("");
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          if (!atLimit) setEditing(true);
        }}
        disabled={atLimit}
        className="text-muted-foreground hover:text-foreground hover:border-primary/50 flex h-24 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed transition-colors disabled:opacity-50"
        aria-label="Adicionar coluna"
        title={
          atLimit ? `Limite de ${KANBAN_MAX_COLUMNS} colunas` : "Adicionar coluna"
        }
      >
        <Plus className="size-4" />
      </button>
    );
  }
  return (
    <div className="bg-muted/40 flex h-fit w-56 shrink-0 flex-col gap-1.5 rounded-lg border border-dashed p-2">
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void confirm();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder="Nome da coluna"
        className="border-input h-7 rounded-md border bg-transparent px-2 text-xs outline-none"
        aria-label="Nome da nova coluna"
      />
      {error ? <p className="text-destructive text-[11px]">{error}</p> : null}
      <div className="flex gap-1">
        <Button size="sm" className="h-6 px-2 text-xs" onClick={confirm} disabled={saving}>
          {saving ? "Adicionando…" : "Adicionar"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={() => setEditing(false)}
          disabled={saving}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}

// Corpo do card de TAREFA: prazo com destaque, responsável, vínculo, concluir.
function TaskCardBody({
  card,
  readOnly,
  dueSoonDays,
  onOpenDetail,
}: {
  card: KanbanCard;
  readOnly?: boolean;
  // Antecedência de "vence em breve" (config do board; default 3).
  dueSoonDays?: number;
  onOpenDetail: (tab: CardDetailTab, focusComposer?: boolean) => void;
}) {
  const router = useRouter();
  const task = card.task!;
  const done = Boolean(task.completed_at);
  const status = classifyDue(task, dueSoonDays);

  return (
    <>
      <div className="flex items-start gap-2 pl-1.5">
        <input
          type="checkbox"
          checked={done}
          disabled={readOnly}
          onChange={async () => {
            if (readOnly) return;
            const res = done
              ? await reopenTask(task.id)
              : await completeTask(task.id);
            if (res.ok) {
              emitDataChanged({
                kind: "task",
                taskId: task.id,
                recordId: task.record_id,
                boardId: task.board_id,
              });
              router.refresh();
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 size-4 shrink-0 accent-primary"
          aria-label={done ? "Reabrir tarefa" : "Concluir tarefa"}
        />
        <span
          className={cn(
            "min-w-0 flex-1 font-medium break-words",
            done && "text-muted-foreground line-through"
          )}
        >
          {card.title}
        </span>
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {task.locked ? (
            <Lock
              className="text-muted-foreground size-3.5"
              aria-label="Exclusão travada (só admin/gestor)"
            />
          ) : null}
          {!readOnly ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label="Editar tarefa"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetail("dados");
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Pencil className="size-3.5" />
            </Button>
          ) : null}
        </span>
      </div>
      <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-1.5 pl-7 text-xs">
        {task.due_date ? (
          <span
            className={cn(
              "rounded px-1 py-0.5",
              status === "atrasada" &&
                "bg-destructive/10 text-destructive font-medium",
              status === "em_breve" && "bg-amber-500/15 text-amber-700 dark:text-amber-400 font-medium"
            )}
            title={status ? DUE_STATUS_LABELS[status] : undefined}
          >
            {formatDateValue(task.due_date, DEFAULT_DATE_FORMAT)}
            {task.due_time ? ` ${task.due_time.slice(0, 5)}` : ""}
          </span>
        ) : null}
        {task.responsible_label ? <span>{task.responsible_label}</span> : null}
        {task.record?.title ? (
          <span className="flex items-center gap-0.5">
            <Link2 className="size-3" />
            {task.record.title}
          </span>
        ) : null}
      </div>
    </>
  );
}

function CardView({
  card,
  draggable,
  onDragStart,
  onDragEnd,
  taskCtx,
  readOnly,
  dueSoonDays,
  onOpenDetail,
  cardAp,
  selectable,
  selected,
  selectionActive,
  onToggleSelect,
}: {
  card: KanbanCard;
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  taskCtx?: TaskFormContext;
  readOnly?: boolean;
  dueSoonDays?: number;
  // Abre o CardDetailSheet (instância única no KanbanBoard).
  onOpenDetail: (
    card: KanbanCard,
    tab: CardDetailTab,
    focusComposer?: boolean
  ) => void;
  // Aparência dos cards (settings.kanban.appearance.card).
  cardAp?: KanbanAppearance["card"];
  // Seleção em massa (v1.6): checkbox no hover (sempre visível com seleção
  // ativa); Ctrl/Cmd+clique também alterna.
  selectable?: boolean;
  selected?: boolean;
  selectionActive?: boolean;
  onToggleSelect?: () => void;
}) {
  // Detalhe só para cards com entidade carregada (registro ou tarefa).
  const canOpen = !readOnly && Boolean(card.record ?? card.task);
  const fontScale = useFontScale();
  const open = (tab: CardDetailTab, focusComposer?: boolean) => {
    if (canOpen) onOpenDetail(card, tab, focusComposer);
  };

  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.stopPropagation();
        onDragStart(e);
      }}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        // Ctrl/Cmd+clique alterna a seleção (atalho de poder).
        if (selectable && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          onToggleSelect?.();
          return;
        }
        // Clique no corpo abre o feed; seleção de texto não conta como clique.
        if (window.getSelection()?.toString()) return;
        open("feed");
      }}
      className={cn(
        "bg-card group relative rounded-md border p-2 text-sm shadow-sm",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-default",
        canOpen && !draggable && "cursor-pointer",
        selected && "ring-primary ring-2",
        selectionActive && "pl-7"
      )}
      style={{
        background: cardAp?.bg,
        color: cardAp?.text,
        borderColor: cardAp?.border,
        borderRadius: cardAp?.radius,
        // Px explícito é absoluto; Auto acompanha a escala do dashboard (na
        // página dedicada de kanban o context default 1 mantém tudo como era).
        fontSize:
          cardAp?.fontSize ??
          (fontScale !== 1 ? Math.round(14 * fontScale) : undefined),
      }}
    >
      {card.colorValue && cardAp?.showStripe !== false ? (
        <span
          aria-hidden
          className="absolute inset-y-1 left-0 w-1 rounded-full"
          style={{ background: colorFromValue(card.colorValue) }}
        />
      ) : null}
      {selectable ? (
        <span
          className={cn(
            "absolute top-1.5 left-1.5 z-10 transition-opacity",
            selectionActive || selected
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100"
          )}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          draggable={false}
        >
          <Checkbox
            checked={Boolean(selected)}
            onCheckedChange={() => onToggleSelect?.()}
            aria-label={`Selecionar ${card.title}`}
            className="bg-card size-4"
          />
        </span>
      ) : null}
      {card.task && taskCtx ? (
        <TaskCardBody
          card={card}
          readOnly={readOnly}
          dueSoonDays={dueSoonDays}
          onOpenDetail={open}
        />
      ) : (
        <>
          <div className="flex items-start justify-between gap-1 pl-1.5">
            <span className="font-medium break-words">{card.title}</span>
            <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              {card.isMock ? (
                <Lock
                  className="text-muted-foreground size-3.5"
                  aria-label="Registro de demonstração (congelado)"
                />
              ) : null}
              {card.record && !readOnly ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label="Editar registro"
                  onClick={(e) => {
                    e.stopPropagation();
                    open("dados");
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Pencil className="size-3.5" />
                </Button>
              ) : null}
            </span>
          </div>
          {card.fields.length > 0 ? (
            <div className="text-muted-foreground mt-1 flex flex-col gap-0.5 pl-1.5 text-xs">
              {/* Só o VALOR no corpo do card; o nome do campo fica no hover. */}
              {card.fields.map((f) => (
                <div key={f.label} title={f.label} className="break-words">
                  {f.value}
                </div>
              ))}
            </div>
          ) : null}
          <KanbanCardBadges card={card} />
        </>
      )}

      {/* Rodapé: "+tarefa" (registro) / "+tarefa" = subtarefa (tarefa) e
          "+comentário" (abre o feed com o composer focado). */}
      {canOpen ? (
        <div
          className="mt-1 flex items-center gap-1 pl-1.5"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          draggable={false}
        >
          {taskCtx ? (
            <TaskSheet
              ctx={taskCtx}
              defaults={
                card.task
                  ? { parentTaskId: card.task.id }
                  : {
                      recordId: card.id,
                      recordTitle: card.record?.title ?? card.title,
                    }
              }
              triggerLabel="+tarefa"
              chipTrigger
            />
          ) : null}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground rounded px-1 py-0.5 text-[11px] font-medium transition-colors"
            onClick={() => open("feed", true)}
            aria-label="Novo comentário"
          >
            +comentário
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function KanbanBoard({
  data,
  settings,
  canMove,
  recordCtx,
  taskCtx,
  onMove,
  columnExtra,
  compact,
  readOnly,
  owner,
  canReorderColumns,
  onReorderColumns,
  onAddColumn,
}: {
  data: KanbanBoardData;
  settings: KanbanSettings;
  // Usuário pode mover cards (edit_record_values / envolvido na tarefa).
  canMove: boolean;
  recordCtx: KanbanRecordContext;
  // Presente no modo tarefas (painéis de tarefa dos cards).
  taskCtx?: TaskFormContext;
  // Ação de movimento; ausente = moveRecordCard (modo registros).
  onMove?: (
    payload: KanbanDragPayload,
    targetKey: string,
    targetCol: KanbanColumnCards
  ) => Promise<KanbanMoveResult>;
  // Nó extra no cabeçalho de cada coluna (quick-create do modo).
  columnExtra?: (col: KanbanColumnCards) => React.ReactNode;
  // Widget dentro do dashboard: colunas mais justas (w-56). Os campos extras
  // do card aparecem em TODOS os contextos (o picker vive no widget-builder).
  compact?: boolean;
  // Snapshot público: sem drag, sem painéis de edição, sem concluir.
  readOnly?: boolean;
  // Dono da visão (widget/board) — obrigatório p/ mover nas colunas
  // "Personalizar" (kanban_placements).
  owner?: KanbanOwner;
  // Reordenar colunas arrastando o cabeçalho (persistência no chamador).
  canReorderColumns?: boolean;
  onReorderColumns?: (orderedKeys: string[]) => Promise<KanbanMoveResult>;
  // "+" ao lado das colunas (modos tarefas/Personalizar; chamador persiste).
  onAddColumn?: (label: string) => Promise<KanbanMoveResult>;
}) {
  const [columns, setColumns] = useState<KanbanColumnCards[]>(data.columns);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Drag de COLUNA (cabeçalho): coluna arrastada + alvo do indicador.
  const [colDragging, setColDragging] = useState<string | null>(null);
  const [colDropKey, setColDropKey] = useState<string | null>(null);
  // Seleção em massa (v1.6): ids dos cards selecionados.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Painel de detalhe (Feed|Dados) — UMA instância para o quadro inteiro.
  const [detail, setDetail] = useState<{
    target: CardDetailTarget;
    tab: CardDetailTab;
    focusComposer: boolean;
  } | null>(null);

  const isTasksMode = settings.mode === "tarefas";
  const debouncedRefresh = useDebouncedRefresh();
  // Reconcile ao drenar a fila: anuncia a mutação (hosts re-buscam) + 1
  // refresh debounced (cinto & suspensório na página dedicada).
  const onQueueSettled = useCallback(() => {
    emitDataChanged(isTasksMode ? { kind: "task" } : { kind: "record" });
    debouncedRefresh();
  }, [isTasksMode, debouncedRefresh]);
  const queue = useKanbanBulkQueue({ setColumns, onSettled: onQueueSettled });

  // Contexto de tarefa p/ chips e feed: quadros de registros não recebem
  // taskCtx — deriva dos papéis do contexto de registros.
  const isManager =
    recordCtx.userRoles.includes("admin") ||
    recordCtx.userRoles.includes("gestor");
  const effTaskCtx: TaskFormContext = taskCtx ?? {
    responsibles: recordCtx.responsibles,
    canAssignOthers: isManager,
    canLock: isManager,
    canGlobal: isManager,
  };

  function openDetail(
    card: KanbanCard,
    tab: CardDetailTab,
    focusComposer = false
  ) {
    const target: CardDetailTarget | null = card.task
      ? { task: card.task }
      : card.record
        ? { record: card.record }
        : null;
    if (target) setDetail({ target, tab, focusComposer });
  }

  // Re-sincroniza com o servidor após router.refresh() (novas props) — com a
  // GUARDA da fila: dado que chega com a fila em voo é stale (clobraria o
  // otimista) e é descartado; o settle da fila dispara um refresh que traz o
  // fresco (props novas com pending 0 → aplica).
  const skipNextData = useRef(false);
  useEffect(() => {
    if (queue.pending > 0) {
      skipNextData.current = true;
      return;
    }
    if (skipNextData.current) {
      skipNextData.current = false;
      return;
    }
     
    setColumns(data.columns);
    // Poda a seleção: card que sumiu do quadro sai da seleção.
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(
        data.columns.flatMap((c) => c.cards.map((card) => card.id))
      );
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [data, queue.pending]);

  // Esc limpa a seleção.
  useEffect(() => {
    if (selected.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size]);

  const movable = (card: KanbanCard, col: KanbanColumnCards) =>
    !readOnly && canMove && !card.isMock && col.key !== KANBAN_OVERFLOW_KEY;
  // Selecionável p/ ações em massa (mock é congelado no produto inteiro).
  const selectable = (card: KanbanCard) => !readOnly && !card.isMock;

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ---- helpers imutáveis da fila (apply/revert por item) ----

  const applyMoveMany = (
    cols: KanbanColumnCards[],
    ids: Set<string>,
    toKey: string
  ): KanbanColumnCards[] => {
    const moved: KanbanCard[] = [];
    const stripped = cols.map((c) => {
      if (c.key === toKey) return c;
      const keep = c.cards.filter((x) => {
        if (ids.has(x.id)) {
          moved.push({ ...x, columnKey: toKey });
          return false;
        }
        return true;
      });
      return keep.length === c.cards.length
        ? c
        : { ...c, cards: keep, count: keep.length };
    });
    if (moved.length === 0) return cols;
    return stripped.map((c) =>
      c.key === toKey
        ? { ...c, cards: [...moved, ...c.cards], count: c.cards.length + moved.length }
        : c
    );
  };

  const revertMoveMany = (
    cols: KanbanColumnCards[],
    failed: QueueItem[],
    toKey: string
  ): KanbanColumnCards[] => {
    let next = cols;
    for (const it of failed) {
      const card = next
        .find((c) => c.key === toKey)
        ?.cards.find((x) => x.id === it.id);
      if (!card) continue;
      next = next.map((c) => {
        if (c.key === toKey) {
          const cards = c.cards.filter((x) => x.id !== it.id);
          return { ...c, cards, count: cards.length };
        }
        if (c.key === it.fromKey) {
          const cards = [{ ...card, columnKey: it.fromKey }, ...c.cards];
          return { ...c, cards, count: cards.length };
        }
        return c;
      });
    }
    return next;
  };

  const removeMany = (
    cols: KanbanColumnCards[],
    ids: Set<string>
  ): KanbanColumnCards[] =>
    cols.map((c) => {
      const keep = c.cards.filter((x) => !ids.has(x.id));
      return keep.length === c.cards.length
        ? c
        : { ...c, cards: keep, count: keep.length };
    });

  const patchOpenTasks = (
    cols: KanbanColumnCards[],
    patch: Map<string, number>
  ): KanbanColumnCards[] =>
    cols.map((c) => ({
      ...c,
      cards: c.cards.map((x) =>
        patch.has(x.id) ? { ...x, openTasks: patch.get(x.id)! } : x
      ),
    }));

  // Itens da fila a partir de ids (fromKey/título/data pelo estado atual).
  const queueItemsOf = (ids: string[]): QueueItem[] => {
    const out: QueueItem[] = [];
    for (const id of ids) {
      for (const col of columns) {
        const card = col.cards.find((x) => x.id === id);
        if (card) {
          out.push({
            id,
            fromKey: col.key,
            title: card.title,
            dateValue: card.dateValue,
          });
          break;
        }
      }
    }
    return out;
  };

  // ---- MOVER (drag de 1 ou N, e "Mover para" da barra) ----
  function enqueueMove(items: QueueItem[], toKey: string) {
    const target = columns.find((c) => c.key === toKey);
    if (!target || target.noDrop) return;
    const filtered = items.filter((it) => it.fromKey !== toKey);
    if (filtered.length === 0) return;
    // Personalizar sem dono conhecido: não arrisca gravar campo do registro.
    if (settings.columnSource === "custom" && !owner && !onMove) {
      setError("Quadro personalizado sem contexto — recarregue a página.");
      return;
    }
    setError(null);
    const ids = new Set(filtered.map((it) => it.id));
    queue.enqueue({
      label: "mover",
      items: filtered,
      apply: (cols) => applyMoveMany(cols, ids, toKey),
      revert: (cols, failedIds) =>
        revertMoveMany(
          cols,
          filtered.filter((it) => failedIds.has(it.id)),
          toKey
        ),
      exec: async (chunk) => {
        if (onMove) {
          // Modo tarefas: uma action por card (moveTaskPhase do host) —
          // resultados por item p/ o revert parcial.
          const results = await Promise.all(
            chunk.map(async (it) => {
              try {
                const res = await onMove(
                  { cardId: it.id, fromKey: it.fromKey, dateValue: it.dateValue },
                  toKey,
                  target
                );
                return {
                  id: it.id,
                  ok: Boolean(res.ok),
                  ...(res.message ? { message: res.message } : {}),
                };
              } catch {
                return { id: it.id, ok: false, message: "Falha de rede." };
              }
            })
          );
          return { ok: true, results };
        }
        return moveRecordCardsBulk({
          items: chunk.map((it) => ({
            recordId: it.id,
            currentDateValue: it.dateValue,
          })),
          targetKey: toKey,
          groupField: settings.groupField,
          dateField: settings.dateField,
          dateBucket: settings.dateBucket,
          writeBack: settings.writeBack,
          // Colunas "Personalizar": posiciona na visão (não edita o registro).
          ...(settings.columnSource === "custom" && owner
            ? { custom: { ownerKind: owner.kind, ownerId: owner.id } }
            : {}),
        });
      },
    });
  }

  function handleDrop(toKey: string, e: React.DragEvent) {
    e.preventDefault();
    setDropTarget(null);
    setDragging(null);
    let payload: KanbanDragPayload;
    try {
      payload = JSON.parse(e.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    if (!payload?.cardId) return;
    const raw = payload.items?.length ? payload.items : [payload];
    // Título p/ o painel de falhas vem do estado atual.
    const byId = new Map(queueItemsOf(raw.map((p) => p.cardId)).map((i) => [i.id, i]));
    const items: QueueItem[] = raw.map((p) => ({
      id: p.cardId,
      fromKey: p.fromKey,
      title: byId.get(p.cardId)?.title ?? p.cardId,
      dateValue: p.dateValue,
    }));
    enqueueMove(items, toKey);
    if (payload.items?.length) setSelected(new Set());
  }

  // ---- ações da barra flutuante ----
  const selectedItems = () => queueItemsOf([...selected]);

  function bulkCreateTask(input: BulkTaskInput) {
    const items = selectedItems();
    const before = new Map<string, number>();
    const after = new Map<string, number>();
    for (const col of columns) {
      for (const card of col.cards) {
        if (selected.has(card.id)) {
          before.set(card.id, card.openTasks);
          after.set(card.id, card.openTasks + 1);
        }
      }
    }
    setSelected(new Set());
    queue.enqueue({
      label: "gerar tarefa",
      items,
      apply: (cols) => patchOpenTasks(cols, after),
      revert: (cols, failedIds) =>
        patchOpenTasks(
          cols,
          new Map([...before].filter(([id]) => failedIds.has(id)))
        ),
      exec: (chunk) =>
        createTasksBulk({
          recordIds: chunk.map((i) => i.id),
          title: input.title,
          due_date: input.due_date,
          responsible_id: input.responsible_id,
          locked: settings.tasks?.lockByDefault,
        }),
    });
  }

  function bulkCompleteTasks() {
    const items = selectedItems();
    const before = new Map<string, number>();
    const zero = new Map<string, number>();
    for (const col of columns) {
      for (const card of col.cards) {
        if (selected.has(card.id)) {
          before.set(card.id, card.openTasks);
          zero.set(card.id, 0);
        }
      }
    }
    setSelected(new Set());
    queue.enqueue({
      label: "concluir tarefas",
      items,
      // Modo registros: zera o badge de abertas; tarefas: sem otimista
      // estrutural (o settle re-busca — coluna "Concluída" é config do host).
      apply: (cols) => (isTasksMode ? cols : patchOpenTasks(cols, zero)),
      revert: (cols, failedIds) =>
        isTasksMode
          ? cols
          : patchOpenTasks(
              cols,
              new Map([...before].filter(([id]) => failedIds.has(id)))
            ),
      exec: (chunk) =>
        completeTasksBulk(
          isTasksMode
            ? { taskIds: chunk.map((i) => i.id) }
            : { recordIds: chunk.map((i) => i.id) }
        ),
    });
  }

  function bulkDelete() {
    const items = selectedItems();
    // Snapshot dos cards p/ reinserir os que falharem.
    const snapshot = new Map<string, KanbanCard>();
    for (const col of columns) {
      for (const card of col.cards) {
        if (selected.has(card.id)) snapshot.set(card.id, card);
      }
    }
    setSelected(new Set());
    const ids = new Set(items.map((i) => i.id));
    queue.enqueue({
      label: "excluir",
      items,
      apply: (cols) => removeMany(cols, ids),
      revert: (cols, failedIds) => {
        let next = cols;
        for (const it of items) {
          if (!failedIds.has(it.id)) continue;
          const card = snapshot.get(it.id);
          if (!card) continue;
          next = next.map((c) =>
            c.key === it.fromKey
              ? { ...c, cards: [card, ...c.cards], count: c.cards.length + 1 }
              : c
          );
        }
        return next;
      },
      exec: (chunk) =>
        isTasksMode
          ? deleteTasksBulk(chunk.map((i) => i.id))
          : deleteRecordsBulk(chunk.map((i) => i.id)),
    });
  }

  // Colunas especiais não são arrastáveis (ficam sempre no fim).
  const specialCol = (key: string) =>
    key === KANBAN_NO_VALUE_KEY || key === KANBAN_OVERFLOW_KEY;

  async function handleColumnDrop(targetKey: string, e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setColDropKey(null);
    setColDragging(null);
    if (!onReorderColumns) return;
    const fromKey = e.dataTransfer.getData(COLUMN_DND_TYPE);
    if (!fromKey || fromKey === targetKey) return;
    // Metade esquerda = inserir antes; direita = depois.
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;

    const keys = columns.map((c) => c.key).filter((k) => k !== fromKey);
    let idx = keys.indexOf(targetKey);
    if (idx < 0) return;
    if (after) idx += 1;
    keys.splice(idx, 0, fromKey);

    const before = columns;
    setError(null);
    // Otimista: reordena localmente; especiais permanecem no fim por construção.
    setColumns((cols) =>
      keys
        .map((k) => cols.find((c) => c.key === k))
        .filter((c): c is KanbanColumnCards => Boolean(c))
    );
    const res = await onReorderColumns(keys);
    if (!res.ok) {
      setColumns(before);
      setError(res.message ?? "Falha ao reordenar as colunas.");
    }
  }

  const kap = settings.appearance ?? {};

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {error ? (
        <p className="text-destructive text-sm" role="status">
          {error}
        </p>
      ) : null}
      {/* Painel PERSISTENTE de falhas da fila: os cards falhos já foram
          revertidos à origem — aqui o porquê + reprocessar/dispensar. */}
      {queue.failures.length > 0 ? (
        <div
          role="alert"
          className="border-destructive/50 bg-destructive/5 rounded-md border p-2 text-sm"
        >
          <p className="text-destructive font-medium">
            {queue.failures.length} card(s) não foram processados:
          </p>
          <ul className="text-destructive/90 mt-1 flex flex-col gap-0.5 text-xs">
            {queue.failures.slice(0, 8).map((f, i) => (
              <li key={`${f.id}-${i}`}>
                {f.title} — {f.message}
              </li>
            ))}
            {queue.failures.length > 8 ? (
              <li>… e mais {queue.failures.length - 8}.</li>
            ) : null}
          </ul>
          <div className="mt-1.5 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={queue.retry}
            >
              Tentar novamente
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={queue.dismissFailures}
            >
              Dispensar
            </Button>
          </div>
        </div>
      ) : null}
      {queue.pending > 0 ? (
        <p
          className="text-muted-foreground flex items-center gap-1 text-xs"
          role="status"
        >
          <Loader2 className="size-3 animate-spin" /> Sincronizando… (
          {queue.pending})
        </p>
      ) : null}
      <div
        className={cn(
          "flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2",
          kap.boardBg && "rounded-lg p-2"
        )}
        style={{ background: kap.boardBg }}
      >
        {columns.map((col) => {
          const overWip =
            col.wipLimit != null && col.wipLimit > 0 && col.count > col.wipLimit;
          return (
            <div
              key={col.key}
              onDragOver={(e) => {
                // Drag de COLUNA: indicador de inserção; cards: destaque da coluna.
                if (e.dataTransfer.types.includes(COLUMN_DND_TYPE)) {
                  e.preventDefault();
                  setColDropKey(col.key);
                  return;
                }
                if (col.noDrop) return;
                e.preventDefault();
                setDropTarget(col.key);
              }}
              onDragLeave={() => {
                setDropTarget((t) => (t === col.key ? null : t));
                setColDropKey((t) => (t === col.key ? null : t));
              }}
              onDrop={(e) => {
                if (e.dataTransfer.types.includes(COLUMN_DND_TYPE)) {
                  void handleColumnDrop(col.key, e);
                  return;
                }
                void handleDrop(col.key, e);
              }}
              className={cn(
                "bg-muted/40 group/col flex max-h-full w-64 shrink-0 flex-col rounded-lg border",
                compact && "w-56",
                dropTarget === col.key && dragging && "ring-brand/60 ring-2",
                colDropKey === col.key &&
                  colDragging &&
                  "ring-brand/60 ring-2 ring-dashed"
              )}
              style={{
                background: kap.column?.bg,
                borderColor: kap.column?.border,
                borderRadius: kap.column?.radius,
              }}
            >
              <div
                draggable={Boolean(
                  canReorderColumns && onReorderColumns && !specialCol(col.key)
                )}
                onDragStart={(e) => {
                  // Não deixa virar drag de card; payload só no canal de coluna.
                  e.stopPropagation();
                  setColDragging(col.key);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData(COLUMN_DND_TYPE, col.key);
                }}
                onDragEnd={() => {
                  setColDragging(null);
                  setColDropKey(null);
                }}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-t-lg border-b px-2 py-1.5",
                  canReorderColumns &&
                    onReorderColumns &&
                    !specialCol(col.key) &&
                    "cursor-grab active:cursor-grabbing"
                )}
                title={
                  canReorderColumns && onReorderColumns && !specialCol(col.key)
                    ? "Arraste para reordenar as colunas"
                    : undefined
                }
                style={{
                  ...(col.color
                    ? { borderTopColor: col.color, borderTopWidth: 3 }
                    : {}),
                  background: kap.column?.headerBg,
                  color: kap.column?.headerColor,
                  ...(kap.column?.radius != null
                    ? {
                        borderTopLeftRadius: kap.column.radius,
                        borderTopRightRadius: kap.column.radius,
                      }
                    : {}),
                }}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  {/* Select-all da coluna (só cards selecionáveis). */}
                  {!readOnly && col.cards.some(selectable) ? (
                    <span
                      className={cn(
                        "transition-opacity",
                        selected.size > 0
                          ? "opacity-100"
                          : "opacity-0 group-hover/col:opacity-100 hover:opacity-100"
                      )}
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      draggable={false}
                    >
                      <Checkbox
                        className="size-3.5"
                        checked={col.cards
                          .filter(selectable)
                          .every((x) => selected.has(x.id))}
                        onCheckedChange={() => {
                          const ids = col.cards.filter(selectable).map((x) => x.id);
                          setSelected((prev) => {
                            const next = new Set(prev);
                            const all = ids.every((id) => next.has(id));
                            for (const id of ids) {
                              if (all) next.delete(id);
                              else next.add(id);
                            }
                            return next;
                          });
                        }}
                        aria-label={`Selecionar todos em ${col.label}`}
                      />
                    </span>
                  ) : null}
                  <span className="truncate text-sm font-medium">{col.label}</span>
                  <span
                    className={cn(
                      "text-muted-foreground rounded-full border px-1.5 text-xs",
                      overWip && "border-destructive text-destructive font-semibold"
                    )}
                    style={{
                      background: kap.counter?.bg,
                      color: kap.counter?.color,
                    }}
                    title={
                      overWip
                        ? `Limite de ${col.wipLimit} card(s) excedido`
                        : undefined
                    }
                  >
                    {col.count}
                    {col.wipLimit != null && col.wipLimit > 0
                      ? `/${col.wipLimit}`
                      : ""}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {data.metricLabel ? (
                    <span
                      className="text-muted-foreground text-xs"
                      title={data.metricLabel}
                      style={{ color: kap.metricColor }}
                    >
                      {formatKanbanMetric(col.metricSum, boardMetricFormat(data))}
                    </span>
                  ) : null}
                  {columnExtra ? columnExtra(col) : null}
                </div>
              </div>
              <div className="flex min-h-16 flex-col gap-2 overflow-y-auto p-2">
                {col.cards.map((card) => (
                  <CardView
                    key={card.id}
                    card={card}
                    draggable={movable(card, col)}
                    onDragStart={(e) => {
                      setDragging(card.id);
                      e.dataTransfer.effectAllowed = "move";
                      // Card selecionado arrasta a SELEÇÃO inteira (items);
                      // payload antigo (1 card) segue idêntico.
                      const base = {
                        cardId: card.id,
                        fromKey: col.key,
                        dateValue: card.dateValue,
                      };
                      const payload: KanbanDragPayload =
                        selected.has(card.id) && selected.size > 1
                          ? {
                              ...base,
                              items: queueItemsOf([...selected]).map((it) => ({
                                cardId: it.id,
                                fromKey: it.fromKey,
                                dateValue: it.dateValue,
                              })),
                            }
                          : base;
                      e.dataTransfer.setData(
                        "text/plain",
                        JSON.stringify(payload)
                      );
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setDropTarget(null);
                    }}
                    taskCtx={effTaskCtx}
                    readOnly={readOnly}
                    dueSoonDays={settings.tasks?.dueSoonDays}
                    onOpenDetail={openDetail}
                    cardAp={kap.card}
                    selectable={selectable(card)}
                    selected={selected.has(card.id)}
                    selectionActive={selected.size > 0}
                    onToggleSelect={() => toggleSelect(card.id)}
                  />
                ))}
                {col.cards.length === 0 ? (
                  <p className="text-muted-foreground p-2 text-center text-xs">
                    Sem cards
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}

        {/* "+" ao lado das colunas: adiciona fase (tarefas/Personalizar). */}
        {onAddColumn && !readOnly ? (
          <AddColumnGhost
            onAdd={onAddColumn}
            atLimit={columns.length >= KANBAN_MAX_COLUMNS}
          />
        ) : null}
      </div>

      {/* Barra flutuante das ações em massa (seleção ativa). */}
      {!readOnly && selected.size > 0 ? (
        <BulkActionBar
          count={selected.size}
          mode={settings.mode}
          canMove={canMove}
          canDelete={
            isTasksMode || recordCtx.userRoles.includes("admin")
          }
          columns={columns}
          responsibles={recordCtx.responsibles}
          onMoveTo={(toKey) => {
            enqueueMove(selectedItems(), toKey);
            setSelected(new Set());
          }}
          onCreateTask={bulkCreateTask}
          onCompleteTasks={bulkCompleteTasks}
          onDelete={bulkDelete}
          onClear={() => setSelected(new Set())}
        />
      ) : null}

      {/* Detalhe do card (Feed|Dados) — instância única do quadro. */}
      <CardDetailSheet
        open={detail != null}
        onOpenChange={(v) => {
          if (!v) setDetail(null);
        }}
        target={detail?.target ?? null}
        recordCtx={recordCtx}
        taskCtx={effTaskCtx}
        initialTab={detail?.tab ?? "feed"}
        focusComposer={detail?.focusComposer ?? false}
        dueSoonDays={settings.tasks?.dueSoonDays}
      />
    </div>
  );
}
