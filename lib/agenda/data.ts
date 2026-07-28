// Versão: 2.0 | Data: 28/07/2026
// Montagem dos dados da AGENDA: registros da fonte alocados no dia pelo campo
// de data escolhido (runRecordList com período = range visível — RLS/mocks
// como nos widgets) + tarefas por vencimento (RLS escopa o vendedor) +
// anotações do dia (agenda_notes, 0111 — RLS org-wide). Falha silenciosa em
// `tasks`/`agenda_notes` (pré-migração/snapshot) não derruba o calendário.
// v2.0 (28/07/2026): itens carregam `time` (HH:MM — prefixo naive do valor
//   bruto nos registros; due_time nas tarefas) p/ ordenação cronológica no
//   client; leg de anotações (gate showNotes/includeNotes); extraFilters
//   (recorte extra dos registros — Workspace) e taskResponsibleIds (recorte
//   de responsável do leg de tarefas, ids JÁ expandidos pelo chamador).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { RecordRow } from "@/lib/records/types";
import { runRecordList } from "@/lib/widgets/record-list";
import type { WidgetConfig, WidgetFilter } from "@/lib/widgets/types";
import { TASK_COLS_WITH_RECORD, type TaskRow } from "@/lib/tasks/types";
import { resolveRecordRef } from "@/lib/kanban/data";
import { extractTimeHHMM } from "./day-items";
import {
  AGENDA_NOTE_COLS,
  type AgendaData,
  type AgendaItem,
  type AgendaNoteRow,
  type AgendaSettings,
} from "./types";

export async function runAgenda(
  supabase: SupabaseClient,
  settings: AgendaSettings,
  range: { from: string; to: string },
  responsibleLabels: Record<string, string> = {},
  opts: {
    // Snapshot público: nunca consulta `tasks` (dados privados).
    includeTasks?: boolean;
    // Idem para anotações (agenda_notes fora de PASSTHROUGH_TABLES).
    includeNotes?: boolean;
    // Recorte extra dos REGISTROS (Workspace: responsável/operação traduzida
    // via operation-scope — nunca operation_id literal).
    extraFilters?: WidgetFilter[];
    // Recorte de responsável do leg de TAREFAS (ids já expandidos).
    taskResponsibleIds?: string[];
  } = {}
): Promise<AgendaData> {
  const items: AgendaItem[] = [];

  // ---- registros da fonte, alocados pelo campo de data ----
  if (settings.source && settings.dateField) {
    const config: WidgetConfig = {
      sources: [settings.source],
      dimensions: [],
      metrics: [],
      filters: opts.extraFilters ?? [],
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
        time: extractTimeHHMM(raw),
        title: r.title ?? "(sem nome)",
        record: r,
      });
    }
  }

  // ---- tarefas por vencimento ----
  if (opts.includeTasks !== false && settings.showTasks !== false) {
    try {
      let query = supabase
        .from("tasks")
        .select(TASK_COLS_WITH_RECORD)
        .not("due_date", "is", null)
        .gte("due_date", range.from)
        .lte("due_date", range.to);
      if (opts.taskResponsibleIds && opts.taskResponsibleIds.length > 0) {
        query = query.in("responsible_id", opts.taskResponsibleIds);
      }
      const { data } = await query
        .order("due_time", { ascending: true, nullsFirst: false })
        .limit(500);
      for (const t of (data ?? []) as unknown as TaskRow[]) {
        items.push({
          id: t.id,
          kind: "task",
          date: (t.due_date as string).slice(0, 10),
          time: t.due_time ? t.due_time.slice(0, 5) : null,
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

  // ---- anotações do dia (post-its) ----
  if (opts.includeNotes !== false && settings.showNotes !== false) {
    try {
      const { data } = await supabase
        .from("agenda_notes")
        .select(AGENDA_NOTE_COLS)
        .gte("note_date", range.from)
        .lte("note_date", range.to)
        .order("created_at", { ascending: true })
        .limit(500);
      for (const n of (data ?? []) as unknown as AgendaNoteRow[]) {
        items.push({
          id: n.id,
          kind: "note",
          date: n.note_date.slice(0, 10),
          time: null,
          title: n.body,
          note: n,
        });
      }
    } catch {
      // sem anotações (pré-0111) — calendário segue
    }
  }

  return { from: range.from, to: range.to, items };
}
