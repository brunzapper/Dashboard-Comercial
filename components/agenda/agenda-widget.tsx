// Versão: 1.0 | Data: 16/07/2026
// Widget AGENDA no dashboard: fetch deferido do range visível
// (fetchAgendaWidget) com navegação própria por mês/semana — a agenda não
// participa da barra de período do dashboard. No snapshot público mostra
// placeholder (tarefas são privadas e a navegação exige sessão).
"use client";

import { useCallback, useEffect, useState } from "react";

import type { Widget } from "@/lib/widgets/types";
import {
  fetchAgendaWidget,
  type AgendaResult,
} from "@/lib/agenda/actions";
import { addDays, monthGrid, weekOf } from "@/lib/agenda/month-grid";
import { todayBrasiliaIso } from "@/lib/date/today";
import { useSnapshotMode } from "@/components/snapshots/snapshot-mode";
import type { TaskFormContext } from "@/components/tarefas/task-sheet";
import { AgendaView, type AgendaViewMode } from "./agenda-view";

// Range visível (mês = grade completa, com bordas dos meses vizinhos).
function rangeOf(anchor: string, view: AgendaViewMode): { from: string; to: string } {
  if (view === "week") {
    const days = weekOf(anchor);
    return { from: days[0], to: days[6] };
  }
  const weeks = monthGrid(anchor);
  return { from: weeks[0][0], to: weeks[weeks.length - 1][6] };
}

export function AgendaWidget({
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
  const [view, setView] = useState<AgendaViewMode>(
    widget.settings?.agenda?.defaultView ?? "month"
  );
  const [anchor, setAnchor] = useState(todayBrasiliaIso());
  const [result, setResult] = useState<AgendaResult | null>(null);

  const reload = useCallback(() => {
    const { from, to } = rangeOf(anchor, view);
    void fetchAgendaWidget(dashboardId, widget.id, from, to).then(setResult);
  }, [dashboardId, widget.id, anchor, view]);

  useEffect(() => {
    if (snapshotMode.snapshot) return;
    reload();
  }, [snapshotMode.snapshot, reload]);

  if (snapshotMode.snapshot) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-4 text-sm">
        Agenda indisponível no snapshot.
      </div>
    );
  }
  if (result?.error) {
    return (
      <div className="text-destructive flex h-full items-center justify-center p-4 text-sm">
        {result.error}
      </div>
    );
  }

  const isManager = userRoles.includes("admin") || userRoles.includes("gestor");
  const taskCtx: TaskFormContext = {
    responsibles: result?.responsibles ?? [],
    canAssignOthers: isManager,
    canLock: isManager,
  };

  return (
    <div className="h-full min-h-0 p-1">
      <AgendaView
        anchor={anchor}
        view={view}
        data={result?.data ?? null}
        recordCtx={{
          fields: result?.fields ?? [],
          responsibles: result?.responsibles ?? [],
          operations: result?.operations ?? [],
          userRoles,
          canEditValues,
          canManageFields,
        }}
        taskCtx={taskCtx}
        onNavigate={setAnchor}
        onViewChange={setView}
        onChanged={reload}
        compact
      />
    </div>
  );
}

// Reexport p/ a página do kanban (3ª visão) montar o mesmo range.
export { rangeOf as agendaRangeOf };
export { addDays as agendaAddDays };
