// Versão: 2.0 | Data: 09/07/2026
// v2.0 (09/07/2026): Fase 9 — sync incremental e retomável. O painel dirige o
//   loop: startSyncJob → stepSyncJob (1 página por chamada) até terminar, com
//   barra de progresso por fase. Cada requisição é pequena (cabe no timeout do
//   plano gratuito). Ao reabrir a página, um job em andamento é detectado e pode
//   ser retomado. Backfill ganhou o campo de dias (janela corrida).
// v1.1 (09/07/2026): Fase 8 — quebra por entidade (leads vs deals) + amostras de erro.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  startSyncJob,
  stepSyncJob,
  type StepProgress,
} from "@/app/(app)/registros/sync-actions";
import type { SyncResult } from "@/lib/sync/shared";

const ENTITY_LABELS: Record<string, string> = {
  lead: "Leads",
  negocio: "Deals",
  venda_site: "Estudo de Fechamentos",
};

const STEP_PAUSE_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [resumable, setResumable] = useState<StepProgress | null>(null);
  const runningRef = useRef(false);

  const drive = useCallback(async (jobId: string) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setError(null);
    setResumable(null);
    try {
      let p: StepProgress | null = null;
      do {
        p = await stepSyncJob(jobId);
        setProgress(p);
        if (p.status === "error") {
          setError(p.error ?? "Falha no sync.");
          break;
        }
        if (!p.done) await sleep(STEP_PAUSE_MS);
      } while (!p.done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, []);

  const start = useCallback(
    async (kind: "reconcile" | "backfill", days: number) => {
      if (runningRef.current) return;
      setProgress(null);
      setError(null);
      try {
        const { jobId } = await startSyncJob(kind, days);
        await drive(jobId);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [drive]
  );

  // Ao montar: detecta um job em andamento (para retomar após refresh).
  useEffect(() => {
    let active = true;
    getActiveSyncJob()
      .then((j) => {
        if (active && j && j.status === "running") setResumable(j);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

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
          Último sync: {lastSync}. Roda em pedaços (retomável) — janelas grandes só
          significam mais passos.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {resumable ? (
          <div className="border-primary/40 bg-primary/5 flex flex-wrap items-center gap-3 rounded-md border p-3">
            <span className="text-sm">
              Há um sync em andamento ({resumable.kind === "backfill" ? "Backfill" : "Reconciliar"}).
            </span>
            <Button size="sm" onClick={() => drive(resumable.jobId)} disabled={running}>
              Retomar
            </Button>
          </div>
        ) : null}

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
          <Button type="submit" disabled={running}>
            {running ? "Sincronizando..." : "Reconciliar"}
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
          <Button type="submit" variant="outline" disabled={running}>
            {running ? "Importando..." : "Backfill inicial"}
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
