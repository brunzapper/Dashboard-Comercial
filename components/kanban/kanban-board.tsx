// Versão: 1.0 | Data: 16/07/2026
// Quadro Kanban (client): colunas + cards com drag & drop HTML5 nativo (D5 do
// plano — sem lib de DnD; o handle do react-grid-layout é `.widget-drag`, então
// o arraste interno não conflita com o grid do dashboard). Move otimista:
// atualiza o estado local, chama moveRecordCard e faz router.refresh(); erro
// reverte e mostra banner inline (padrão do app — não há toast). Usado pela
// página dedicada (/kanbans/[id]) e pelo widget kanban (compact).
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import type { FieldDefinition, OptionItem } from "@/lib/records/types";
import { formatMoney } from "@/lib/widgets/currency";
import { moveRecordCard } from "@/lib/kanban/actions";
import { computeDateOnMove } from "@/lib/kanban/date-move";
import { todayBrasiliaIso } from "@/lib/date/today";
import {
  KANBAN_NO_VALUE_KEY,
  KANBAN_OVERFLOW_KEY,
  type KanbanDateBucket,
  type KanbanSettings,
} from "@/lib/kanban/types";
import type {
  KanbanBoardData,
  KanbanCard,
  KanbanColumnCards,
} from "@/lib/kanban/data";
import { RecordCreateSheet } from "@/components/registros/record-create-sheet";
import { RecordEditSheet } from "@/components/registros/record-edit-sheet";

// Contexto de registros p/ os painéis de edição/criação abertos pelos cards.
export interface KanbanRecordContext {
  fields: FieldDefinition[];
  responsibles: OptionItem[];
  operations: OptionItem[];
  userRoles: string[];
  canEditValues: boolean;
  canManageFields: boolean;
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

function CardView({
  card,
  draggable,
  onDragStart,
  onDragEnd,
  recordCtx,
  compact,
}: {
  card: KanbanCard;
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  recordCtx: KanbanRecordContext;
  compact?: boolean;
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
      <div className="flex items-start justify-between gap-1 pl-1.5">
        <span className="font-medium break-words">{card.title}</span>
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {card.isMock ? (
            <Lock
              className="text-muted-foreground size-3.5"
              aria-label="Registro de demonstração (congelado)"
            />
          ) : null}
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
    </div>
  );
}

export function KanbanBoard({
  data,
  settings,
  canMove,
  recordCtx,
  quickCreateSource,
  compact,
}: {
  data: KanbanBoardData;
  settings: KanbanSettings;
  // Usuário pode mover cards (edit_record_values).
  canMove: boolean;
  recordCtx: KanbanRecordContext;
  // Fonte com criação manual habilitada → botão + nas colunas (pré-preenche o
  // valor da coluna). Null = sem quick-create.
  quickCreateSource: { key: string; label: string } | null;
  // Widget dentro do dashboard: cards sem campos extras e colunas mais justas.
  compact?: boolean;
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
    canMove && !card.isMock && col.key !== KANBAN_OVERFLOW_KEY;

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
    let payload: { cardId: string; fromKey: string; dateValue: string | null };
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

    const res = await moveRecordCard({
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

  // Pré-preenchimento do quick-create da coluna: valor do campo (modo valor)
  // ou data concreta calculada do bucket (modo data).
  const quickCreateDefaults = useMemo(() => {
    return (colKey: string): Record<string, string> | null => {
      if (colKey === KANBAN_OVERFLOW_KEY) return null;
      if (settings.dateBucket && settings.dateField) {
        if (colKey === KANBAN_NO_VALUE_KEY) return {};
        const iso = computeDateOnMove(
          null,
          settings.dateBucket as KanbanDateBucket,
          colKey,
          todayBrasiliaIso()
        );
        if (!iso) return {};
        const key = settings.dateField.startsWith("custom:")
          ? `custom__${settings.dateField.slice("custom:".length)}`
          : `core__${settings.dateField}`;
        return { [key]: iso.slice(0, 10) };
      }
      const field = settings.groupField ?? "stage";
      if (colKey === KANBAN_NO_VALUE_KEY) return {};
      const key = field.startsWith("custom:")
        ? `custom__${field.slice("custom:".length)}`
        : `core__${field}`;
      return { [key]: colKey };
    };
  }, [settings]);

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
                  col.color ? { borderTopColor: col.color, borderTopWidth: 3 } : undefined
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
                  {quickCreateSource && quickCreateDefaults(col.key) ? (
                    <RecordCreateSheet
                      source={quickCreateSource}
                      fields={recordCtx.fields}
                      responsibles={recordCtx.responsibles}
                      operations={recordCtx.operations}
                      userRoles={recordCtx.userRoles}
                      defaultValues={quickCreateDefaults(col.key) ?? {}}
                      triggerLabel={`Novo registro em ${col.label}`}
                      iconTrigger
                    />
                  ) : null}
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
                        })
                      );
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setDropTarget(null);
                    }}
                    recordCtx={recordCtx}
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
