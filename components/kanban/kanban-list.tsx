// Versão: 1.0 | Data: 16/07/2026
// Visão LISTA do kanban: os mesmos cards do quadro numa tabela (coluna do
// quadro, título, campos extras do card, métrica e edição). Compartilhada
// entre a página dedicada e o widget.
"use client";

import { formatMoney } from "@/lib/widgets/currency";
import type { KanbanBoardData } from "@/lib/kanban/data";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RecordEditSheet } from "@/components/registros/record-edit-sheet";
import type { KanbanRecordContext } from "./kanban-board";

export function KanbanList({
  data,
  recordCtx,
}: {
  data: KanbanBoardData;
  recordCtx: KanbanRecordContext;
}) {
  // Rótulos dos campos extras (iguais em todos os cards — config do board).
  const extraLabels = data.columns
    .flatMap((c) => c.cards)
    .find((c) => c.fields.length > 0)
    ?.fields.map((f) => f.label) ?? [];

  const rows = data.columns.flatMap((col) =>
    col.cards.map((card) => ({ col, card }))
  );

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Coluna</TableHead>
            <TableHead>Nome</TableHead>
            {extraLabels.map((l) => (
              <TableHead key={l}>{l}</TableHead>
            ))}
            {data.metricLabel ? (
              <TableHead className="text-right">{data.metricLabel}</TableHead>
            ) : null}
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={3 + extraLabels.length}
                className="text-muted-foreground text-center text-sm"
              >
                Nenhum registro.
              </TableCell>
            </TableRow>
          ) : (
            rows.map(({ col, card }) => (
              <TableRow key={card.id}>
                <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                  {col.label}
                </TableCell>
                <TableCell className="font-medium">{card.title}</TableCell>
                {extraLabels.map((label, i) => (
                  <TableCell key={label} className="text-sm">
                    {card.fields[i]?.value ?? "—"}
                  </TableCell>
                ))}
                {data.metricLabel ? (
                  <TableCell className="text-right text-sm">
                    {card.metricValue == null
                      ? "—"
                      : data.metricIsMoney
                        ? formatMoney(card.metricValue, null)
                        : new Intl.NumberFormat("pt-BR", {
                            maximumFractionDigits: 2,
                          }).format(card.metricValue)}
                  </TableCell>
                ) : null}
                <TableCell>
                  {card.record ? (
                    <RecordEditSheet
                      record={card.record}
                      fields={recordCtx.fields}
                      responsibles={recordCtx.responsibles}
                      operations={recordCtx.operations}
                      relatedLeadLabel={null}
                      userRoles={recordCtx.userRoles}
                      canEditValues={recordCtx.canEditValues}
                      canManageFields={recordCtx.canManageFields}
                    />
                  ) : null}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
