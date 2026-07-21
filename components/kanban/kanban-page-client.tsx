// Versão: 1.3 | Data: 21/07/2026
// Shell client da página dedicada de kanban (/kanbans/[id]): cabeçalho (nome,
// visões kanban|lista, barra de período simples, config de colunas, criação) +
// o quadro/lista. Os dados chegam computados do RSC; navegação de período muda
// a URL (?periodo/?de/?ate) e o servidor recomputa.
// v1.3 (21/07/2026): intervalo De/Até em RASCUNHO (PeriodRangeDraft, mesmo
//   componente da barra de período dos dashboards) — digitar não navega mais a
//   cada tecla com intervalo parcial; commit com o intervalo completo (auto)
//   ou via "Aplicar" (aberto deliberado).
// v1.1 (16/07/2026): modo TAREFAS — quadro por fase (mover conclui na coluna
//   `completesTask`), quick-create de tarefa por coluna e lista de tarefas.
// v1.2 (16/07/2026): 3ª visão AGENDA — calendário do board (registros pelo
//   campo de data do board + tarefas por vencimento; fetch deferido por range).
"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Download, List, SquareKanban } from "lucide-react";

import { Button } from "@/components/ui/button";
import { buildCsv, csvFilename, downloadCsv } from "@/lib/export/csv";
import { kanbanBoardToCsv } from "@/lib/export/kanban";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { PeriodRangeDraft } from "@/components/dashboards/period-range-inputs";
import { PERIOD_PRESETS } from "@/lib/widgets/period";
import { updateBoardSettings } from "@/app/(app)/dashboards/actions";
import type { DashboardSettings } from "@/lib/widgets/types";
import type { KanbanBoardData, KanbanColumnCards } from "@/lib/kanban/data";
import { computeDateOnMove } from "@/lib/kanban/date-move";
import { todayBrasiliaIso } from "@/lib/date/today";
import {
  KANBAN_MAX_COLUMNS,
  KANBAN_NO_VALUE_KEY,
  KANBAN_OVERFLOW_KEY,
  type KanbanDateBucket,
  type KanbanSettings,
} from "@/lib/kanban/types";
import {
  addColumnOverride,
  reorderColumnOverrides,
} from "@/lib/kanban/columns";
import { moveTaskPhase } from "@/lib/tasks/actions";
import { useDataChanged } from "@/lib/tasks/events";
import type { TaskRow } from "@/lib/tasks/types";
import { fetchBoardAgenda, type AgendaResult } from "@/lib/agenda/actions";
import { monthGrid, weekOf } from "@/lib/agenda/month-grid";
import { cn } from "@/lib/utils";
import {
  AgendaView,
  type AgendaViewMode,
} from "@/components/agenda/agenda-view";
import { RecordCreateSheet } from "@/components/registros/record-create-sheet";
import { TaskList } from "@/components/tarefas/task-list";
import {
  TaskSheet,
  type TaskFormContext,
} from "@/components/tarefas/task-sheet";
import {
  KanbanBoard,
  type KanbanDragPayload,
  type KanbanRecordContext,
} from "./kanban-board";
import { KanbanList } from "./kanban-list";
import { ColumnConfigPopover } from "./column-config-popover";
import { BoardAppearancePopover } from "./board-appearance-popover";

const PERIOD_OPTIONS: ComboboxOption[] = [
  { value: "", label: "Todo o período" },
  ...Object.entries(PERIOD_PRESETS).map(([value, label]) => ({ value, label })),
];

type View = "kanban" | "lista" | "agenda";

