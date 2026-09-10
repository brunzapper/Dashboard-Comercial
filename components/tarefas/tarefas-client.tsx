// Versão: 1.1 | Data: 10/09/2026
// v1.1 (10/09/2026): SELEÇÃO MÚLTIPLA na visão lista — concluir e
//   excluir várias de uma vez. O universo é a lista FILTRADA (`filtered`),
//   nunca a consulta inteira. A visão kanban já tinha seleção própria.
// Shell client da página Tarefas: filtros (status/responsável), visão lista ou
// quadro por fase (fases default + as presentes nas tarefas), criação. A RLS
// já escopa o vendedor às próprias tarefas — os filtros são só de exibição.
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { List, SquareKanban } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import type { OptionItem } from "@/lib/records/types";
import type { TaskRow } from "@/lib/tasks/types";
import { classifyDue } from "@/lib/tasks/alerts";
import { taskBoardData } from "@/lib/tasks/kanban";
import { moveTaskPhase } from "@/lib/tasks/actions";
import { useDataChanged } from "@/lib/tasks/events";
import {
  DEFAULT_TASK_PHASES,
  type KanbanSettings,
} from "@/lib/kanban/types";
import type { KanbanColumnCards } from "@/lib/kanban/data";
import {
  KanbanBoard,
  type KanbanDragPayload,
} from "@/components/kanban/kanban-board";
import { useBulkSelection } from "@/lib/feedback/use-bulk-selection";
import { TaskList } from "./task-list";
import { TasksBulkBar } from "./tasks-bulk-bar";
import { TaskSheet, type TaskFormContext } from "./task-sheet";

const STATUS_OPTIONS: ComboboxOption[] = [
  { value: "abertas", label: "Abertas" },
  { value: "atrasadas", label: "Atrasadas" },
  { value: "concluidas", label: "Concluídas" },
  { value: "todas", label: "Todas" },
];

type View = "lista" | "kanban";

export function TarefasClient({
  tasks,
  responsibles,
  canFilterResponsible,
  taskCtx,
}: {
  tasks: TaskRow[];
  responsibles: OptionItem[];
  canFilterResponsible: boolean;
  taskCtx: TaskFormContext;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("lista");
  const [status, setStatus] = useState("abertas");
  const [responsavel, setResponsavel] = useState("");

  // Event bus: mutação vinda do sino/widgets enquanto esta página está aberta
  // → re-renderiza o RSC (as próprias mutações da página já revalidam /tarefas).
  useDataChanged((d) => {
    if (d.kind !== "record") router.refresh();
  });

  const responsibleLabels = useMemo(
    () => Object.fromEntries(responsibles.map((r) => [r.id, r.label])),
    [responsibles]
  );

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (responsavel && t.responsible_id !== responsavel) return false;
      const done = Boolean(t.completed_at);
      if (status === "abertas") return !done;
      if (status === "concluidas") return done;
      if (status === "atrasadas") return classifyDue(t) === "atrasada";
      return true;
    });
  }, [tasks, status, responsavel]);

  // Seleção múltipla da visão LISTA. O universo é `filtered`: marcar "todas"
  // com um filtro ativo não pode alcançar o que o filtro escondeu.
  const filteredIds = useMemo(() => filtered.map((t) => t.id), [filtered]);
  const bulk = useBulkSelection(filteredIds);
  const selectedTasks = useMemo(
    () => filtered.filter((t) => bulk.selected.has(t.id)),
    [filtered, bulk.selected]
  );

  // Quadro por fase: fases default + extras presentes (boards personalizados).
  const boardSettings = useMemo<KanbanSettings>(() => {
    const known = new Set(DEFAULT_TASK_PHASES.map((p) => p.key));
    const extras = [...new Set(filtered.map((t) => t.phase))].filter(
      (p) => !known.has(p)
    );
    return {
      mode: "tarefas",
      columns: [
        ...DEFAULT_TASK_PHASES,
        ...extras.map((key) => ({ key, label: key })),
      ],
    };
  }, [filtered]);

  const boardData = useMemo(
    () => taskBoardData(filtered, boardSettings, responsibleLabels),
    [filtered, boardSettings, responsibleLabels]
  );

  async function onMoveTask(
    payload: KanbanDragPayload,
    targetKey: string,
    targetCol: KanbanColumnCards
  ) {
    return moveTaskPhase(
      payload.cardId,
      targetKey,
      Boolean(targetCol.completesTask)
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-7 gap-1 px-2", view === "lista" && "bg-muted")}
            onClick={() => setView("lista")}
            aria-pressed={view === "lista"}
          >
            <List className="size-4" />
            Lista
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-7 gap-1 px-2", view === "kanban" && "bg-muted")}
            onClick={() => setView("kanban")}
            aria-pressed={view === "kanban"}
          >
            <SquareKanban className="size-4" />
            Por fase
          </Button>
        </div>

        <Combobox
          options={STATUS_OPTIONS}
          value={status}
          onValueChange={setStatus}
          searchable={false}
          className="w-36"
          aria-label="Status"
        />
        {canFilterResponsible ? (
          <Combobox
            options={[
              { value: "", label: "Todos os responsáveis" },
              ...responsibles.map((r) => ({ value: r.id, label: r.label })),
            ]}
            value={responsavel}
            onValueChange={setResponsavel}
            className="w-52"
            aria-label="Responsável"
          />
        ) : null}

        <div className="ml-auto">
          <TaskSheet ctx={taskCtx} />
        </div>
      </div>

      {view === "lista" ? (
        <>
          <TaskList
            tasks={filtered}
            ctx={taskCtx}
            responsibleLabels={responsibleLabels}
            emptyMessage="Nenhuma tarefa neste filtro."
            selection={{ selected: bulk.selected, onToggle: bulk.toggle }}
            allState={bulk.allState}
            onToggleAll={bulk.toggleAll}
          />
          <TasksBulkBar
            tasks={selectedTasks}
            onClear={bulk.clear}
            onDone={() => {
              bulk.clear();
              router.refresh();
            }}
          />
        </>
      ) : (
        <KanbanBoard
          data={boardData}
          settings={boardSettings}
          canMove
          recordCtx={{
            fields: [],
            responsibles,
            operations: [],
            userRoles: [],
            canEditValues: false,
            canManageFields: false,
          }}
          taskCtx={taskCtx}
          onMove={onMoveTask}
          columnExtra={(col) => (
            <TaskSheet
              ctx={taskCtx}
              defaults={{ phase: col.key }}
              triggerLabel={`Nova tarefa em ${col.label}`}
              iconTrigger
            />
          )}
        />
      )}
    </div>
  );
}
