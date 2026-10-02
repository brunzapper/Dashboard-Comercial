// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): TABELA DE SLIDE da Tabela Livre — a marcação da antiga
//   Tabela de metas (goal-table-widget v1.2), agora renderizando a MESMA
//   matriz da Tabela Livre (lib/widgets/quick-table/model.ts). Liga quando a
//   tabela tem `quickTable.display` e não está em "Editar layout" (no Editar
//   layout fica a grade de planilha, onde se monta a estrutura).
//
// Paridade: tamanhos em `em` sobre 14px × escala, densidade ("preencher"
// reparte a altura; as outras usam `table-fixed` + coluna do rótulo em 34%),
// cabeçalho em faixa (Clássico) ou em linha, `border-b`, zebra pelo estilo,
// ênfase da linha em negrito (filete + 1,08em) e a linha de total com filete —
// tudo idêntico ao widget antigo. Colunas livres/dimensão/métrica da Tabela
// Livre aparecem como texto, no mesmo ritmo.
"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatIndicatorValue, rollupMonths } from "@/lib/indicators/model";
import type { QTCell, QTMatrix, QTRow } from "@/lib/widgets/quick-table/model";
import { GoalCellBody, GoalRowLabel, type GoalDisplayKit } from "./goal-cells";

export function GoalPresentationTable({
  matrix,
  kit,
  fontScale,
  presenting,
  refreshing,
  note,
  goalMonths,
  displayOf,
  editingKey,
  pendingKeys,
  onStartEdit,
  onCommit,
  onCancel,
}: {
  matrix: QTMatrix;
  kit: GoalDisplayKit;
  fontScale: number;
  presenting: boolean;
  refreshing: boolean;
  note?: string;
  /** União dos meses (alinhamento da quebra do realizado). */
  goalMonths: string[];
  /** Texto de células não-meta (fórmulas "=…" já avaliadas). */
  displayOf: (cell: QTCell) => string;
  editingKey: string | null;
  pendingKeys: ReadonlySet<string>;
  onStartEdit: (key: string) => void;
  onCommit: (rowKey: string, month: string, raw: string) => void;
  onCancel: () => void;
}) {
  const [openBreakdown, setOpenBreakdown] = useState<Set<string>>(() => new Set());
  const { disp, styled, fill, cellPad } = kit;
  const cols = matrix.cols;
  const lastCol = cols.length - 1;
  const alignOf = (ci: number): "left" | "right" => {
    const k = cols[ci]?.column.kind;
    return k === "goal" || k === "goalTotal" || k === "metric" ? "right" : "left";
  };
  const firstLabelIdx = cols.findIndex((c) => c.column.kind === "rowLabel");

  const renderCell = (row: QTRow, cell: QTCell, ci: number, emphasisStyle?: React.CSSProperties) => {
    const right = alignOf(ci) === "right";
    if (cell.content === "label" && row.goal) {
      const bd = row.goal.breakdown;
      const open = bd && (bd.display === "exposto" || openBreakdown.has(row.key));
      return (
        <td key={cell.colKey} className={cn("border-b align-middle", cellPad)} style={emphasisStyle}>
          <GoalRowLabel kit={kit} row={row.goal} presenting={presenting} />
          {bd && bd.display === "recolhido" ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground mt-0.5 flex items-center gap-0.5 text-[0.75em] font-normal"
              onClick={() =>
                setOpenBreakdown((prev) => {
                  const next = new Set(prev);
                  if (next.has(row.key)) next.delete(row.key);
                  else next.add(row.key);
                  return next;
                })
              }
            >
              {open ? <ChevronDown className="size-[1em]" /> : <ChevronRight className="size-[1em]" />}
              por {bd.label}
            </button>
          ) : null}
        </td>
      );
    }
    if (cell.content === "goal" && cell.goal) {
      const v = cell.goal;
      const key = `${row.key}|${v.month ?? ""}`;
      return (
        <td
          key={cell.colKey}
          className={cn("border-b text-right align-middle tabular-nums", cellPad)}
          style={emphasisStyle}
        >
          <GoalCellBody
            kit={kit}
            view={v}
            rowHasRealized={row.goal?.hasRealized ?? false}
            editing={editingKey === key}
            pending={pendingKeys.has(key)}
            onStartEdit={() => onStartEdit(key)}
            onCommit={(raw) => v.month && onCommit(row.key, v.month, raw)}
            onCancel={onCancel}
          />
        </td>
      );
    }
    return (
      <td
        key={cell.colKey}
        className={cn("border-b align-middle", right && "text-right tabular-nums", cellPad)}
        style={emphasisStyle}
      >
        {displayOf(cell)}
      </td>
    );
  };

  return (
    <div
      className={cn("relative flex h-full flex-col gap-2 overflow-auto", refreshing && "opacity-70")}
      style={{ fontSize: kit.fontSizeFor(fontScale) }}
    >
      {refreshing ? (
        <div className="text-muted-foreground absolute top-1 right-1 flex items-center gap-1 text-[0.85em]">
          <Loader2 className="size-3 animate-spin" /> Atualizando…
        </div>
      ) : null}
      <table className={cn("w-full border-separate border-spacing-0", fill ? "h-full flex-1" : "table-fixed")}>
        {!fill && firstLabelIdx === 0 ? (
          <colgroup>
            <col style={{ width: "34%" }} />
          </colgroup>
        ) : null}
        {matrix.headerRow ? (
          <thead>
            <tr className="h-px">
              {cols.map((c, ci) => (
                <th
                  key={c.key}
                  // Canto direito arredondado só quando a última coluna NÃO é
                  // um mês (o widget antigo arredondava só o "Total").
                  className={kit.thClass(
                    alignOf(ci),
                    ci === 0 ? "l" : ci === lastCol && !c.goalMonth ? "r" : undefined
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {matrix.rows.map((row) => {
            const g = row.goal;
            if (g?.isTotal) {
              const ruled = styled ? { borderTop: "1px solid var(--foreground)" } : undefined;
              return (
                <tr key={row.key} className={cn(g.bold && "font-semibold")}>
                  {row.cells.map((cell, ci) =>
                    cell.content === "label" ? (
                      <td key={cell.colKey} className={cellPad} style={ruled}>
                        {g.label}
                      </td>
                    ) : (
                      <td
                        key={cell.colKey}
                        className={cn(alignOf(ci) === "right" && "text-right tabular-nums", cellPad)}
                        style={ruled}
                      >
                        {cell.content === "goal" && cell.goal
                          ? formatIndicatorValue(cell.goal.target, cell.goal.unit, kit.valueOpts)
                          : displayOf(cell)}
                      </td>
                    )
                  )}
                </tr>
              );
            }
            // Linha em destaque (a conclusão) num board com estilo — filete
            // em cima e corpo um pouco maior, além do peso.
            const emphasis = styled && g?.bold;
            const emphasisStyle = emphasis
              ? { borderTop: "1px solid var(--foreground)", fontSize: "1.08em" }
              : undefined;
            const bd = g?.breakdown;
            const showBd = bd && (bd.display === "exposto" || openBreakdown.has(row.key));
            return (
              <Fragment key={row.key}>
                <tr className={cn(g?.bold && "font-semibold", disp.zebra && "even:bg-muted/70")}>
                  {row.cells.map((cell, ci) => renderCell(row, cell, ci, emphasisStyle))}
                </tr>
                {showBd
                  ? bd.rows.map((b) => (
                      <tr key={`${row.key}~b~${b.label}`} className="text-muted-foreground text-[0.85em]">
                        {row.cells.map((cell, ci) => {
                          const col = cols[ci];
                          if (cell.content === "label") {
                            return (
                              <td key={cell.colKey} className={cn("border-b pl-6", cellPad)}>
                                ↳ {b.label}
                              </td>
                            );
                          }
                          let v: number | null = null;
                          if (col.goalMonth) {
                            const mi = goalMonths.indexOf(col.goalMonth);
                            v = mi >= 0 ? (b.realized[mi] ?? null) : null;
                          } else if (col.column.kind === "goalTotal") {
                            v = rollupMonths(b.realized, "soma");
                          }
                          return (
                            <td key={cell.colKey} className={cn("border-b text-right tabular-nums", cellPad)}>
                              {col.goalMonth || col.column.kind === "goalTotal"
                                ? formatIndicatorValue(v, g!.unit, kit.valueOpts)
                                : ""}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {note ? (
        <p
          className={cn(
            "text-muted-foreground shrink-0 px-1 text-[0.85em] whitespace-pre-line",
            styled && "border-t pt-2"
          )}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}