export function KanbanPageClient({
  boardId,
  boardName,
  settings,
  kanban,
  data,
  quickCreateSource,
  recordCtx,
  taskCtx,
  responsibleLabels = {},
  canConfig,
}: {
  boardId: string;
  boardName: string;
  settings: DashboardSettings;
  kanban: KanbanSettings;
  data: KanbanBoardData;
  quickCreateSource: { key: string; label: string } | null;
  recordCtx: KanbanRecordContext;
  taskCtx?: TaskFormContext;
  responsibleLabels?: Record<string, string>;
  canConfig: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [view, setView] = useState<View>("kanban");
  const isTasks = kanban.mode === "tarefas";
  const isCustom = !isTasks && kanban.columnSource === "custom";

  // Event bus: os dados do quadro vêm do RSC e revalidateTasks() não cobre
  // /kanbans/[id] — tarefa mudada em outra superfície força o re-render aqui.
  useDataChanged(() => router.refresh());

  // Persistência das colunas (spread completo do settings — updateBoardSettings
  // sobrescreve o jsonb inteiro).
  const persistKanban = async (next: KanbanSettings) => {
    const res = await updateBoardSettings(boardId, {
      ...settings,
      kanban: next,
    });
    if (res.ok) router.refresh();
    return res;
  };

  // ---- Agenda (3ª visão): fetch deferido do range visível ----
  const [agendaAnchor, setAgendaAnchor] = useState(todayBrasiliaIso());
  const [agendaView, setAgendaView] = useState<AgendaViewMode>("month");
  const [agendaResult, setAgendaResult] = useState<AgendaResult | null>(null);
  const reloadAgenda = useCallback(() => {
    const range =
      agendaView === "week"
        ? { from: weekOf(agendaAnchor)[0], to: weekOf(agendaAnchor)[6] }
        : (() => {
            const weeks = monthGrid(agendaAnchor);
            return { from: weeks[0][0], to: weeks[weeks.length - 1][6] };
          })();
    void fetchBoardAgenda(boardId, range.from, range.to).then(setAgendaResult);
  }, [boardId, agendaAnchor, agendaView]);
  useEffect(() => {
    if (view !== "agenda") return;
    reloadAgenda();
  }, [view, reloadAgenda]);

  const periodo = searchParams.get("periodo") ?? "";
  const de = searchParams.get("de") ?? "";
  const ate = searchParams.get("ate") ?? "";

  function setPeriod(next: { periodo?: string; de?: string; ate?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    const apply = (key: string, v: string | undefined) => {
      if (v) params.set(key, v);
      else params.delete(key);
    };
    apply("periodo", next.periodo);
    apply("de", next.de);
    apply("ate", next.ate);
    router.replace(`${pathname}?${params.toString()}`);
  }

  // Pré-preenchimento do quick-create por coluna (modo registros): valor do
  // campo, ou data concreta calculada do bucket.
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
    const field = kanban.groupField ?? "stage";
    if (colKey === KANBAN_NO_VALUE_KEY) return {};
    const key = field.startsWith("custom:")
      ? `custom__${field.slice("custom:".length)}`
      : `core__${field}`;
    return { [key]: colKey };
  }

  const columnExtra = (col: KanbanColumnCards) => {
    if (isTasks && taskCtx) {
      return (
        <TaskSheet
          ctx={taskCtx}
          defaults={{
            boardId,
            phase: col.key,
            locked: kanban.tasks?.lockByDefault,
          }}
          triggerLabel={`Nova tarefa em ${col.label}`}
          iconTrigger
        />
      );
    }
    if (!quickCreateSource) return null;
    const defaults = quickCreateDefaults(col.key);
    if (!defaults) return null;
    return (
      <RecordCreateSheet
        source={quickCreateSource}
        fields={recordCtx.fields}
        responsibles={recordCtx.responsibles}
        operations={recordCtx.operations}
        userRoles={recordCtx.userRoles}
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
    return moveTaskPhase(payload.cardId, targetKey, Boolean(targetCol.completesTask));
  }

  const listTasks: TaskRow[] = isTasks
    ? data.columns.flatMap((c) => c.cards.map((card) => card.task!)).filter(Boolean)
    : [];

  // Aparência do seletor de visão (as "abas" do kanban).
  const sw = kanban.appearance?.switcher;
  const swStyle = (active: boolean): React.CSSProperties => ({
    background: active ? sw?.activeBg : sw?.inactiveBg,
    color: active ? sw?.activeText : sw?.inactiveText,
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* pr-8: afasta a toolbar do sino fixo (TaskBell, topo-direito) */}
      <div className="flex flex-wrap items-center justify-between gap-3 pr-8">
        <h1 className="text-2xl font-semibold">{boardName}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* Visões */}
          <div className="flex rounded-md border p-0.5">
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 gap-1 px-2", view === "kanban" && "bg-muted")}
              style={swStyle(view === "kanban")}
              onClick={() => setView("kanban")}
              aria-pressed={view === "kanban"}
            >
              <SquareKanban className="size-4" />
              Kanban
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 gap-1 px-2", view === "lista" && "bg-muted")}
              style={swStyle(view === "lista")}
              onClick={() => setView("lista")}
              aria-pressed={view === "lista"}
            >
              <List className="size-4" />
              Lista
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 gap-1 px-2", view === "agenda" && "bg-muted")}
              style={swStyle(view === "agenda")}
              onClick={() => setView("agenda")}
              aria-pressed={view === "agenda"}
            >
              <CalendarDays className="size-4" />
              Agenda
            </Button>
          </div>

          {/* Período (modo registros; tarefas usam o vencimento nos destaques) */}
          {!isTasks ? (
            <>
              <Combobox
                options={PERIOD_OPTIONS}
                value={periodo}
                onValueChange={(v) => setPeriod({ periodo: v, de: "", ate: "" })}
                searchable={false}
                className="w-40"
                aria-label="Período"
              />
              {/* Rascunho: digitar não navega; o commit navega UMA vez
                  (intervalo completo auto, ou aberto via "Aplicar"). */}
              <PeriodRangeDraft
                compact
                de={de}
                ate={ate}
                onCommit={({ de: nextDe, ate: nextAte }) =>
                  setPeriod({ periodo: "", de: nextDe, ate: nextAte })
                }
              />
            </>
          ) : null}

          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1"
            title="Exportar CSV"
            onClick={() => {
              const labels = {
                responsibles: Object.fromEntries(
                  recordCtx.responsibles.map((r) => [r.id, r.label])
                ),
                operations: Object.fromEntries(
                  recordCtx.operations.map((o) => [o.id, o.label])
                ),
              };
              const { headers, rows } = kanbanBoardToCsv(
                data,
                recordCtx.fields,
                labels
              );
              downloadCsv(csvFilename(boardName), buildCsv(headers, rows));
            }}
          >
            <Download className="size-4" />
            Exportar CSV
          </Button>

          {canConfig ? (
            <>
              <ColumnConfigPopover
                kanban={kanban}
                data={data}
                onSave={(next) =>
                  updateBoardSettings(boardId, { ...settings, kanban: next })
                }
              />
              <BoardAppearancePopover boardId={boardId} settings={settings} />
            </>
          ) : null}

          {isTasks && taskCtx ? (
            <TaskSheet
              ctx={taskCtx}
              defaults={{ boardId, locked: kanban.tasks?.lockByDefault }}
            />
          ) : quickCreateSource ? (
            <RecordCreateSheet
              source={quickCreateSource}
              fields={recordCtx.fields}
              responsibles={recordCtx.responsibles}
              operations={recordCtx.operations}
              userRoles={recordCtx.userRoles}
            />
          ) : null}
        </div>
      </div>

      {view === "kanban" ? (
        <KanbanBoard
          data={data}
          settings={kanban}
          canMove={isTasks || isCustom || recordCtx.canEditValues}
          recordCtx={recordCtx}
          taskCtx={isTasks ? taskCtx : undefined}
          onMove={isTasks ? onMoveTask : undefined}
          columnExtra={columnExtra}
          owner={{ kind: "board", id: boardId }}
          canReorderColumns={canConfig}
          onReorderColumns={
            canConfig
              ? (keys) =>
                  persistKanban({
                    ...kanban,
                    columns: reorderColumnOverrides(kanban, keys),
                  })
              : undefined
          }
          onAddColumn={
            canConfig && (isTasks || isCustom)
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
      ) : view === "agenda" ? (
        <AgendaView
          anchor={agendaAnchor}
          view={agendaView}
          data={agendaResult?.data ?? null}
          recordCtx={recordCtx}
          taskCtx={
            taskCtx ?? {
              responsibles: recordCtx.responsibles,
              canAssignOthers: false,
              canLock: false,
            }
          }
          onNavigate={setAgendaAnchor}
          onViewChange={setAgendaView}
          onChanged={reloadAgenda}
        />
      ) : isTasks && taskCtx ? (
        <TaskList
          tasks={listTasks}
          ctx={taskCtx}
          responsibleLabels={responsibleLabels}
          emptyMessage="Nenhuma tarefa neste quadro."
        />
      ) : (
        <KanbanList
          data={data}
          recordCtx={recordCtx}
          appearance={kanban.appearance}
        />
      )}
    </div>
  );
}
