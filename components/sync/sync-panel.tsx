// Versão: 3.0 | Data: 11/07/2026
// v3.0 (11/07/2026): sync automático — o painel NÃO dirige mais o loop. Os botões
//   apenas ENFILEIRAM o job (startSyncJob); quem avança o job é o tick agendado
//   (/api/sync/tick), no servidor. O painel só observa o progresso por polling
//   (getSyncJobById), então navegar ou fechar a aba não interrompe a sincronização.
// v2.0 (09/07/2026): Fase 9 — sync incremental e retomável (loop no navegador).
// v1.1 (09/07/2026): Fase 8 — quebra por entidade (leads vs deals) + amostras de erro.
"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getActiveSyncJob,
  getSyncJobById,
  startSyncJob,
  type StepProgress,
} from "@/app/(app)/registros/sync-actions";
import type { SyncResult } from "@/lib/sync/shared";

const ENTITY_LABELS: Record<string, string> = {
  lead: "Leads",
  negocio: "Deals",
  venda_site: "Estudo de Fechamentos",
};

const POLL_MS = 4000;

function TotalsLine({ result }: { result: SyncResult }) {
  const entities = Object.entries(result.byEntity ?? {});
  return (
    <div className="flex flex-col gap-1" role="status">
      <p className="text-muted-foreground text-sm">
        novos: {result.inserted}, atualizados: {result.updated}, erros: {result.errors}
      </p>
      {entities.length > 0 ? (
        <ul className="text-muted-foreground text-xs">
          {entities.map(([entity, c]) => (
            <li key={entity}>
              {ENTITY_LABELS[entity] ?? entity}: {c.inserted} novo(s), {c.updated}{" "}
              atualizado(s)
              {c.errors > 0 ? `, ${c.errors} erro(s)` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {result.errorSamples && result.errorSamples.length > 0 ? (
        <details className="text-xs">
          <summary className="text-destructive cursor-pointer">
            Ver erros ({result.errorSamples.length})
          </summary>
          <ul className="text-muted-foreground mt-1 flex flex-col gap-0.5">
            {result.errorSamples.map((msg, i) => (
              <li key={i} className="font-mono break-all">
                {msg}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function ProgressView({ progress }: { progress: StepProgress }) {
  const pct =
    progress.phaseTotal && progress.phaseTotal > 0
      ? Math.min(100, Math.round((progress.processedInPhase / progress.phaseTotal) * 100))
      : null;
  const phaseNum = Math.min(progress.phaseIndex + 1, progress.phaseCount || 1);
  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {progress.phaseCount > 0
            ? `Fase ${phaseNum}/${progress.phaseCount}: ${progress.phaseLabel}`
            : progress.phaseLabel}
        </span>
        <span className="text-muted-foreground">
          {progress.phaseTotal != null
            ? `${progress.processedInPhase}/${progress.phaseTotal}`
            : `${progress.processedTotal} processado(s)`}
        </span>
      </div>
      <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
        <div
          className={
            "bg-primary h-full rounded-full transition-all " +
            (pct == null ? "w-1/3 animate-pulse" : "")
          }
          style={pct == null ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function SyncPanel({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  const [progress, setProgress] = useState<StepProgress | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const running =
    progress != null && (progress.status === "running" || !progress.done);

  // Ao montar: detecta um job em andamento (manual ou automático) para observar.
  useEffect(() => {
    let active = true;
    getActiveSyncJob()
      .then((j) => {
        if (active && j && j.status === "running") {
          setProgress(j);
          setJobId(j.jobId);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Observa o job por polling até ele sair de "running" (o tick server-side o
  // avança). Sem loop dirigido pelo navegador — navegar/fechar a aba não para.
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    const poll = async () => {
      try {
        const p = await getSyncJobById(jobId);
        if (!active || !p) return;
        setProgress(p);
        if (p.status === "error") setError(p.error ?? "Falha no sync.");
        if (p.done) clearInterval(id);
      } catch {
        /* ignora falhas transitórias de polling */
      }
    };
    const id = setInterval(poll, POLL_MS);
    poll();
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [jobId]);

  const start = useCallback(
    async (kind: "reconcile" | "backfill", days: number) => {
      if (running || busy) return;
      setBusy(true);
      setError(null);
      setProgress(null);
      try {
        const { jobId: id } = await startSyncJob(kind, days);
        setJobId(id);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [running, busy]
  );

  const lastSync = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleString("pt-BR")
    : "nunca";

  function daysFromForm(e: React.FormEvent<HTMLFormElement>, fallback: number): number {
    const input = e.currentTarget.elements.namedItem("days") as HTMLInputElement | null;
    const n = Number(input?.value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sincronização (Bitrix)</CardTitle>
        <CardDescription>
          Último sync: {lastSync}. Roda em segundo plano no servidor (a cada hora,
          automaticamente) — ao disparar manualmente aqui, você pode sair desta tela
          que a sincronização continua.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start("reconcile", daysFromForm(e, 3));
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="recon-days">Reconciliar (dias)</Label>
            <Input
              id="recon-days"
              name="days"
              type="number"
              min={1}
              max={730}
              defaultValue={3}
              className="w-28"
            />
          </div>
          <Button type="submit" disabled={running || busy}>
            {running ? "Sincronizando..." : busy ? "Enfileirando..." : "Reconciliar"}
          </Button>
        </form>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            start("backfill", daysFromForm(e, 365));
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="backfill-days">Backfill (dias)</Label>
            <Input
              id="backfill-days"
              name="days"
              type="number"
              min={1}
              max={730}
              defaultValue={365}
              className="w-28"
            />
          </div>
          <Button type="submit" variant="outline" disabled={running || busy}>
            {running ? "Importando..." : busy ? "Enfileirando..." : "Backfill inicial"}
          </Button>
          <span className="text-muted-foreground text-xs">
            Importa deals abertos + fechados na janela (Vendas + Enterprise) e todos os leads.
          </span>
        </form>

        {progress ? (
          <div className="flex flex-col gap-3">
            {progress.status === "running" || !progress.done ? (
              <ProgressView progress={progress} />
            ) : null}
            {error ? (
              <p className="text-destructive text-sm">{error}</p>
            ) : progress.done && progress.status === "done" ? (
              <p className="text-muted-foreground text-sm">
                {progress.kind === "backfill" ? "Backfill" : "Reconciliação"} concluído(a).
              </p>
            ) : null}
            <TotalsLine result={progress.totals} />
          </div>
        ) : error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
