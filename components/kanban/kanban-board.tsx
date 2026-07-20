// Versão: 1.3 | Data: 20/07/2026
// v1.3 (20/07/2026): refresh concorrente durante um move otimista não desfaz
//   mais o move na tela (adoção de props adiada enquanto há move em voo).
// Quadro Kanban (client): colunas + cards com drag & drop HTML5 nativo (D5 do
// plano — sem lib de DnD; o handle do react-grid-layout é `.widget-drag`, então
// o arraste interno não conflita com o grid do dashboard). Move otimista:
// atualiza o estado local, chama a action de move e faz router.refresh(); erro
// reverte e mostra banner inline (padrão do app — não há toast). Usado pela
// página dedicada (/kanbans/[id]), pelo widget kanban (compact) e pelos
// quadros de TAREFAS (v1.1: cards de tarefa com prazo/concluir, `onMove`
// injetável e `columnExtra` p/ o quick-create de cada modo).
// v1.2 (17/07/2026): FEED nos cards — clique no corpo abre o CardDetailSheet
//   (abas Feed|Dados; instância única içada aqui) e o rodapé ganha os chips
//   "+tarefa"/"+comentário"; o lápis de hover passou a abrir a aba Dados do
//   mesmo painel. Sucessos emitem emitDataChanged (event bus W1).
// v1.3 (17/07/2026): reordenação de COLUNAS por arrasto do cabeçalho (payload
//   próprio application/x-kanban-column; persiste via onReorderColumns →
//   settings.columns, ordem autoritativa p/ todas as fontes), coluna fantasma
//   "+" (onAddColumn — modos tarefas/Personalizar) e `owner` p/ o move das
//   colunas "Personalizar" (kanban_placements).
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Lock, Pencil, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { FieldDefinition, OptionItem } from "@/lib/records/types";
import { formatMoney } from "@/lib/widgets/currency";
import { DEFAULT_DATE_FORMAT, formatDateValue } from "@/lib/widgets/format";
import { moveRecordCard } from "@/lib/kanban/actions";
import { completeTask, reopenTask } from "@/lib/tasks/actions";
import { emitDataChanged } from "@/lib/tasks/events";
import { classifyDue, DUE_STATUS_LABELS } from "@/lib/tasks/alerts";
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
  KanbanColumnCards,
  KanbanOwner,
} from "@/lib/kanban/data";
import {
  CardDetailSheet,
  type CardDetailTab,
  type CardDetailTarget,
} from "@/components/feed/card-detail-sheet";
import {
  TaskSheet,
  type TaskFormContext,
} from "@/components/tarefas/task-sheet";

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

