// Versão: 2.0 | Data: 28/07/2026
// Calendário da AGENDA (client): visão mês (grade de semanas) ou semana (7
// colunas), com chips de REGISTROS (alocados pelo campo de data), TAREFAS
// (vencimento + hora, checkbox de concluir) e ANOTAÇÕES do dia (post-its).
// v2.0 (28/07/2026) — redesign:
//  * célula com ALTURA FIXA por densidade (gridTemplateRows) — dia cheio rola
//    na própria célula ([scrollbar-gutter:stable]), a semana não estica;
//  * cabeçalho fixo da célula (+ de criação rápida à esquerda, nº do dia à
//    direita) — não rola com os itens; faixa Seg–Dom sticky no scroller;
//  * itens em ordem CRONOLÓGICA unificada (sortDayItems — com hora primeiro);
//  * clique no corpo do chip (tarefa/registro) abre UMA instância içada de
//    CardDetailSheet (Feed default — comentários a um gesto; aba Dados edita);
//  * "+" do dia: nova tarefa pré-datada (Sheet com TaskForm) ou anotação
//    inline (post-it); clique na anotação abre o NotePostIt;
//  * drag & drop nativo de tarefas/anotações entre dias (mime próprio
//    application/x-agenda-item; otimista via pendingMoves + revert na falha;
//    registros NÃO arrastam — a data vem do campo do registro);
//  * aparência configurável (settings.agenda.appearance — cores de célula/
//    cabeçalho/chips, densidade; cores de STATUS de tarefa e a cor da anotação
//    vencem a estética).
"use client";

import {
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { todayBrasiliaIso } from "@/lib/date/today";
import {
  addDays,
  addMonths,
  monthGrid,
  monthLabel,
  monthOf,
  weekOf,
  WEEKDAY_SHORT_PT,
} from "@/lib/agenda/month-grid";
import { groupItemsByDay } from "@/lib/agenda/day-items";
import {
  NOTE_COLORS,
  type AgendaAppearance,
  type AgendaData,
  type AgendaItem,
  type AgendaNoteRow,
  type NoteColor,
} from "@/lib/agenda/types";
import { classifyDue, DUE_STATUS_LABELS } from "@/lib/tasks/alerts";
import {
  completeTask,
  reopenTask,
  rescheduleTask,
} from "@/lib/tasks/actions";
import { createAgendaNote, moveAgendaNote } from "@/lib/agenda/notes-actions";
import { emitDataChanged } from "@/lib/tasks/events";
import {
  CardDetailSheet,
  type CardDetailTarget,
} from "@/components/feed/card-detail-sheet";
import {
  TaskForm,
  type TaskFormContext,
} from "@/components/tarefas/task-sheet";
import type { KanbanRecordContext } from "@/components/kanban/kanban-board";
import {
  NOTE_CHIP_CLASSES,
  NotePostIt,
  noteColorOf,
} from "./note-post-it";

export type AgendaViewMode = "month" | "week";

// Mime próprio do DnD da agenda: não colide com o payload text/plain do
// kanban nem com o application/x-kanban-column das colunas.
export const AGENDA_DND_TYPE = "application/x-agenda-item";

export interface AgendaDragPayload {
  kind: "task" | "note";
  id: string;
  fromDate: string; // YYYY-MM-DD
}

// Altura da célula por densidade (px) — preset seguro, não px livre (a grade
// de 6 semanas precisa de linhas uniformes).
const DENSITY_HEIGHTS = {
  compact: { compacta: 72, normal: 92, espacosa: 120 },
  full: { compacta: 96, normal: 128, espacosa: 168 },
} as const;

function chipTimeLabel(item: AgendaItem): string {
  const task = item.task;
  if (task?.due_time) {
    const start = task.due_time.slice(0, 5);
    const end = task.due_time_end ? `–${task.due_time_end.slice(0, 5)}` : "";
    return `${start}${end} `;
  }
  return item.time ? `${item.time} ` : "";
}

function TaskChip({
  item,
  readOnly,
  onChanged,
  onOpenDetail,
  onDragStartItem,
  baseStyle,
  colorStyle,
}: {
  item: AgendaItem;
  readOnly?: boolean;
  onChanged: () => void;
  onOpenDetail: (target: CardDetailTarget) => void;
  onDragStartItem: (e: DragEvent, payload: AgendaDragPayload) => void;
  // Fonte/raio (sempre) e cores estéticas (só sem cor de STATUS).
  baseStyle: CSSProperties;
  colorStyle: CSSProperties;
}) {
  const router = useRouter();
  const task = item.task!;
  const done = Boolean(task.completed_at);
  const status = classifyDue(task);
  return (
    <div
      draggable={!readOnly}
      onDragStart={(e) =>
        onDragStartItem(e, { kind: "task", id: task.id, fromDate: item.date })
      }
      onClick={() => {
        if (!readOnly) onOpenDetail({ task });
      }}
      role={readOnly ? undefined : "button"}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded border px-1.5 py-1 text-[11px] leading-tight",
        !readOnly && "cursor-pointer",
        status === "atrasada" && "border-destructive/50 bg-destructive/10",
        status === "em_breve" && "border-amber-500/50 bg-amber-500/10",
        !status && "bg-muted/60"
      )}
      style={status ? baseStyle : { ...baseStyle, ...colorStyle }}
      title={
        `${task.title}${task.due_time ? ` · ${chipTimeLabel(item).trim()}` : ""}` +
        (status ? ` · ${DUE_STATUS_LABELS[status]}` : "") +
        (task.responsible_label ? ` · ${task.responsible_label}` : "")
      }
    >
      <span
        onClick={(e) => e.stopPropagation()}
        className="flex shrink-0 items-center"
      >
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
              onChanged();
              router.refresh();
            }
          }}
          className="accent-primary size-3 shrink-0"
          aria-label={done ? "Reabrir tarefa" : "Concluir tarefa"}
        />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          done && "text-muted-foreground line-through"
        )}
      >
        <span className="font-medium tabular-nums">{chipTimeLabel(item)}</span>
        {item.title}
      </span>
    </div>
  );
}

