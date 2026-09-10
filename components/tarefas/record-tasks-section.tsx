// Versão: 1.1 | Data: 10/09/2026
// v1.1 (10/09/2026): seleção múltipla (concluir/excluir em lote). O `onDone`
// é o `reload` que a seção já tinha — ela não depende do bus para o próprio
// ato, só para o que acontece nas outras superfícies.
// Seção "Tarefas" do painel de edição de registro: carrega sob demanda
// (montada só com o Sheet aberto), lista com concluir/editar/excluir e botão
// de nova tarefa já vinculada ao registro.
"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import { useBulkSelection } from "@/lib/feedback/use-bulk-selection";

import type { OptionItem } from "@/lib/records/types";
import { listRecordTasks } from "@/lib/tasks/actions";
import { useDataChanged } from "@/lib/tasks/events";
import type { TaskRow } from "@/lib/tasks/types";
import { TaskList } from "./task-list";
import { TasksBulkBar } from "./tasks-bulk-bar";
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

  // Event bus: tarefa deste registro mudou em outra superfície (sino, feed,
  // kanban) → recarrega a seção. Sem recordId no evento = origem desconhecida.
  useDataChanged((d) => {
    if (d.kind === "task" && (!d.recordId || d.recordId === recordId)) reload();
  });

  const rows = useMemo(() => tasks ?? [], [tasks]);
  const ids = useMemo(() => rows.map((t) => t.id), [rows]);
  const bulk = useBulkSelection(ids);
  const selectedTasks = useMemo(
    () => rows.filter((t) => bulk.selected.has(t.id)),
    [rows, bulk.selected]
  );

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
        <>
          <TaskList
            tasks={tasks}
            ctx={ctx}
            emptyMessage="Nenhuma tarefa vinculada."
            selection={{ selected: bulk.selected, onToggle: bulk.toggle }}
            allState={bulk.allState}
            onToggleAll={bulk.toggleAll}
          />
          <TasksBulkBar
            tasks={selectedTasks}
            onClear={bulk.clear}
            onDone={() => {
              bulk.clear();
              reload();
            }}
          />
        </>
      )}
    </div>
  );
}
