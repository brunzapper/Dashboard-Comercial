// Versão: 1.0 | Data: 12/07/2026
// Configurações → Log, seção "Sincronizações": histórico dos jobs de sync do
// Bitrix (reconciliações e backfills), manuais ou automáticos. Só leitura — a
// escrita da tabela sync_jobs é feita pelo runner via service role. Visível a
// qualquer autenticado (não expõe dados de registros, só status/contagens).
"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

export interface SyncJobLogRow {
  id: string;
  kind: "reconcile" | "backfill";
  trigger: "manual" | "auto";
  status: "running" | "done" | "error" | "canceled";
  days: number | null;
  inserted: number;
  updated: number;
  processedTotal: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

type Filter = "all" | "reconcile" | "backfill" | "error";

const KIND_LABELS: Record<SyncJobLogRow["kind"], string> = {
  reconcile: "Reconciliação",
  backfill: "Backfill",
};

const TRIGGER_LABELS: Record<SyncJobLogRow["trigger"], string> = {
  manual: "Manual",
  auto: "Automático",
};

const STATUS_LABELS: Record<SyncJobLogRow["status"], string> = {
  running: "Em andamento",
  done: "Concluído",
  error: "Erro",
  canceled: "Cancelado",
};

const STATUS_CLASSES: Record<SyncJobLogRow["status"], string> = {
  running: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  error: "bg-destructive/15 text-destructive",
  canceled: "bg-muted text-muted-foreground",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR");
}

export function SyncJobsLog({ rows }: { rows: SyncJobLogRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const filtered = rows.filter((r) => {
    if (filter === "all") return true;
    if (filter === "error") return r.status === "error";
    return r.kind === filter;
  });

  const counts = {
    all: rows.length,
    reconcile: rows.filter((r) => r.kind === "reconcile").length,
    backfill: rows.filter((r) => r.kind === "backfill").length,
    error: rows.filter((r) => r.status === "error").length,
  };

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: `Todos (${counts.all})` },
    { key: "reconcile", label: `Reconciliações (${counts.reconcile})` },
    { key: "backfill", label: `Backfills (${counts.backfill})` },
    { key: "error", label: `Erros (${counts.error})` },
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
        <p className="text-muted-foreground text-sm">Nenhuma sincronização.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Tipo</th>
                <th className="px-3 py-2 text-left font-medium">Origem</th>
                <th className="px-3 py-2 text-right font-medium">Janela (dias)</th>
                <th className="px-3 py-2 text-right font-medium">Novos / Atualizados</th>
                <th className="px-3 py-2 text-left font-medium">Quando</th>
                <th className="px-3 py-2 text-left font-medium">Detalhe</th>
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
                  <td className="px-3 py-2 whitespace-nowrap">{KIND_LABELS[r.kind]}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {TRIGGER_LABELS[r.trigger]}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.days ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.inserted} / {r.updated}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {fmtDate(r.finishedAt ?? r.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-destructive break-all">
                    {r.error ?? ""}
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
