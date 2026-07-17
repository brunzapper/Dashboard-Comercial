// Versão: 1.2 | Data: 16/07/2026
// v1.2 (16/07/2026): pan ("mãozinha") no container da tabela via useDragPan —
//   segurar o botão esquerdo e arrastar rola horizontal (container) e vertical
//   (<main>), sem precisar da scrollbar no fim da página. Gestos iniciados em
//   controles interativos (inputs/botões/combobox das células) não armam o pan;
//   cliques simples seguem funcionando pelo limiar de 4px do hook.
// v1.1 (09/07/2026): Fase 8 — recebe a `source` (aba) e mostra só as colunas do
//   núcleo adequadas: Pipeline só em Deals; MRR em Deals/Estudo (não em Leads).
//   A coluna "Tipo" saiu (redundante dentro de uma aba de fonte).
// Tabela de registros com colunas do núcleo + campos personalizados visíveis;
// cada linha abre o painel de edição (RecordEditSheet).
"use client";

import { useMemo, useRef } from "react";

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
import { cn } from "@/lib/utils";
import { useDragPan } from "@/lib/use-drag-pan";
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
  const responsibleMap = useMemo(
    () => new Map(responsibles.map((r) => [r.id, r.label])),
    [responsibles]
  );
  const showPipeline = source === "deals";
  const showMrr = source === "deals" || source === "estudo";

  // Pan: segurar e arrastar em qualquer área da tabela rola nos dois eixos.
  // Controles interativos das linhas (EditableCell, botão Editar) ficam de fora
  // para não roubar seleção de texto em inputs nem o gesto dos dropdowns.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { panning, onPointerDown } = useDragPan(scrollRef, {
    ignore: (t) => !!t.closest("button, a, input, select, textarea, [contenteditable]"),
  });

  if (records.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border p-8 text-center text-sm">
        Nenhum registro encontrado com os filtros atuais.
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onPointerDown={onPointerDown}
      className={cn(
        "rounded-lg border overflow-x-auto",
        panning ? "cursor-grabbing" : "cursor-grab"
      )}
    >
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
