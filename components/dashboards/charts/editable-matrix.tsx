// Versão: 1.0 | Data: 10/07/2026
// Fase 2: render do widget "Tabela editável". Grade linhas×colunas nomeadas com
// um input por célula. Valores são dashboard-scoped (dashboard_table_cells), não
// gravam nos registros, e são editáveis por qualquer visualizador. Cada célula
// salva otimista via saveTableCell + router.refresh() (mesmo padrão da
// EditableCell de Registros).
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { MatrixAxis } from "@/lib/widgets/types";
import { cellKey } from "@/lib/widgets/matrix";
import { saveTableCell } from "@/app/(app)/dashboards/actions";

function MatrixCell({
  dashboardId,
  widgetId,
  rowKey,
  colKey,
  cellType,
  serverValue,
}: {
  dashboardId: string;
  widgetId: string;
  rowKey: string;
  colKey: string;
  cellType: "numero" | "texto";
  serverValue: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(serverValue);
  const savedRef = useRef(serverValue);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(serverValue);
    savedRef.current = serverValue;
  }, [serverValue]);

  function commit(raw: string) {
    if (raw === savedRef.current) return;
    setValue(raw);
    setError(false);
    const payload: number | string | null =
      raw === ""
        ? null
        : cellType === "numero"
          ? Number(raw.replace(",", "."))
          : raw;
    // Número inválido: reverte e não grava.
    if (cellType === "numero" && payload != null && !Number.isFinite(payload)) {
      setValue(savedRef.current);
      setError(true);
      return;
    }
    startTransition(async () => {
      const res = await saveTableCell(dashboardId, widgetId, rowKey, colKey, payload);
      if (res.ok) {
        savedRef.current = raw;
        router.refresh();
      } else {
        setValue(savedRef.current);
        setError(true);
      }
    });
  }

  return (
    <Input
      type={cellType === "numero" ? "number" : "text"}
      step={cellType === "numero" ? "any" : undefined}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      disabled={pending}
      aria-label={`${rowKey} ${colKey}`}
      aria-invalid={error}
      className={cn(
        "h-8",
        cellType === "numero" && "text-right",
        error && "border-destructive"
      )}
    />
  );
}

export function EditableMatrix({
  dashboardId,
  widgetId,
  matrix,
  cells,
}: {
  dashboardId: string;
  widgetId: string;
  matrix?: { rows: MatrixAxis[]; cols: MatrixAxis[]; cellType?: "numero" | "texto" };
  cells: Record<string, unknown>;
}) {
  const rows = matrix?.rows ?? [];
  const cols = matrix?.cols ?? [];
  const cellType = matrix?.cellType ?? "numero";

  if (rows.length === 0 || cols.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-2 text-center text-sm">
        Defina linhas e colunas no editor do widget.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="bg-muted/40 sticky left-0" />
            {cols.map((c) => (
              <TableHead key={c.key} className="text-right whitespace-nowrap">
                {c.label || "—"}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="bg-muted/40 sticky left-0 font-medium whitespace-nowrap">
                {r.label || "—"}
              </TableCell>
              {cols.map((c) => {
                const v = cells[cellKey(r.key, c.key)];
                return (
                  <TableCell key={c.key} className="p-1">
                    <MatrixCell
                      dashboardId={dashboardId}
                      widgetId={widgetId}
                      rowKey={r.key}
                      colKey={c.key}
                      cellType={cellType}
                      serverValue={v == null ? "" : String(v)}
                    />
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
