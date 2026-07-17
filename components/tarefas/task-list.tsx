// Versão: 1.0 | Data: 16/07/2026
// Lista de TAREFAS (página Tarefas, seção do registro e visão lista do kanban
// de tarefas): checkbox de conclusão, destaque de prazo (atrasada/em breve),
// vínculo, responsável, editar e excluir (regras de RLS dão o feedback).
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Globe, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { TaskRow } from "@/lib/tasks/types";
import {
  completeTask,
  deleteTask,
  reopenTask,
} from "@/lib/tasks/actions";
import { emitDataChanged } from "@/lib/tasks/events";
import { classifyDue, DUE_STATUS_LABELS } from "@/lib/tasks/alerts";
import { DEFAULT_DATE_FORMAT, formatDateValue } from "@/lib/widgets/format";
import { TaskSheet, type TaskFormContext } from "./task-sheet";

function DueBadge({ task }: { task: TaskRow }) {
  if (!task.due_date) return null;
  const status = classifyDue(task);
  const text = `${formatDateValue(task.due_date, DEFAULT_DATE_FORMAT)}${
    task.due_time ? ` ${task.due_time.slice(0, 5)}` : ""
  }`;
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap",
        status === "atrasada" && "bg-destructive/10 text-destructive font-medium",
        status === "em_breve" && "bg-amber-500/15 text-amber-700 font-medium",
        !status && "text-muted-foreground bg-muted"
      )}
      title={status ? DUE_STATUS_LABELS[status] : undefined}
    >
      {text}
    </span>
  );
}

export function TaskListItem({
  task,
  ctx,
  showRecord = true,
  responsibleLabel,
}: {
  task: TaskRow;
  ctx: TaskFormContext;
  showRecord?: boolean;
  responsibleLabel?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const done = Boolean(task.completed_at);

  function emit() {
    emitDataChanged({
      kind: "task",
      taskId: task.id,
      recordId: task.record_id,
      boardId: task.board_id,
    });
  }

  function toggle() {
    setError(null);
    startTransition(async () => {
      const res = done ? await reopenTask(task.id) : await completeTask(task.id);
      if (!res.ok) setError(res.message ?? "Falha ao atualizar.");
      else {
        emit();
        router.refresh();
      }
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await deleteTask(task.id);
      if (!res.ok) setError(res.message ?? "Falha ao excluir.");
      else {
        emit();
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-0.5 rounded-md border px-2 py-1.5">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={done}
          onChange={toggle}
          disabled={pending}
          className="size-4 shrink-0 accent-primary"
          aria-label={done ? "Reabrir tarefa" : "Concluir tarefa"}
        />
        <span
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1 truncate text-sm",
            done && "text-muted-foreground line-through"
          )}
          title={task.description ?? undefined}
        >
          {task.is_global ? (
            <Globe
              className="text-primary size-3 shrink-0"
              aria-label="Tarefa global (notifica todos)"
            />
          ) : null}
          <span className="truncate">{task.title}</span>
        </span>
        <DueBadge task={task} />
        {responsibleLabel ? (
          <span className="text-muted-foreground hidden text-xs sm:inline">
            {responsibleLabel}
          </span>
        ) : null}
        <TaskSheet task={task} ctx={ctx} editTrigger />
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={remove}
          disabled={pending}
          aria-label="Excluir tarefa"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {showRecord && task.record?.title ? (
        <p className="text-muted-foreground pl-6 text-xs">
          Registro: {task.record.title}
        </p>
      ) : null}
      {error ? (
        <p className="text-destructive pl-6 text-xs" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TaskList({
  tasks,
  ctx,
  responsibleLabels = {},
  emptyMessage = "Nenhuma tarefa.",
}: {
  tasks: TaskRow[];
  ctx: TaskFormContext;
  responsibleLabels?: Record<string, string>;
  emptyMessage?: string;
}) {
  if (tasks.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyMessage}</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {tasks.map((t) => (
        <TaskListItem
          key={t.id}
          task={t}
          ctx={ctx}
          responsibleLabel={
            t.responsible_id ? (responsibleLabels[t.responsible_id] ?? null) : null
          }
        />
      ))}
    </div>
  );
}
