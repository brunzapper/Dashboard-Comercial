// Versão: 1.2 | Data: 10/09/2026
// v1.2 (10/09/2026): SELEÇÃO MÚLTIPLA opcional. `selection` ausente = a lista
// renderiza byte-idêntica (pinado em teste) — é o que permite ligar a seleção
// em três telas sem tocar nas outras duas que consomem este mesmo componente.
// A caixa de SELECIONAR é o `<Checkbox>` do shadcn (o de /registros) e fica à
// ESQUERDA; a de CONCLUIR segue sendo o input nativo. Duas caixas iguais lado
// a lado seriam armadilha; duas de formas e rótulos distintos, não.
// Lista de TAREFAS (página Tarefas, seção do registro e visão lista do kanban
// de tarefas): checkbox de conclusão, destaque de prazo (atrasada/em breve),
// vínculo, responsável, editar e excluir (regras de RLS dão o feedback).
//
// v1.1 (10/09/2026): concluir e excluir saíram daqui para `useTaskRowActions`
// + os dois botões. Motivo: o nó da Tree só sabia ABRIR a tarefa (o TaskSheet
// não conclui nem exclui, por desenho), então não havia como fechar nem apagar
// nada por lá. Uma segunda cópia do checkbox seria a régua paralela da
// invariante 25 — e divergiria no primeiro tratamento de erro novo.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Globe, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
        status === "em_breve" && "bg-amber-500/15 text-amber-700 dark:text-amber-400 font-medium",
        !status && "text-muted-foreground bg-muted"
      )}
      title={status ? DUE_STATUS_LABELS[status] : undefined}
    >
      {text}
    </span>
  );
}

/**
 * O comportamento de concluir/reabrir e excluir UMA tarefa.
 *
 * Hook em vez de componente porque os dois consumidores têm layouts opostos:
 * na lista o checkbox abre a linha e a lixeira a fecha, com o conteúdo no
 * meio; no nó da Tree os dois ficam juntos, à direita. O que não pode
 * divergir é a REGRA (quais actions, o evento do bus, o refresh, a mensagem
 * de RLS), e ela mora aqui.
 */
export function useTaskRowActions(task: TaskRow, onChanged?: () => void) {
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
    onChanged?.();
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

  return { done, pending, error, toggle, remove };
}

export function TaskCompleteCheckbox({
  done,
  pending,
  onToggle,
}: {
  done: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <input
      type="checkbox"
      checked={done}
      onChange={onToggle}
      disabled={pending}
      className="size-4 shrink-0 accent-primary"
      aria-label={done ? "Reabrir tarefa" : "Concluir tarefa"}
    />
  );
}

export function TaskDeleteButton({
  pending,
  onRemove,
}: {
  pending: boolean;
  onRemove: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6"
      onClick={onRemove}
      disabled={pending}
      aria-label="Excluir tarefa"
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}

/**
 * Seleção múltipla da lista. Ausente = lista sem checkbox de seleção, do jeito
 * que sempre foi — quem liga é o dono da tela, que também é dono da barra.
 */
export interface TaskListSelection {
  selected: Set<string>;
  onToggle: (taskId: string) => void;
}

export function TaskListItem({
  task,
  ctx,
  showRecord = true,
  responsibleLabel,
  selection,
}: {
  task: TaskRow;
  ctx: TaskFormContext;
  showRecord?: boolean;
  responsibleLabel?: string | null;
  selection?: TaskListSelection;
}) {
  const { done, pending, error, toggle, remove } = useTaskRowActions(task);

  return (
    <div className="flex flex-col gap-0.5 rounded-md border px-2 py-1.5">
      <div className="flex items-center gap-2">
        {selection ? (
          <Checkbox
            checked={selection.selected.has(task.id)}
            onCheckedChange={() => selection.onToggle(task.id)}
            aria-label="Selecionar tarefa"
          />
        ) : null}
        <TaskCompleteCheckbox done={done} pending={pending} onToggle={toggle} />
        <span
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1 truncate text-sm",
            done && "text-muted-foreground line-through"
          )}
          title={task.description ?? undefined}
        >
          {task.is_global ? (
            <Globe
              className="text-brand size-3 shrink-0"
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
        <TaskDeleteButton pending={pending} onRemove={remove} />
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
  selection,
  allState,
  onToggleAll,
}: {
  tasks: TaskRow[];
  ctx: TaskFormContext;
  responsibleLabels?: Record<string, string>;
  emptyMessage?: string;
  /** v1.2: liga a seleção múltipla. Ausente = lista de sempre. */
  selection?: TaskListSelection;
  /** Tri-estado do "selecionar todas" — só faz sentido com `selection`. */
  allState?: boolean | "indeterminate";
  onToggleAll?: (checked: boolean) => void;
}) {
  if (tasks.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyMessage}</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {selection && onToggleAll ? (
        <label className="text-muted-foreground flex items-center gap-2 px-2 text-xs">
          <Checkbox
            checked={allState ?? false}
            onCheckedChange={(v) => onToggleAll(v === true)}
            aria-label="Selecionar todas as tarefas"
          />
          Selecionar todas ({tasks.length})
        </label>
      ) : null}
      {tasks.map((t) => (
        <TaskListItem
          key={t.id}
          task={t}
          ctx={ctx}
          selection={selection}
          responsibleLabel={
            t.responsible_id ? (responsibleLabels[t.responsible_id] ?? null) : null
          }
        />
      ))}
    </div>
  );
}