function RecordChip({
  item,
  readOnly,
  onOpenDetail,
  baseStyle,
  colorStyle,
}: {
  item: AgendaItem;
  readOnly?: boolean;
  onOpenDetail: (target: CardDetailTarget) => void;
  baseStyle: CSSProperties;
  colorStyle: CSSProperties;
}) {
  return (
    <div
      draggable={false}
      onClick={() => {
        if (!readOnly && item.record) onOpenDetail({ record: item.record });
      }}
      role={readOnly ? undefined : "button"}
      className={cn(
        "bg-primary/10 border-primary/40 flex shrink-0 items-center gap-1 rounded border border-l-2 px-1.5 py-1 text-[11px] leading-tight",
        !readOnly && "cursor-pointer"
      )}
      style={{ ...baseStyle, ...colorStyle }}
      title={`${item.title} · A data vem do campo do registro — edite o registro para mudar.`}
    >
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium tabular-nums">{chipTimeLabel(item)}</span>
        {item.title}
      </span>
    </div>
  );
}

function NoteChip({
  item,
  readOnly,
  onOpenNote,
  onDragStartItem,
  baseStyle,
  colorStyle,
}: {
  item: AgendaItem;
  readOnly?: boolean;
  onOpenNote: (note: AgendaNoteRow, rect: DOMRect) => void;
  onDragStartItem: (e: DragEvent, payload: AgendaDragPayload) => void;
  baseStyle: CSSProperties;
  colorStyle: CSSProperties;
}) {
  const note = item.note!;
  return (
    <div
      draggable={!readOnly}
      onDragStart={(e) =>
        onDragStartItem(e, { kind: "note", id: note.id, fromDate: item.date })
      }
      onClick={(e) =>
        onOpenNote(note, e.currentTarget.getBoundingClientRect())
      }
      role="button"
      className={cn(
        // Mini canto dobrado: hint do post-it.
        "relative flex shrink-0 cursor-pointer items-center rounded-sm border px-1.5 py-1 text-[11px] leading-tight",
        "after:absolute after:right-0 after:bottom-0 after:border-b-[7px] after:border-l-[7px] after:border-b-black/15 after:border-l-transparent after:content-['']",
        NOTE_CHIP_CLASSES[noteColorOf(note)]
      )}
      style={{ ...baseStyle, ...colorStyle }}
      title={note.body}
    >
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
    </div>
  );
}

