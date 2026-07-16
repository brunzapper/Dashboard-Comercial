// Versão: 1.0 | Data: 16/07/2026
// Kanban de TAREFAS: mapeia tasks (agrupadas por `phase`) no mesmo shape do
// quadro de registros (KanbanBoardData) — o componente KanbanBoard renderiza
// os dois; cards de tarefa carregam a TaskRow p/ o card exibir prazo/concluir.
// Fase desconhecida (coluna excluída da config) cai na primeira coluna.
import { deriveColumns } from "@/lib/kanban/columns";
import type {
  KanbanBoardData,
  KanbanCard,
  KanbanColumnCards,
} from "@/lib/kanban/data";
import type { KanbanSettings } from "@/lib/kanban/types";
import type { TaskRow } from "./types";

export function taskBoardData(
  tasks: TaskRow[],
  settings: KanbanSettings,
  responsibleLabels: Record<string, string> = {}
): KanbanBoardData {
  const columns = deriveColumns(
    settings,
    tasks.map((t) => t.phase),
    null
  );
  const fallbackKey = columns[0]?.key ?? "a_fazer";

  const byColumn = new Map<string, KanbanCard[]>(columns.map((c) => [c.key, []]));
  const sorted = [...tasks].sort(
    (a, b) =>
      a.position - b.position ||
      (a.created_at < b.created_at ? 1 : -1)
  );
  for (const t of sorted) {
    const key = byColumn.has(t.phase) ? t.phase : fallbackKey;
    const card: KanbanCard = {
      id: t.id,
      title: t.title,
      columnKey: key,
      groupKey: t.phase,
      dateValue: t.due_date,
      colorValue: null,
      fields: [],
      metricValue: null,
      isMock: false,
      openTasks: 0,
      task: {
        ...t,
        responsible_label: t.responsible_id
          ? (responsibleLabels[t.responsible_id] ?? null)
          : null,
      },
    };
    byColumn.get(key)?.push(card);
  }

  const columnCards: KanbanColumnCards[] = columns.map((c) => {
    const cards = byColumn.get(c.key) ?? [];
    return { ...c, cards, count: cards.length, metricSum: null };
  });

  return {
    mode: "tarefas",
    columns: columnCards,
    metricLabel: null,
    metricIsMoney: false,
  };
}
