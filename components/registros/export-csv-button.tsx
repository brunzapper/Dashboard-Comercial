"use client";
// Versão: 1.0 | Data: 17/07/2026
// Botão "Exportar CSV" do header de /registros: chama a server action com os
// filtros atuais (os mesmos da listagem) e baixa o arquivo no browser.
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { buildCsv, csvFilename, downloadCsv } from "@/lib/export/csv";
import {
  exportRecordsCsv,
  type ExportRecordsParams,
} from "@/app/(app)/registros/export-actions";

export function ExportCsvButton({ params }: { params: ExportRecordsParams }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleExport() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await exportRecordsCsv(params);
        if (!res.ok) {
          setError(res.message);
          return;
        }
        downloadCsv(
          csvFilename(`registros-${params.fonte}`),
          buildCsv(res.headers, res.rows)
        );
      } catch {
        setError("Falha ao exportar. Tente novamente.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" onClick={handleExport} disabled={pending}>
        {pending ? "Exportando…" : "Exportar CSV"}
      </Button>
      {error ? (
        <p className="text-destructive max-w-64 text-right text-xs">{error}</p>
      ) : null}
    </div>
  );
}
