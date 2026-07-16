// Versão: 1.0 | Data: 16/07/2026
// Montagem dos dados da AGENDA: registros da fonte alocados no dia pelo campo
// de data escolhido (runRecordList com período = range visível — RLS/mocks
// como nos widgets) + tarefas por vencimento (RLS escopa o vendedor). Falha
// silenciosa em `tasks` (pré-migração/snapshot) não derruba o calendário.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { RecordRow } from "@/lib/records/types";
import { runRecordList } from "@/lib/widgets/record-list";
import type { WidgetConfig } from "@/lib/widgets/types";
import { TASK_COLS_WITH_RECORD, type TaskRow } from "@/lib/tasks/types";
import { resolveRecordRef } from "@/lib/kanban/data";
import type { AgendaData, AgendaItem, AgendaSettings } from "./types";

export async function runAgenda(
  supabase: SupabaseClient,
  settings: AgendaSettings,
  range: { from: string; to: string },
  responsibleLabels: Record<string, string> = {},
  // Snapshot público: nunca consulta `tasks` (dados privados).
  opts: { includeTasks?: boolean } = {}
): Promise<AgendaData> {
  const items: AgendaItem[] = [];

  // ---- registros da fonte, alocados pelo campo de data ----
  if (settings.source && settings.dateField) {
    const config: WidgetConfig = {
      sources: [settings.source],
      dimensions: [],
      metrics: [],
      filters: [],
      settings: {},
    } as unknown as WidgetConfig;
    const records = await runRecordList(supabase, config, {
      field: settings.dateField,
      from: range.from,
      to: range.to,
    });
    for (const r of records as RecordRow[]) {
      const raw = resolveRecordRef(r, settings.dateField);
      const date = raw == null ? "" : String(raw).slice(0, 10);
      if (!date || date < range.from || date > range.to) continue;
      items.push({
        id: r.id,
        kind: "record",
        date,
        title: r.title ?? "(sem nome)",
        record: r,
      });
    }
  }

  // ---- tarefas por vencimento ----
  if (opts.includeTasks !== false && settings.showTasks !== false) {
    try {
      const { data } = await supabase
        .from("tasks")
        .select(TASK_COLS_WITH_RECORD)
        .not("due_date", "is", null)
        .gte("due_date", range.from)
        .lte("due_date", range.to)
        .order("due_time", { ascending: true, nullsFirst: false })
        .limit(500);
      for (const t of (data ?? []) as unknown as TaskRow[]) {
        items.push({
          id: t.id,
          kind: "task",
          date: (t.due_date as string).slice(0, 10),
          title: t.title,
          task: {
            ...t,
            responsible_label: t.responsible_id
              ? (responsibleLabels[t.responsible_id] ?? null)
              : null,
          },
        });
      }
    } catch {
      // sem tarefas — calendário segue só com registros
    }
  }

  return { from: range.from, to: range.to, items };
}
