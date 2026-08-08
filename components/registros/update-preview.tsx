// Versão: 1.0 | Data: 07/08/2026
// Painel de PRÉVIA do contrato registros-update — extraído do ai-update-sheet
// para servir também à edição manual em massa (bulk-edit-sheet): contagem,
// chips de recorte (filtros OU "Seleção manual"), alterações, amostra
// antes→depois, teto e a confirmação explícita + Aplicar/Descartar. Fonte
// única de markup — os dois sheets não podem divergir na prévia.
"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RecordsUpdatePreview } from "@/lib/ai/update-records";

export function UpdatePreviewPanel({
  preview,
  selectionCount,
  confirmed,
  onConfirmedChange,
  applying,
  busy,
  onApply,
  onDiscard,
}: {
  preview: RecordsUpdatePreview;
  /** Modo seleção: contagem selecionada (substitui os chips de filtro). */
  selectionCount?: number;
  confirmed: boolean;
  onConfirmedChange: (v: boolean) => void;
  applying: boolean;
  busy: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const applyBlocked = preview.overCap || preview.total === 0 || !confirmed;
  const selection = selectionCount != null;
  return (
    <div className="rounded-md border border-amber-300/60 bg-amber-50/60 p-3 dark:border-amber-400/30 dark:bg-amber-950/20">
      <p className="mb-1 text-sm font-medium">
        Prévia — {preview.total} registro(s){" "}
        {selection ? "selecionado(s)" : "casam os filtros"}
        {preview.mockCount > 0
          ? ` (${preview.mockCount} de demonstração serão pulados)`
          : ""}
        .
      </p>
      <div className="text-muted-foreground mb-2 flex flex-wrap gap-1 text-xs">
        {selection ? (
          <span className="bg-muted rounded px-1.5 py-0.5">
            Seleção manual: {selectionCount} registro(s)
          </span>
        ) : (
          preview.filterLabels.map((f, i) => (
            <span key={i} className="bg-muted rounded px-1.5 py-0.5">
              {f}
            </span>
          ))
        )}
      </div>
      <ul className="mb-2 text-sm">
        {preview.changeLabels.map((ch) => (
          <li key={ch.key}>
            <span className="font-medium">{ch.label}</span> → {ch.value}
            {ch.sync ? (
              <span className="text-muted-foreground text-xs">
                {" "}
                (campo de Sync — escrita local)
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {preview.sample.length > 0 ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Registro</TableHead>
                {preview.changeLabels.map((ch) => (
                  <TableHead key={ch.key}>{ch.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.sample.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-48 truncate font-medium">
                    {row.title}
                  </TableCell>
                  {row.cells.map((cell) => (
                    <TableCell
                      key={cell.key}
                      className="text-muted-foreground text-xs"
                    >
                      {cell.from} → {cell.to}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {preview.total > preview.sample.length ? (
            <p className="text-muted-foreground mt-1 text-xs">
              Amostra de {preview.sample.length} — a alteração vale para os{" "}
              {preview.total} registro(s) {selection ? "da seleção" : "do recorte"}.
            </p>
          ) : null}
        </div>
      ) : null}
      {preview.overCap ? (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">
          {selection
            ? "Seleção acima do teto — reduza a seleção antes de aplicar."
            : "Recorte acima do teto — peça filtros mais específicos pelo chat antes de aplicar."}
        </p>
      ) : preview.total > 0 ? (
        <label className="mt-2 flex items-center gap-2 text-sm">
          <Checkbox
            checked={confirmed}
            onCheckedChange={(v) => onConfirmedChange(v === true)}
            disabled={applying}
          />
          Confirmo a alteração de {preview.total - preview.mockCount}{" "}
          registro(s)
        </label>
      ) : null}
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          onClick={onApply}
          disabled={applying || busy || applyBlocked}
        >
          {applying ? "Aplicando…" : "Aplicar alteração"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onDiscard}
          disabled={applying}
        >
          Descartar
        </Button>
      </div>
    </div>
  );
}
