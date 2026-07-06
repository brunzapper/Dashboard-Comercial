// Versão: 1.0 | Data: 05/07/2026
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
import { Badge } from "@/components/ui/badge";
import {
  RECORD_TYPE_LABELS,
  type FieldDefinition,
  type OptionItem,
  type RecordRow,
} from "@/lib/records/types";
import { RecordEditSheet } from "./record-edit-sheet";

function money(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function RecordsTable({
  records,
  fields,
  responsibles,
  operations,
  relatedLeadLabels,
  userRoles,
  canEditValues,
}: {
  records: RecordRow[];
  fields: FieldDefinition[];
  responsibles: OptionItem[];
  operations: OptionItem[];
  relatedLeadLabels: Record<string, string>;
  userRoles: string[];
  canEditValues: boolean;
}) {
  const responsibleMap = new Map(responsibles.map((r) => [r.id, r.label]));

  if (records.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border p-8 text-center text-sm">
        Nenhum registro encontrado com os filtros atuais.
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Título</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Etapa</TableHead>
            <TableHead>Responsável</TableHead>
            <TableHead className="text-right">MRR</TableHead>
            <TableHead className="text-right">Valor</TableHead>
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
              <TableCell>
                <Badge variant="secondary">
                  {RECORD_TYPE_LABELS[r.record_type]}
                </Badge>
              </TableCell>
              <TableCell>{r.stage ?? "—"}</TableCell>
              <TableCell>
                {r.responsible_id
                  ? responsibleMap.get(r.responsible_id) ?? "—"
                  : "—"}
              </TableCell>
              <TableCell className="text-right">{money(r.mrr)}</TableCell>
              <TableCell className="text-right">{money(r.value)}</TableCell>
              {fields.map((f) => (
                <TableCell key={f.id} className="max-w-[160px] truncate">
                  {r.custom_fields?.[f.field_key] != null
                    ? String(r.custom_fields[f.field_key])
                    : "—"}
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
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