/** "+" do dia: popover com "Nova tarefa" (pré-datada) e anotação inline. */
function QuickAdd({
  day,
  showNotes,
  onNewTask,
  onChanged,
}: {
  day: string;
  showNotes: boolean;
  onNewTask: (day: string) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [color, setColor] = useState<NoteColor>("amarelo");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveNote() {
    setPending(true);
    setError(null);
    const res = await createAgendaNote(day, body, color);
    setPending(false);
    if (!res.ok) {
      setError(res.message ?? "Falha ao salvar.");
      return;
    }
    emitDataChanged({ kind: "agenda_note" });
    onChanged();
    setBody("");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Adicionar em ${day.slice(8, 10)}/${day.slice(5, 7)}`}
          className={cn(
            "text-muted-foreground hover:text-foreground hover:bg-muted flex size-4 shrink-0 items-center justify-center rounded transition-opacity",
            "pointer-coarse:opacity-100 opacity-0 group-hover/day:opacity-100 focus-visible:opacity-100",
            open && "opacity-100"
          )}
        >
          <Plus className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 justify-start px-2 text-xs"
            onClick={() => {
              setOpen(false);
              onNewTask(day);
            }}
          >
            <Plus className="size-3.5" /> Nova tarefa
          </Button>
          {showNotes ? (
            <div className="flex flex-col gap-1.5 border-t pt-2">
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={2}
                placeholder="Anotação do dia…"
                aria-label="Anotação do dia"
                className="min-h-0 text-xs"
              />
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  {NOTE_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Cor ${c}`}
                      onClick={() => setColor(c)}
                      className={cn(
                        "size-3.5 rounded-full border border-black/20",
                        {
                          amarelo: "bg-yellow-300",
                          rosa: "bg-pink-300",
                          verde: "bg-green-300",
                          azul: "bg-sky-300",
                          laranja: "bg-orange-300",
                          roxo: "bg-purple-300",
                        }[c],
                        c === color && "ring-primary ring-2"
                      )}
                    />
                  ))}
                </div>
                <Button
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={pending || !body.trim()}
                  onClick={() => void saveNote()}
                >
                  Salvar
                </Button>
              </div>
              {error ? (
                <p className="text-destructive text-xs" role="status">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AgendaView({
  anchor,
  view,
  data,
  recordCtx,
  taskCtx,
  onNavigate,
  onViewChange,
  onChanged,
  readOnly,
  compact,
  appearance,
  showNotes = true,
}: {
  // Âncora da navegação (qualquer dia do mês/semana em exibição).
  anchor: string;
  view: AgendaViewMode;
  data: AgendaData | null; // null = carregando
  recordCtx: KanbanRecordContext;
  taskCtx: TaskFormContext;
  onNavigate: (anchor: string) => void;
  onViewChange: (view: AgendaViewMode) => void;
  // Mutação concluída — o chamador refaz a busca.
  onChanged: () => void;
  readOnly?: boolean;
  compact?: boolean;
  appearance?: AgendaAppearance;
  showNotes?: boolean;
}) {
  const ap = appearance ?? {};
  const today = todayBrasiliaIso();
  const weeks = useMemo(
    () => (view === "month" ? monthGrid(anchor) : [weekOf(anchor)]),
    [anchor, view]
  );

  // Painéis içados (uma instância por calendário, não por chip).
  const [detail, setDetail] = useState<CardDetailTarget | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [newTaskDay, setNewTaskDay] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<{
    note: AgendaNoteRow;
    rect: DOMRect;
  } | null>(null);

  // DnD otimista: `${kind}:${id}` → dia destino. O overlay realoca o item na
  // grade SÓ enquanto os dados ainda não refletirem o movimento (item.date ≠
  // destino) — um reload disparado ANTES do move aterrissar não reverte o
  // chip, e o reload que o refletir torna a entrada inerte (nada de setState
  // em efeito). Entradas satisfeitas são podadas no próximo drop; a falha
  // remove a própria entrada (revert visual).
  const [pendingMoves, setPendingMoves] = useState<
    Map<string, { toDate: string }>
  >(new Map());
  const [dropDay, setDropDay] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const items = (data?.items ?? []).map((item) => {
      const pending = pendingMoves.get(`${item.kind}:${item.id}`);
      return pending && item.date !== pending.toDate
        ? { ...item, date: pending.toDate }
        : item;
    });
    return groupItemsByDay(items);
  }, [data, pendingMoves]);

  function navigate(delta: number) {
    onNavigate(
      view === "month" ? addMonths(anchor, delta) : addDays(anchor, delta * 7)
    );
  }

  function onDragStartItem(e: DragEvent, payload: AgendaDragPayload) {
    e.dataTransfer.setData(AGENDA_DND_TYPE, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDrop(day: string, e: DragEvent) {
    setDropDay(null);
    const raw = e.dataTransfer.getData(AGENDA_DND_TYPE);
    if (!raw) return;
    e.preventDefault();
    let payload: AgendaDragPayload;
    try {
      payload = JSON.parse(raw) as AgendaDragPayload;
    } catch {
      return;
    }
    if (
      !payload?.id ||
      (payload.kind !== "task" && payload.kind !== "note") ||
      payload.fromDate === day
    ) {
      return;
    }
    const key = `${payload.kind}:${payload.id}`;
    setMoveError(null);
    setPendingMoves((prev) => {
      const next = new Map(prev);
      // Poda entradas já refletidas pelos dados (overlay inerte) — o mapa não
      // cresce sem limite ao longo da sessão.
      for (const [k, { toDate }] of prev) {
        const sep = k.indexOf(":");
        const kind = k.slice(0, sep);
        const id = k.slice(sep + 1);
        const found = data?.items.find((i) => i.kind === kind && i.id === id);
        if (!found || found.date === toDate) next.delete(k);
      }
      return next.set(key, { toDate: day });
    });
    const action =
      payload.kind === "task"
        ? rescheduleTask(payload.id, day)
        : moveAgendaNote(payload.id, day);
    void action.then((res) => {
      if (res.ok) {
        emitDataChanged({
          kind: payload.kind === "task" ? "task" : "agenda_note",
        });
        onChanged();
      } else {
        // Revert visual: o chip volta ao dia de origem.
        setPendingMoves((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
        setMoveError(res.message ?? "Falha ao mover.");
      }
    });
  }

  const label =
    view === "month"
      ? monthLabel(anchor)
      : `Semana de ${weekOf(anchor)[0].split("-").reverse().join("/")}`;

  // ---- aparência ----
  const density = ap.density ?? "normal";
  const cellH = (compact ? DENSITY_HEIGHTS.compact : DENSITY_HEIGHTS.full)[
    density
  ];
  const gridStyle: CSSProperties = {
    gridTemplateRows:
      view === "week"
        ? `auto minmax(${Math.round(cellH * 1.6)}px, 1fr)`
        : `auto repeat(${weeks.length}, ${cellH}px)`,
    backgroundColor: ap.cell?.border,
    borderColor: ap.cell?.border,
    borderRadius: ap.cell?.radius,
  };
  const headerStyle: CSSProperties = {
    backgroundColor: ap.header?.bg,
    color: ap.header?.color,
  };
  const chipBase: CSSProperties = {
    fontSize: ap.chip?.fontSize,
    borderRadius: ap.chip?.radius,
  };
  const chipColor = (kind: "task" | "record" | "note"): CSSProperties => {
    const c = ap.chip?.[kind];
    return {
      backgroundColor: c?.bg,
      color: c?.text,
      borderColor: c?.border,
    };
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => navigate(-1)}
            aria-label="Anterior"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => navigate(1)}
            aria-label="Próximo"
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() =>
              onNavigate(view === "month" ? monthOf(today) + "-01" : today)
            }
          >
            Hoje
          </Button>
          <span className="ml-1 text-sm font-medium">{label}</span>
        </div>
        <div className="flex rounded-md border p-0.5">
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-6 px-2 text-xs", view === "month" && "bg-muted")}
            onClick={() => onViewChange("month")}
            aria-pressed={view === "month"}
          >
            Mês
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-6 px-2 text-xs", view === "week" && "bg-muted")}
            onClick={() => onViewChange("week")}
            aria-pressed={view === "week"}
          >
            Semana
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
        <div
          className={cn(
            "bg-border grid grid-cols-7 gap-px rounded-lg border",
            view === "week" && "min-h-full"
          )}
          style={gridStyle}
        >
          {WEEKDAY_SHORT_PT.map((d) => (
            <div
              key={d}
              className="bg-muted sticky top-0 z-10 px-1.5 py-1 text-center text-xs font-medium"
              style={headerStyle}
            >
              {d}
            </div>
          ))}
          {weeks.flat().map((day, i) => {
            const items = byDay.get(day) ?? [];
            const inMonth =
              view === "week" || monthOf(day) === monthOf(anchor);
            const isToday = day === today;
            const weekend = i % 7 >= 5;
            const dim = !inMonth && ap.dimOutsideMonth !== false;
            const cellStyle: CSSProperties = {
              backgroundColor:
                isToday && ap.todayBg
                  ? ap.todayBg
                  : weekend && ap.weekendBg
                    ? ap.weekendBg
                    : ap.cell?.bg,
            };
            return (
              <div
                key={day}
                data-day={day}
                className={cn(
                  "group/day bg-background flex min-h-0 flex-col",
                  isToday && "ring-primary/40 ring-1 ring-inset",
                  dim && "opacity-50",
                  dropDay === day && "ring-primary/60 ring-2 ring-inset"
                )}
                style={cellStyle}
                onDragOver={(e) => {
                  if (readOnly) return;
                  if (!e.dataTransfer.types.includes(AGENDA_DND_TYPE)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dropDay !== day) setDropDay(day);
                }}
                onDragLeave={(e) => {
                  if (
                    e.relatedTarget instanceof Node &&
                    e.currentTarget.contains(e.relatedTarget)
                  ) {
                    return;
                  }
                  setDropDay((d) => (d === day ? null : d));
                }}
                onDrop={(e) => {
                  if (!readOnly) handleDrop(day, e);
                }}
              >
                {/* Cabeçalho FIXO da célula: não rola com os itens. */}
                <div className="flex shrink-0 items-center justify-between px-1 pt-0.5">
                  {!readOnly ? (
                    <QuickAdd
                      day={day}
                      showNotes={showNotes}
                      onNewTask={setNewTaskDay}
                      onChanged={onChanged}
                    />
                  ) : (
                    <span />
                  )}
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-xs",
                      isToday
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "text-muted-foreground"
                    )}
                  >
                    {Number(day.slice(8, 10))}
                  </span>
                </div>
                {/* Área de itens ROLÁVEL da célula. */}
                <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto [scrollbar-gutter:stable] px-1 pt-0.5 pb-1">
                  {items.map((item) =>
                    item.kind === "task" ? (
                      <TaskChip
                        key={`t-${item.id}`}
                        item={item}
                        readOnly={readOnly}
                        onChanged={onChanged}
                        onOpenDetail={(target) => {
                          setDetail(target);
                          setDetailOpen(true);
                        }}
                        onDragStartItem={onDragStartItem}
                        baseStyle={chipBase}
                        colorStyle={chipColor("task")}
                      />
                    ) : item.kind === "note" ? (
                      <NoteChip
                        key={`n-${item.id}`}
                        item={item}
                        readOnly={readOnly}
                        onOpenNote={(note, rect) =>
                          setOpenNote({ note, rect })
                        }
                        onDragStartItem={onDragStartItem}
                        baseStyle={chipBase}
                        colorStyle={chipColor("note")}
                      />
                    ) : (
                      <RecordChip
                        key={`r-${item.id}`}
                        item={item}
                        readOnly={readOnly}
                        onOpenDetail={(target) => {
                          setDetail(target);
                          setDetailOpen(true);
                        }}
                        baseStyle={chipBase}
                        colorStyle={chipColor("record")}
                      />
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {data == null ? (
          <p className="text-muted-foreground p-2 text-center text-xs">
            Carregando agenda…
          </p>
        ) : null}
      </div>

      {moveError ? (
        <div
          className="text-destructive flex items-center justify-between gap-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs"
          role="status"
        >
          <span>{moveError}</span>
          <button
            type="button"
            aria-label="Dispensar"
            onClick={() => setMoveError(null)}
            className="shrink-0 opacity-70 hover:opacity-100"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}

      {/* Painel de detalhe (Feed/Dados) — instância única içada. */}
      <CardDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        target={detail}
        recordCtx={recordCtx}
        taskCtx={taskCtx}
      />

      {/* Nova tarefa pré-datada (quick-create do "+"). */}
      <Sheet
        open={newTaskDay != null}
        onOpenChange={(v) => {
          if (!v) setNewTaskDay(null);
        }}
      >
        <SheetContent className="overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Nova tarefa</SheetTitle>
            <SheetDescription>
              {newTaskDay
                ? `Vencimento pré-preenchido: ${newTaskDay
                    .split("-")
                    .reverse()
                    .join("/")}.`
                : ""}
            </SheetDescription>
          </SheetHeader>
          {newTaskDay ? (
            <TaskForm
              defaults={{ dueDate: newTaskDay }}
              ctx={taskCtx}
              onDone={() => {
                setNewTaskDay(null);
                onChanged();
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Post-it da anotação clicada — re-sincronizado com os dados
          recarregados (edição/cor refletem no painel aberto). */}
      {openNote ? (
        <NotePostIt
          note={
            (data?.items.find(
              (i) => i.kind === "note" && i.id === openNote.note.id
            )?.note as AgendaNoteRow | undefined) ?? openNote.note
          }
          anchorRect={openNote.rect}
          onClose={() => setOpenNote(null)}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  );
}
