// Versão: 1.1 | Data: 09/07/2026
// v1.1 (09/07/2026): Fase 8 — recebe a `source` (aba) e mostra só as colunas do
//   núcleo adequadas: Pipeline só em Deals; MRR em Deals/Estudo (não em Leads).
//   A coluna "Tipo" saiu (redundante dentro de uma aba de fonte).
// Tabela de registros com colunas do núcleo + campos personalizados visíveis;
// cada linha abre o painel de edição (RecordEditSheet).
"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FieldDefinition, OptionItem, RecordRow } from "@/lib/records/types";
import type { SourceKey } from "@/lib/sources";
import { formatMoney } from "@/lib/widgets/currency";
import { EditableCell } from "./editable-cell";
import { RecordEditSheet } from "./record-edit-sheet";

export function RecordsTable({
  source,
  records,
  fields,
  responsibles,
  operations,
  relatedLeadLabels,
  userRoles,
  canEditValues,
  canManageFields,
}: {
  source: SourceKey;
  records: RecordRow[];
  fields: FieldDefinition[];
  responsibles: OptionItem[];
  operations: OptionItem[];
  relatedLeadLabels: Record<string, string>;
  userRoles: string[];
  canEditValues: boolean;
  canManageFields: boolean;
}) {
  const responsibleMap = new Map(responsibles.map((r) => [r.id, r.label]));
  const showPipeline = source === "deals";
  const showMrr = source === "deals" || source === "estudo";

  if (records.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border p-8 text-center text-sm">
        Nenhum registro encontrado com os filtros atuais.
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Título</TableHead>
            {showPipeline ? <TableHead>Pipeline</TableHead> : null}
            <TableHead>Etapa</TableHead>
            <TableHead>Responsável</TableHead>
            {showMrr ? <TableHead className="text-right">MRR</TableHead> : null}
            <TableHead className="text-right">Valor</TableHead>
            <TableHead>Moeda</TableHead>
            {fields.map((f) => (
              <TableHead key={f.id}>{f.label}</TableHead>
            ))}
            <TableHead className="text-right">Editar</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="max-w-[220px] truncate font-medium">
                {r.title ?? "—"}
              </TableCell>
              {showPipeline ? (
                <TableCell>{r.pipeline ?? "—"}</TableCell>
              ) : null}
              <TableCell>{r.stage ?? "—"}</TableCell>
              <TableCell>
                {r.responsible_id
                  ? responsibleMap.get(r.responsible_id) ?? "—"
                  : "—"}
              </TableCell>
              {showMrr ? (
                <TableCell className="text-right">
                  {formatMoney(r.mrr, r.currency)}
                </TableCell>
              ) : null}
              <TableCell className="text-right">
                {formatMoney(r.value, r.currency)}
              </TableCell>
              <TableCell>{r.currency ?? "—"}</TableCell>
              {fields.map((f) => (
                <TableCell key={f.id} className="max-w-[180px]">
                  <EditableCell
                    record={r}
                    field={f}
                    userRoles={userRoles}
                    canEditValues={canEditValues}
                    forceSyncWriteBack
                  />
                </TableCell>
              ))}
              <TableCell className="text-right">
                <RecordEditSheet
                  record={r}
                  fields={fields}
                  responsibles={responsibles}
                  operations={operations}
                  relatedLeadLabel={
                    r.related_lead_id
                      ? relatedLeadLabels[r.related_lead_id] ?? null
                      : null
                  }
                  userRoles={userRoles}
                  canEditValues={canEditValues}
                  canManageFields={canManageFields}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
