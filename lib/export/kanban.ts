// Versão: 1.0 | Data: 17/07/2026
// Export CSV de um kanban (página dedicada e widget): achata as colunas do
// KanbanBoardData JÁ computado (sem nova consulta) — Coluna, Título, campos
// extras do card (como exibidos), métrica e, no modo registros, as colunas
// core do registro na convenção reimportável (lib/export/record-cells.ts).
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import type { KanbanBoardData } from "@/lib/kanban/data";
import { csvNumber } from "@/lib/export/csv";
import {
  recordCellValue,
  recordRefLabel,
  type RecordLabels,
} from "@/lib/export/record-cells";

// Sem "title" (já é a coluna Título) e sem related_lead_id (rótulo do lead não
// está disponível nos hosts de kanban).
const CORE_REFS = [
  "pipeline",
  "stage",
  "value",
  "mrr",
  "currency",
  "sale_type",
  "channel",
  "closed",
  "closed_at",
  "opened_at",
  "source_created_at",
  "responsible_id",
  "operation_id",
  "lead_time_days",
] as const;

export function kanbanBoardToCsv(
  data: KanbanBoardData,
  defs: FieldDefinition[],
  labels: RecordLabels
): { headers: string[]; rows: string[][] } {
  const flat = data.columns.flatMap((c) =>
    c.cards.map((card) => ({ card, column: c.label }))
  );
  const fieldLabels =
    flat
      .find((x) => x.card.fields.length > 0)
      ?.card.fields.map((f) => f.label) ?? [];
  const hasRecords = flat.some((x) => x.card.record);
  const headers = [
    "Coluna",
    "Título",
    ...fieldLabels,
    ...(data.metricLabel ? [data.metricLabel] : []),
    ...(hasRecords ? CORE_REFS.map((ref) => recordRefLabel(ref, defs)) : []),
  ];
  const rows = flat.map(({ card, column }) => [
    column,
    card.title,
    ...fieldLabels.map((_, i) => card.fields[i]?.value ?? ""),
    ...(data.metricLabel ? [csvNumber(card.metricValue)] : []),
    ...(hasRecords
      ? CORE_REFS.map((ref) =>
          card.record
            ? recordCellValue(card.record as RecordRow, ref, defs, labels, {
                csv: true,
              })
            : ""
        )
      : []),
  ]);
  return { headers, rows };
}
