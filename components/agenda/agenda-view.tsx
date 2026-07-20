// Versão: 1.1 | Data: 20/07/2026
// v1.1 (20/07/2026): gatilhos de editar visíveis no foco e em telas touch
//   (pointer-coarse) — antes eram hover-only, inacessíveis sem mouse.
// Calendário da AGENDA (client): visão mês (grade de semanas) ou semana (7
// colunas), com chips de REGISTROS (alocados pelo campo de data) e TAREFAS
// (vencimento, com destaque atrasada/em breve e checkbox de concluir).
// Navegação prev/hoje/próx refaz a busca no chamador (onNavigate). Painéis de
// edição reusam RecordEditSheet/TaskSheet.
"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import type { AgendaData, AgendaItem } from "@/lib/agenda/types";
import { classifyDue, DUE_STATUS_LABELS } from "@/lib/tasks/alerts";
import { completeTask, reopenTask } from "@/lib/tasks/actions";
import { RecordEditSheet } from "@/components/registros/record-edit-sheet";
import {
  TaskSheet,
  type TaskFormContext,
} from "@/components/tarefas/task-sheet";
import type { KanbanRecordContext } from "@/components/kanban/kanban-board";

export type AgendaViewMode = "month" | "week";

function TaskChip({
  item,
  taskCtx,
  readOnly,
  onChanged,
}: {
  item: AgendaItem;
  taskCtx: TaskFormContext;
  readOnly?: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const task = item.task!;
  const done = Boolean(task.completed_at);
  const status = classifyDue(task);
  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded border px-1 py-0.5 text-[11px]",
        status === "atrasada" && "border-destructive/50 bg-destructive/10",
        status === "em_breve" && "border-amber-500/50 bg-amber-500/10",
        !status && "bg-muted/60"
      )}
      title={
        `${task.title}${task.due_time ? ` · ${task.due_time.slice(0, 5)}` : ""}` +
        (status ? ` · ${DUE_STATUS_LABELS[status]}` : "") +
        (task.responsible_label ? ` · ${task.responsible_label}` : "")
      }
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
        className="size-3 shrink-0 accent-primary"
        aria-label={done ? "Reabrir tarefa" : "Concluir tarefa"}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          done && "text-muted-foreground line-through"
        )}
      >
        {task.due_time ? `${task.due_time.slice(0, 5)} ` : ""}
        {item.title}
      </span>
      {!readOnly ? (
        <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
          <TaskSheet task={task} ctx={taskCtx} editTrigger />
        </span>
      ) : null}
    </div>
  );
}

function RecordChip({
  item,
  recordCtx,
  readOnly,
}: {
  item: AgendaItem;
  recordCtx: KanbanRecordContext;
  readOnly?: boolean;
}) {
  return (
    <div
      className="group bg-primary/10 flex items-center gap-1 rounded border border-transparent px-1 py-0.5 text-[11px]"
      title={item.title}
    >
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      {!readOnly && item.record ? (
        <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
          <RecordEditSheet
            record={item.record}
            fields={recordCtx.fields}
            responsibles={recordCtx.responsibles}
            operations={recordCtx.operations}
            relatedLeadLabel={null}
            userRoles={recordCtx.userRoles}
            canEditValues={recordCtx.canEditValues}
            canManageFields={recordCtx.canManageFields}
          />
        </span>
      ) : null}
    </div>
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
}: {
  // Âncora da navegação (qualquer dia do mês/semana em exibição).
  anchor: string;
  view: AgendaViewMode;
  data: AgendaData | null; // null = carregando
  recordCtx: KanbanRecordContext;
  taskCtx: TaskFormContext;
  onNavigate: (anchor: string) => void;
  onViewChange: (view: AgendaViewMode) => void;
  // Tarefa concluída/reaberta — o chamador refaz a busca.
  onChanged: () => void;
  readOnly?: boolean;
  compact?: boolean;
}) {
  const today = todayBrasiliaIso();
  const weeks = useMemo(
    () => (view === "month" ? monthGrid(anchor) : [weekOf(anchor)]),
    [anchor, view]
  );
  const byDay = useMemo(() => {
    const m = new Map<string, AgendaItem[]>();
    for (const item of data?.items ?? []) {
      if (!m.has(item.date)) m.set(item.date, []);
      m.get(item.date)!.push(item);
    }
    return m;
  }, [data]);

  function navigate(delta: number) {
    onNavigate(
      view === "month" ? addMonths(anchor, delta) : addDays(anchor, delta * 7)
    );
  }

  const label =
    view === "month"
      ? monthLabel(anchor)
      : `Semana de ${weekOf(anchor)[0].split("-").reverse().join("/")}`;

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
            onClick={() => onNavigate(view === "month" ? monthOf(today) + "-01" : today)}
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

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid grid-cols-7 gap-px rounded-lg border bg-border">
          {WEEKDAY_SHORT_PT.map((d) => (
            <div
              key={d}
              className="bg-muted/60 px-1.5 py-1 text-center text-xs font-medium"
            >
              {d}
            </div>
          ))}
          {weeks.flat().map((day) => {
            const items = byDay.get(day) ?? [];
            const inMonth = view === "week" || monthOf(day) === monthOf(anchor);
            const isToday = day === today;
            return (
              <div
                key={day}
                className={cn(
                  "bg-background flex flex-col gap-0.5 p-1",
                  compact ? "min-h-16" : "min-h-24",
                  !inMonth && "opacity-50"
                )}
              >
                <span
                  className={cn(
                    "self-end rounded-full px-1.5 text-xs",
                    isToday
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "text-muted-foreground"
                  )}
                >
                  {Number(day.slice(8, 10))}
                </span>
                {data == null && items.length === 0 ? null : null}
                {items.map((item) =>
                  item.kind === "task" ? (
                    <TaskChip
                      key={`t-${item.id}`}
                      item={item}
                      taskCtx={taskCtx}
                      readOnly={readOnly}
                      onChanged={onChanged}
                    />
                  ) : (
                    <RecordChip
                      key={`r-${item.id}`}
                      item={item}
                      recordCtx={recordCtx}
                      readOnly={readOnly}
                    />
                  )
                )}
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
    </div>
  );
}
