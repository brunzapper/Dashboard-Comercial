// Versão: 1.1 | Data: 28/07/2026
// v1.1 (28/07/2026): colunas dos badges do card (métricas expandidas) entre a
//   métrica e as colunas core — só quando configurados (quadro legado segue
//   byte-idêntico); valor null (fato indisponível) sai vazio.
// Export CSV de um kanban (página dedicada e widget): achata as colunas do
// KanbanBoardData JÁ computado (sem nova consulta) — Coluna, Título, campos
// extras do card (como exibidos), métrica, badges e, no modo registros, as
// colunas core do registro na convenção reimportável
// (lib/export/record-cells.ts).
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
  // Badges configurados (mesma ordem em todos os cards — config do board).
  const badgeLabels =
    flat
      .find((x) => (x.card.badges ?? []).length > 0)
      ?.card.badges?.map((b) => b.label) ?? [];
  const hasRecords = flat.some((x) => x.card.record);
  const headers = [
    "Coluna",
    "Título",
    ...fieldLabels,
    ...(data.metricLabel ? [data.metricLabel] : []),
    ...badgeLabels,
    ...(hasRecords ? CORE_REFS.map((ref) => recordRefLabel(ref, defs)) : []),
  ];
  const rows = flat.map(({ card, column }) => [
    column,
    card.title,
    ...fieldLabels.map((_, i) => card.fields[i]?.value ?? ""),
    ...(data.metricLabel ? [csvNumber(card.metricValue)] : []),
    ...badgeLabels.map((_, i) => csvNumber(card.badges?.[i]?.value ?? null)),
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
