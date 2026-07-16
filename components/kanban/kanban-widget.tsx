// Versão: 1.0 | Data: 16/07/2026
// Widget KANBAN no dashboard: a page NÃO computa nada — o widget busca via
// runKanbanWidget após o mount (padrão da Tabela Livre), com o período/filtros
// da URL resolvidos no servidor. Toggle quadro|lista; moves pelas mesmas
// actions da página dedicada. No snapshot público (sem sessão) usa o resultado
// precomputado (snapshotMode.kanbanResults) e fica somente-leitura; modo
// tarefas nunca entra no snapshot (dados privados) → placeholder.
"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { List, SquareKanban } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Widget } from "@/lib/widgets/types";
import type { KanbanColumnCards } from "@/lib/kanban/data";
import { moveTaskPhase } from "@/lib/tasks/actions";
import {
  runKanbanWidget,
  type KanbanWidgetResult,
} from "@/app/(app)/dashboards/kanban-actions";
import { useSnapshotMode } from "@/components/snapshots/snapshot-mode";
import {
  KanbanBoard,
  type KanbanDragPayload,
} from "./kanban-board";
import { KanbanList } from "./kanban-list";
import { RecordCreateSheet } from "@/components/registros/record-create-sheet";
import {
  TaskSheet,
  type TaskFormContext,
} from "@/components/tarefas/task-sheet";
import { computeDateOnMove } from "@/lib/kanban/date-move";
import { todayBrasiliaIso } from "@/lib/date/today";
import {
  KANBAN_NO_VALUE_KEY,
  KANBAN_OVERFLOW_KEY,
  type KanbanDateBucket,
} from "@/lib/kanban/types";

export function KanbanWidget({
  widget,
  dashboardId,
  userRoles,
  canEditValues,
  canManageFields,
}: {
  widget: Widget;
  dashboardId: string;
  userRoles: string[];
  canEditValues: boolean;
  canManageFields: boolean;
}) {
  const snapshotMode = useSnapshotMode();
  const readOnly = snapshotMode.snapshot;
  const search = useSearchParams().toString();
  const [fetched, setFetched] = useState<KanbanWidgetResult | null>(null);
  const [view, setView] = useState<"kanban" | "lista">("kanban");

  const cfgKey = JSON.stringify(widget.settings?.kanban ?? {});
  useEffect(() => {
    if (readOnly) return; // snapshot: precomputado pela page pública
    let cancelled = false;
    const timer = setTimeout(() => {
      void runKanbanWidget(dashboardId, widget.id, search).then((res) => {
        if (!cancelled) setFetched(res);
      });
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [readOnly, dashboardId, widget.id, search, cfgKey]);

  // Snapshot: resultado precomputado (só modo registros; tarefas ficam fora).
  const result: KanbanWidgetResult | null = readOnly
    ? (snapshotMode.kanbanResults?.[widget.id] ?? null)
    : fetched;

  if (readOnly && !result) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-4 text-sm">
        Kanban indisponível no snapshot.
      </div>
    );
  }
  if (!result) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-4 text-sm">
        Carregando quadro…
      </div>
    );
  }
  if (result.error || !result.data || !result.kanban) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center">
        <span className="text-destructive text-sm font-medium">
          Não foi possível carregar o kanban.
        </span>
        {result.error ? (
          <span className="text-muted-foreground max-w-full truncate text-xs">
            {result.error}
          </span>
        ) : null}
      </div>
    );
  }

  const kanban = result.kanban;
  const isTasks = kanban.mode === "tarefas";
  const recordCtx = {
    fields: result.fields,
    responsibles: result.responsibles,
    operations: result.operations,
    userRoles,
    canEditValues,
    canManageFields,
  };
  const taskCtx: TaskFormContext = {
    responsibles: result.responsibles,
    canAssignOthers:
      userRoles.includes("admin") || userRoles.includes("gestor"),
    canLock: userRoles.includes("admin") || userRoles.includes("gestor"),
  };

  function quickCreateDefaults(colKey: string): Record<string, string> | null {
    if (colKey === KANBAN_OVERFLOW_KEY) return null;
    if (kanban.dateBucket && kanban.dateField) {
      if (colKey === KANBAN_NO_VALUE_KEY) return {};
      const iso = computeDateOnMove(
        null,
        kanban.dateBucket as KanbanDateBucket,
        colKey,
        todayBrasiliaIso()
      );
      if (!iso) return {};
      const key = kanban.dateField.startsWith("custom:")
        ? `custom__${kanban.dateField.slice("custom:".length)}`
        : `core__${kanban.dateField}`;
      return { [key]: iso.slice(0, 10) };
    }
    if (colKey === KANBAN_NO_VALUE_KEY) return {};
    const field = kanban.groupField ?? "stage";
    const key = field.startsWith("custom:")
      ? `custom__${field.slice("custom:".length)}`
      : `core__${field}`;
    return { [key]: colKey };
  }

  const columnExtra = readOnly
    ? undefined
    : (col: KanbanColumnCards) => {
        if (isTasks) {
          return (
            <TaskSheet
              ctx={taskCtx}
              defaults={{
                boardId: kanban.taskBoardId ?? null,
                phase: col.key,
                locked: kanban.tasks?.lockByDefault,
              }}
              triggerLabel={`Nova tarefa em ${col.label}`}
              iconTrigger
            />
          );
        }
        if (!result.quickCreateSource) return null;
        const defaults = quickCreateDefaults(col.key);
        if (!defaults) return null;
        return (
          <RecordCreateSheet
            source={result.quickCreateSource}
            fields={result.fields}
            responsibles={result.responsibles}
            operations={result.operations}
            userRoles={userRoles}
            defaultValues={defaults}
            triggerLabel={`Novo registro em ${col.label}`}
            iconTrigger
          />
        );
      };

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
    <div className="flex h-full min-h-0 flex-col gap-1.5 p-1">
      <div className="flex justify-end">
        <div className="flex rounded-md border p-0.5">
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-6 gap-1 px-1.5 text-xs", view === "kanban" && "bg-muted")}
            onClick={() => setView("kanban")}
            aria-pressed={view === "kanban"}
          >
            <SquareKanban className="size-3.5" />
            Quadro
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-6 gap-1 px-1.5 text-xs", view === "lista" && "bg-muted")}
            onClick={() => setView("lista")}
            aria-pressed={view === "lista"}
          >
            <List className="size-3.5" />
            Lista
          </Button>
        </div>
      </div>
      {view === "kanban" ? (
        <KanbanBoard
          data={result.data}
          settings={kanban}
          canMove={!readOnly && (isTasks || canEditValues)}
          recordCtx={recordCtx}
          taskCtx={isTasks ? taskCtx : undefined}
          onMove={isTasks ? onMoveTask : undefined}
          columnExtra={columnExtra}
          readOnly={readOnly}
          compact
        />
      ) : (
        <KanbanList data={result.data} recordCtx={recordCtx} readOnly={readOnly} />
      )}
    </div>
  );
}
