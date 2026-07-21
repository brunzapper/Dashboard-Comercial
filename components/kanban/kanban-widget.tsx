// Versão: 1.1 | Data: 21/07/2026
// v1.1 (21/07/2026): fetch re-dispara pelo FINGERPRINT de escopo da page
//   (prop scopeKey — cobre filtros persistidos no banco, __qf__, que não
//   mudam a URL); enquanto re-busca com o quadro antigo em tela, exibe
//   "Atualizando…" (dim + spinner, sem bloquear interações/drag).
// Widget KANBAN no dashboard: a page NÃO computa nada — o widget busca via
// runKanbanWidget após o mount (padrão da Tabela Livre), com o período/filtros
// resolvidos no servidor. Toggle quadro|lista; moves pelas mesmas
// actions da página dedicada. No snapshot público (sem sessão) usa o resultado
// precomputado (snapshotMode.kanbanResults) e fica somente-leitura; modo
// tarefas nunca entra no snapshot (dados privados) → placeholder.
"use client";

import { useEffect, useState } from "react";
import { Download, List, Loader2, SquareKanban } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildCsv, csvFilename, downloadCsv } from "@/lib/export/csv";
import { kanbanBoardToCsv } from "@/lib/export/kanban";
import type { Widget } from "@/lib/widgets/types";
import type { KanbanColumnCards } from "@/lib/kanban/data";
import { moveTaskPhase } from "@/lib/tasks/actions";
import { useDataChanged } from "@/lib/tasks/events";
import {
  runKanbanWidget,
  type KanbanWidgetResult,
} from "@/app/(app)/dashboards/kanban-actions";
import { saveWidgetSettings } from "@/app/(app)/dashboards/actions";
import {
  addColumnOverride,
  reorderColumnOverrides,
} from "@/lib/kanban/columns";
import { useSnapshotMode } from "@/components/snapshots/snapshot-mode";
import {
  KanbanBoard,
  type KanbanDragPayload,
} from "./kanban-board";
import { KanbanList } from "./kanban-list";
import { ColumnConfigPopover } from "./column-config-popover";
import { RecordCreateSheet } from "@/components/registros/record-create-sheet";
import {
  TaskSheet,
  type TaskFormContext,
} from "@/components/tarefas/task-sheet";
import { computeDateOnMove } from "@/lib/kanban/date-move";
import { todayBrasiliaIso } from "@/lib/date/today";
import {
  KANBAN_MAX_COLUMNS,
  KANBAN_NO_VALUE_KEY,
  KANBAN_OVERFLOW_KEY,
  type KanbanDateBucket,
  type KanbanSettings,
} from "@/lib/kanban/types";

