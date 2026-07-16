// Versão: 1.1 | Data: 16/07/2026
// Quadro Kanban (client): colunas + cards com drag & drop HTML5 nativo (D5 do
// plano — sem lib de DnD; o handle do react-grid-layout é `.widget-drag`, então
// o arraste interno não conflita com o grid do dashboard). Move otimista:
// atualiza o estado local, chama a action de move e faz router.refresh(); erro
// reverte e mostra banner inline (padrão do app — não há toast). Usado pela
// página dedicada (/kanbans/[id]), pelo widget kanban (compact) e pelos
// quadros de TAREFAS (v1.1: cards de tarefa com prazo/concluir, `onMove`
// injetável e `columnExtra` p/ o quick-create de cada modo).
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import type { FieldDefinition, OptionItem } from "@/lib/records/types";
import { formatMoney } from "@/lib/widgets/currency";
import { DEFAULT_DATE_FORMAT, formatDateValue } from "@/lib/widgets/format";
import { moveRecordCard } from "@/lib/kanban/actions";
import { completeTask, reopenTask } from "@/lib/tasks/actions";
import { classifyDue, DUE_STATUS_LABELS } from "@/lib/tasks/alerts";
import { KANBAN_OVERFLOW_KEY, type KanbanSettings } from "@/lib/kanban/types";
import type {
  KanbanBoardData,
  KanbanCard,
  KanbanColumnCards,
} from "@/lib/kanban/data";
import { RecordEditSheet } from "@/components/registros/record-edit-sheet";
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

// Corpo do card de TAREFA: prazo com destaque, responsável, vínculo, concluir.
function TaskCardBody({
  card,
  taskCtx,
  readOnly,
}: {
  card: KanbanCard;
  taskCtx: TaskFormContext;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const task = card.task!;
  const done = Boolean(task.completed_at);
  const status = classifyDue(task);

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
            if (res.ok) router.refresh();
          }}
          onPointerDown={(e) => e.stopPropagation()}
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
          {!readOnly ? <TaskSheet task={task} ctx={taskCtx} editTrigger /> : null}
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
  recordCtx,
  taskCtx,
  compact,
  readOnly,
}: {
  card: KanbanCard;
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  recordCtx: KanbanRecordContext;
  taskCtx?: TaskFormContext;
  compact?: boolean;
  readOnly?: boolean;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        e.stopPropagation();
        onDragStart(e);
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "bg-card group relative rounded-md border p-2 text-sm shadow-sm",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-default"
      )}
    >
      {card.colorValue ? (
        <span
          aria-hidden
          className="absolute inset-y-1 left-0 w-1 rounded-full"
          style={{ background: colorFromValue(card.colorValue) }}
        />
      ) : null}
      {card.task && taskCtx ? (
        <TaskCardBody card={card} taskCtx={taskCtx} readOnly={readOnly} />
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
                <RecordEditSheet
                  record={card.record}
                  fields={recordCtx.fields}
                  responsibles={recordCtx.responsibles}
                  operations={recordCtx.operations}
                  relatedLeadLabel={null}
                  userRoles={recordCtx.userRoles}
                  canEditValues={recordCtx.canEditValues}
                  canManageFields={recordCtx.canManageFields}
                />
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
}) {
  const router = useRouter();
  const [columns, setColumns] = useState<KanbanColumnCards[]>(data.columns);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Snapshot pré-move p/ reverter em falha.
  const beforeMove = useRef<KanbanColumnCards[] | null>(null);

  // Re-sincroniza com o servidor após router.refresh() (novas props).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

    beforeMove.current = columns;
    setError(null);
    applyLocalMove(payload.cardId, payload.fromKey, toKey);

    const res = onMove
      ? await onMove(payload, toKey, target)
      : await moveRecordCard({
          recordId: payload.cardId,
          groupField: settings.groupField,
          dateField: settings.dateField,
          dateBucket: settings.dateBucket,
          currentDateValue: payload.dateValue,
          targetKey: toKey,
        });
    if (!res.ok) {
      if (beforeMove.current) setColumns(beforeMove.current);
      setError(res.message ?? "Falha ao mover o card.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {error ? (
        <p className="text-destructive text-sm" role="status">
          {error}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
        {columns.map((col) => {
          const overWip =
            col.wipLimit != null && col.wipLimit > 0 && col.count > col.wipLimit;
          return (
            <div
              key={col.key}
              onDragOver={(e) => {
                if (col.noDrop) return;
                e.preventDefault();
                setDropTarget(col.key);
              }}
              onDragLeave={() => setDropTarget((t) => (t === col.key ? null : t))}
              onDrop={(e) => handleDrop(col.key, e)}
              className={cn(
                "bg-muted/40 flex max-h-full w-64 shrink-0 flex-col rounded-lg border",
                compact && "w-56",
                dropTarget === col.key && dragging && "ring-primary/60 ring-2"
              )}
            >
              <div
                className="flex items-center justify-between gap-2 rounded-t-lg border-b px-2 py-1.5"
                style={
                  col.color
                    ? { borderTopColor: col.color, borderTopWidth: 3 }
                    : undefined
                }
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{col.label}</span>
                  <span
                    className={cn(
                      "text-muted-foreground rounded-full border px-1.5 text-xs",
                      overWip && "border-destructive text-destructive font-semibold"
                    )}
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
                    >
                      {formatMetric(col.metricSum, data.metricIsMoney)}
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
                    recordCtx={recordCtx}
                    taskCtx={taskCtx}
                    readOnly={readOnly}
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
      </div>
    </div>
  );
}
