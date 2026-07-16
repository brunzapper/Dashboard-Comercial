// Versão: 1.0 | Data: 16/07/2026
// Seção "Tarefas" do painel de edição de registro: carrega sob demanda
// (montada só com o Sheet aberto), lista com concluir/editar/excluir e botão
// de nova tarefa já vinculada ao registro.
"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import type { OptionItem } from "@/lib/records/types";
import { listRecordTasks } from "@/lib/tasks/actions";
import type { TaskRow } from "@/lib/tasks/types";
import { TaskList } from "./task-list";
import { TaskSheet, type TaskFormContext } from "./task-sheet";

export function RecordTasksSection({
  recordId,
  recordTitle,
  responsibles,
  userRoles,
}: {
  recordId: string;
  recordTitle: string | null;
  responsibles: OptionItem[];
  userRoles: string[];
}) {
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [, startTransition] = useTransition();
  const isManager = userRoles.includes("admin") || userRoles.includes("gestor");
  const ctx: TaskFormContext = {
    responsibles,
    canAssignOthers: isManager,
    canLock: isManager,
  };

  const reload = useCallback(() => {
    startTransition(async () => {
      setTasks(await listRecordTasks(recordId));
    });
  }, [recordId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Tarefas</p>
        <TaskSheet
          ctx={ctx}
          defaults={{ recordId, recordTitle }}
          triggerLabel="Nova tarefa do registro"
          iconTrigger
          onDone={reload}
        />
      </div>
      {tasks == null ? (
        <p className="text-muted-foreground text-xs">Carregando…</p>
      ) : (
        <TaskList
          tasks={tasks}
          ctx={ctx}
          emptyMessage="Nenhuma tarefa vinculada."
        />
      )}
    </div>
  );
}