export function KanbanWidget({
  widget,
  dashboardId,
  userRoles,
  canEditValues,
  canManageFields,
  canConfig,
  scopeKey,
}: {
  widget: Widget;
  dashboardId: string;
  userRoles: string[];
  canEditValues: boolean;
  canManageFields: boolean;
  // Pode configurar colunas do quadro (dono do dashboard/admin — canEdit).
  canConfig?: boolean;
  // Fingerprint do escopo efetivo (page → deferredScopeById): re-dispara o
  // fetch quando período/filtros mudam — inclusive __qf__ (banco, sem URL).
  scopeKey?: string;
}) {
  const snapshotMode = useSnapshotMode();
  const readOnly = snapshotMode.snapshot;
  const [fetched, setFetched] = useState<KanbanWidgetResult | null>(null);
  // Re-busca com o quadro antigo em tela: dim + spinner até o novo aterrissar.
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<"kanban" | "lista">("kanban");

  // Event bus: tarefa/registro/comentário mudou em qualquer superfície →
  // re-busca o quadro (o debounce abaixo coalesce rajadas de eventos).
  const [tick, setTick] = useState(0);
  useDataChanged(() => setTick((t) => t + 1));

  const cfgKey = JSON.stringify(widget.settings?.kanban ?? {});
  useEffect(() => {
    if (readOnly) return; // snapshot: precomputado pela page pública
    let cancelled = false;
    // 250ms: coalesce rajadas de eventos do bus (uma mutação pode emitir vários
    // e cada re-busca é uma server action inteira) sem atrasar perceptivelmente.
    const timer = setTimeout(() => {
      setRefreshing(true);
      // A URL é lida NA CHAMADA (não é dep): quem re-dispara o effect é o
      // scopeKey — fingerprint do escopo efetivo computado pela page, que
      // muda tanto por navegação (período/ff_) quanto por revalidação
      // (__qf__ persistido no banco, sem mudança de URL).
      void runKanbanWidget(
        dashboardId,
        widget.id,
        window.location.search
      ).then((res) => {
        if (cancelled) return;
        setFetched(res);
        setRefreshing(false);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [readOnly, dashboardId, widget.id, scopeKey, cfgKey, tick]);

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
  const isCustom = !isTasks && kanban.columnSource === "custom";
  // Gestão de colunas no widget: quando as colunas pertencem ao PRÓPRIO widget
  // (widget de tarefas apontando p/ board dedicado usa as fases DO board — lá
  // é que se editam).
  const ownsColumns = !(isTasks && kanban.taskBoardId);
  const canManageColumns = Boolean(canConfig) && !readOnly && ownsColumns;
  const persistKanban = async (next: KanbanSettings) => {
    const res = await saveWidgetSettings(widget.id, dashboardId, {
      ...widget.settings,
      kanban: next,
    });
    if (res.ok) setTick((t) => t + 1);
    return res;
  };
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
    // Personalizar: sem prefill — registro novo nasce na primeira coluna.
    if (kanban.columnSource === "custom") return {};
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

  // Export CSV do quadro (cards achatados por coluna) — dados já computados.
  const exportCsv = () => {
    if (!result.data) return;
    const labels = {
      responsibles: Object.fromEntries(
        result.responsibles.map((r) => [r.id, r.label])
      ),
      operations: Object.fromEntries(
        result.operations.map((o) => [o.id, o.label])
      ),
    };
    const { headers, rows } = kanbanBoardToCsv(
      result.data,
      result.fields,
      labels
    );
    downloadCsv(
      csvFilename(widget.title ?? "kanban"),
      buildCsv(headers, rows)
    );
  };

  // Aparência do seletor de visão (as "abas" do kanban).
  const sw = kanban.appearance?.switcher;
  const swStyle = (active: boolean): React.CSSProperties => ({
    background: active ? sw?.activeBg : sw?.inactiveBg,
    color: active ? sw?.activeText : sw?.inactiveText,
  });

  // "Atualizando…" só quando há quadro antigo em tela (1º load tem placeholder).
  const staleRefreshing = refreshing && !readOnly;

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 p-1">
      <div className="flex items-center justify-end gap-1.5">
        {staleRefreshing ? (
          <span className="text-muted-foreground mr-auto flex items-center gap-1 text-xs">
            <Loader2 className="size-3 animate-spin" /> Atualizando…
          </span>
        ) : null}
        {!readOnly ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-6 gap-1 px-1.5 text-xs"
            onClick={exportCsv}
            title="Exportar CSV"
          >
            <Download className="size-3.5" />
            CSV
          </Button>
        ) : null}
        {canManageColumns ? (
          <ColumnConfigPopover
            kanban={kanban}
            data={result.data}
            onSave={persistKanban}
          />
        ) : null}
        <div className="flex rounded-md border p-0.5">
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-6 gap-1 px-1.5 text-xs", view === "kanban" && "bg-muted")}
            style={swStyle(view === "kanban")}
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
            style={swStyle(view === "lista")}
            onClick={() => setView("lista")}
            aria-pressed={view === "lista"}
          >
            <List className="size-3.5" />
            Lista
          </Button>
        </div>
      </div>
      {/* Dim durante a re-busca (sem bloquear interações — drag continua; um
          resultado antigo que aterrisse após um move é reconciliado pelo
          data-changed → tick → novo fetch). */}
      <div
        className={cn(
          "min-h-0 flex-1 transition-opacity",
          staleRefreshing && "opacity-60"
        )}
      >
      {view === "kanban" ? (
        <KanbanBoard
          data={result.data}
          settings={kanban}
          canMove={!readOnly && (isTasks || isCustom || canEditValues)}
          recordCtx={recordCtx}
          taskCtx={isTasks ? taskCtx : undefined}
          onMove={isTasks ? onMoveTask : undefined}
          columnExtra={columnExtra}
          readOnly={readOnly}
          compact
          owner={{ kind: "widget", id: widget.id }}
          canReorderColumns={canManageColumns}
          onReorderColumns={
            canManageColumns
              ? (keys) =>
                  persistKanban({
                    ...kanban,
                    columns: reorderColumnOverrides(kanban, keys),
                  })
              : undefined
          }
          onAddColumn={
            canManageColumns && (isTasks || isCustom)
              ? (label) => {
                  const cols = addColumnOverride(kanban, label);
                  if (!cols) {
                    return Promise.resolve({
                      ok: false,
                      message: `Limite de ${KANBAN_MAX_COLUMNS} colunas.`,
                    });
                  }
                  return persistKanban({ ...kanban, columns: cols });
                }
              : undefined
          }
        />
      ) : (
        <KanbanList
          data={result.data}
          recordCtx={recordCtx}
          readOnly={readOnly}
          appearance={kanban.appearance}
        />
      )}
      </div>
    </div>
  );
}
