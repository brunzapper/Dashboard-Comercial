// Versão: 1.0 | Data: 11/07/2026
// Tabela do Log de write-back (Configurações → Log). Filtro por status no client
// e botão "Reenfileirar" (server action) nos itens com erro.
"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { requeueWriteback } from "@/app/(app)/configuracoes/log/actions";

export interface WritebackLogRow {
  id: string;
  entity: "deal" | "lead";
  sourceId: string;
  fieldKey: string;
  label: string | null;
  recordTitle: string | null;
  newValue: unknown;
  status: "pending" | "done" | "error";
  attempts: number;
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
}

type Filter = "all" | "error" | "pending" | "done";

const STATUS_LABELS: Record<WritebackLogRow["status"], string> = {
  pending: "Pendente",
  done: "Enviado",
  error: "Erro",
};

const STATUS_CLASSES: Record<WritebackLogRow["status"], string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  error: "bg-destructive/15 text-destructive",
};

function fmtValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR");
}

export function WritebackLog({ rows }: { rows: WritebackLogRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const filtered = rows.filter((r) => filter === "all" || r.status === filter);

  const counts = {
    all: rows.length,
    error: rows.filter((r) => r.status === "error").length,
    pending: rows.filter((r) => r.status === "pending").length,
    done: rows.filter((r) => r.status === "done").length,
  };

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: `Todos (${counts.all})` },
    { key: "error", label: `Erros (${counts.error})` },
    { key: "pending", label: `Pendentes (${counts.pending})` },
    { key: "done", label: `Enviados (${counts.done})` },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-md border px-3 py-1 text-sm transition-colors",
              filter === f.key
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nenhum item.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Registro</th>
                <th className="px-3 py-2 text-left font-medium">Campo</th>
                <th className="px-3 py-2 text-left font-medium">Valor enviado</th>
                <th className="px-3 py-2 text-left font-medium">Quando</th>
                <th className="px-3 py-2 text-left font-medium">Detalhe</th>
                <th className="px-3 py-2 text-right font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-block rounded px-2 py-0.5 text-xs font-medium",
                        STATUS_CLASSES[r.status]
                      )}
                    >
                      {STATUS_LABELS[r.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div>{r.recordTitle ?? "(sem título)"}</div>
                    <div className="text-muted-foreground text-xs">
                      {r.entity === "deal" ? "Negócio" : "Lead"} #{r.sourceId}
                    </div>
                  </td>
                  <td className="px-3 py-2">{r.label ?? r.fieldKey}</td>
                  <td className="px-3 py-2 font-mono break-all">{fmtValue(r.newValue)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {fmtDate(r.processedAt ?? r.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-destructive break-all">
                    {r.lastError
                      ? `${r.lastError}${r.attempts > 0 ? ` (${r.attempts} tentativa(s))` : ""}`
                      : ""}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.status === "error" ? (
                      <form action={requeueWriteback}>
                        <input type="hidden" name="id" value={r.id} />
                        <Button type="submit" size="sm" variant="outline">
                          Reenfileirar
                        </Button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