function formatMetric(value: number | null, isMoney: boolean): string {
  if (value == null) return "—";
  if (isMoney) return formatMoney(value, null);
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(
    value
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
              status === "em_breve" && "bg-amber-500/15 text-amber-700 font-medium"
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
  compact,
  readOnly,
  dueSoonDays,
  onOpenDetail,
  cardAp,
}: {
  card: KanbanCard;
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  taskCtx?: TaskFormContext;
  compact?: boolean;
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
}) {
  // Detalhe só para cards com entidade carregada (registro ou tarefa).
  const canOpen = !readOnly && Boolean(card.record ?? card.task);
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
      onClick={() => {
        // Clique no corpo abre o feed; seleção de texto não conta como clique.
        if (window.getSelection()?.toString()) return;
        open("feed");
      }}
      className={cn(
        "bg-card group relative rounded-md border p-2 text-sm shadow-sm",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-default",
        canOpen && !draggable && "cursor-pointer"
      )}
      style={{
        background: cardAp?.bg,
        color: cardAp?.text,
        borderColor: cardAp?.border,
        borderRadius: cardAp?.radius,
        fontSize: cardAp?.fontSize,
      }}
    >
      {card.colorValue && cardAp?.showStripe !== false ? (
        <span
          aria-hidden
          className="absolute inset-y-1 left-0 w-1 rounded-full"
          style={{ background: colorFromValue(card.colorValue) }}
        />
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
          {!compact && card.fields.length > 0 ? (
            <dl className="text-muted-foreground mt-1 flex flex-col gap-0.5 pl-1.5 text-xs">
              {card.fields.map((f) => (
                <div key={f.label} className="flex justify-between gap-2">
                  <dt className="truncate">{f.label}</dt>
                  <dd className="shrink-0">{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {card.openTasks > 0 ? (
            <span className="bg-primary/10 text-primary mt-1 ml-1.5 inline-block rounded px-1.5 py-0.5 text-[11px]">
              {card.openTasks} tarefa(s)
            </span>
          ) : null}
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
  // Widget dentro do dashboard: cards sem campos extras e colunas mais justas.
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
  const router = useRouter();
  const [columns, setColumns] = useState<KanbanColumnCards[]>(data.columns);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Drag de COLUNA (cabeçalho): coluna arrastada + alvo do indicador.
  const [colDragging, setColDragging] = useState<string | null>(null);
  const [colDropKey, setColDropKey] = useState<string | null>(null);
  // Snapshot pré-move p/ reverter em falha.
  const beforeMove = useRef<KanbanColumnCards[] | null>(null);
  // Painel de detalhe (Feed|Dados) — UMA instância para o quadro inteiro.
  const [detail, setDetail] = useState<{
    target: CardDetailTarget;
    tab: CardDetailTab;
    focusComposer: boolean;
  } | null>(null);

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

  // Re-sincroniza com o servidor após router.refresh() (novas props).
  // v20/07/2026: com um move OTIMISTA em voo (pendingMoves > 0), um refresh
  // concorrente (realtime/outro usuário) trazia colunas antigas e desfazia o
  // move na tela — adia a adoção; o refresh pós-move re-sincroniza.
  const pendingMoves = useRef(0);
  const deferredData = useRef<KanbanBoardData | null>(null);
  useEffect(() => {
    if (pendingMoves.current > 0) {
      deferredData.current = data;
      return;
    }
    deferredData.current = null;
     
    setColumns(data.columns);
  }, [data]);

  const movable = (card: KanbanCard, col: KanbanColumnCards) =>
    !readOnly && canMove && !card.isMock && col.key !== KANBAN_OVERFLOW_KEY;

  function applyLocalMove(cardId: string, fromKey: string, toKey: string) {
    setColumns((cols) => {
      const card = cols
        .find((c) => c.key === fromKey)
        ?.cards.find((c) => c.id === cardId);
      if (!card) return cols;
      return cols.map((c) => {
        if (c.key === fromKey) {
          const cards = c.cards.filter((x) => x.id !== cardId);
          return { ...c, cards, count: cards.length };
        }
        if (c.key === toKey) {
          const cards = [{ ...card, columnKey: toKey }, ...c.cards];
          return { ...c, cards, count: cards.length };
        }
        return c;
      });
    });
  }

  async function handleDrop(toKey: string, e: React.DragEvent) {
    e.preventDefault();
    setDropTarget(null);
    setDragging(null);
    let payload: KanbanDragPayload;
    try {
      payload = JSON.parse(e.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    if (!payload?.cardId || payload.fromKey === toKey) return;
    const target = columns.find((c) => c.key === toKey);
    if (!target || target.noDrop) return;
    // Personalizar sem dono conhecido: não arrisca gravar campo do registro.
    if (settings.columnSource === "custom" && !owner && !onMove) {
      setError("Quadro personalizado sem contexto — recarregue a página.");
      return;
    }

    beforeMove.current = columns;
    setError(null);
    applyLocalMove(payload.cardId, payload.fromKey, toKey);

    pendingMoves.current += 1;
    let res: { ok?: boolean; message?: string };
    try {
      res = onMove
        ? await onMove(payload, toKey, target)
        : await moveRecordCard({
            recordId: payload.cardId,
            groupField: settings.groupField,
            dateField: settings.dateField,
            dateBucket: settings.dateBucket,
            currentDateValue: payload.dateValue,
            targetKey: toKey,
            writeBack: settings.writeBack,
            // Colunas "Personalizar": posiciona na visão (não edita o registro).
            ...(settings.columnSource === "custom" && owner
              ? { custom: { ownerKind: owner.kind, ownerId: owner.id } }
              : {}),
          });
    } finally {
      pendingMoves.current -= 1;
    }
    if (!res.ok) {
      if (beforeMove.current) setColumns(beforeMove.current);
      setError(res.message ?? "Falha ao mover o card.");
      return;
    }
    // Dados adiados durante o move (refresh concorrente) já estão velhos em
    // relação ao move persistido — descarta; o refresh abaixo re-sincroniza.
    deferredData.current = null;
    emitDataChanged(
      settings.mode === "tarefas"
        ? { kind: "task", taskId: payload.cardId }
        : { kind: "record", recordId: payload.cardId }
    );
    router.refresh();
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
                "bg-muted/40 flex max-h-full w-64 shrink-0 flex-col rounded-lg border",
                compact && "w-56",
                dropTarget === col.key && dragging && "ring-primary/60 ring-2",
                colDropKey === col.key &&
                  colDragging &&
                  "ring-primary/60 ring-2 ring-dashed"
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
                      {col.metricSumText ?? formatMetric(col.metricSum, data.metricIsMoney)}
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
                    compact={compact}
                    draggable={movable(card, col)}
                    onDragStart={(e) => {
                      setDragging(card.id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData(
                        "text/plain",
                        JSON.stringify({
                          cardId: card.id,
                          fromKey: col.key,
                          dateValue: card.dateValue,
                        } satisfies KanbanDragPayload)
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
