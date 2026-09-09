// Versão: 1.1 | Data: 09/09/2026
// v1.1 (09/09/2026): drena também o espelho de TAREFAS no Bitrix (0136),
//   depois do write-back e dividindo o mesmo orçamento de tempo.
// "Tick" de sincronização, disparado pelo pg_cron do Supabase a cada minuto
// (supabase/apply/pg-cron-tick.sql). Protegido por SYNC_SECRET. Dentro de um
// orçamento de ~45s (< teto de 60s do plano Hobby), nesta ordem:
//   1) drena a fila de write-back (envia updates pendentes ao Bitrix);
//   1b) drena a fila do espelho de tarefas (cria/atualiza a atividade no CRM);
//   2) avança o job de sync ATIVO (manual ou automático) de onde parou;
//   3) se não há job rodando e o último reconcile automático foi há ≥ 1h, cria
//      um novo reconcile incremental (janela de AUTO_SYNC_WINDOW_DAYS, padrão 1).
// Assim o sync horário sai do próprio tick e nada trava a navegação do usuário.
import { NextResponse } from "next/server";

import { optionalEnv } from "@/lib/env";
import { syncSecretAuthorized } from "@/lib/auth/sync-secret";
import { createServiceClient } from "@/lib/supabase/service";
import {
  createJob,
  driveJob,
  getRunningJob,
  lastAutoReconcileAt,
  takeoverStale,
} from "@/lib/sync/bitrix/runner";
import { drainWritebackQueue } from "@/lib/sync/bitrix/writeback";
import { drainTaskMirrorQueue } from "@/lib/sync/bitrix/task-mirror";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Orçamento por invocação: fica confortavelmente abaixo do teto de 60s e do
// intervalo de 60s entre ticks (sem sobreposição).
const BUDGET_MS = 45_000;
// Cria um novo reconcile automático quando o último foi há ≥ 1h.
const AUTO_INTERVAL_MS = 60 * 60 * 1000;

// SYNC_SECRET com comparação constant-time — ver lib/auth/sync-secret.ts.
const authorized = syncSecretAuthorized;

function autoWindowDays(): number {
  const n = Number(optionalEnv("AUTO_SYNC_WINDOW_DAYS") ?? "1");
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function POST(request: Request) {
  try {
    if (!authorized(request)) {
      return NextResponse.json({ error: "não autorizado" }, { status: 401 });
    }
    const deadline = Date.now() + BUDGET_MS;
    const db = createServiceClient();

    // Libera jobs "presos" (chamador morreu) para a guarda de concorrência.
    const staled = await takeoverStale(db);

    // 1) Write-back pendente.
    const writeback = await drainWritebackQueue(db, deadline);

    // 1b) Espelho de tarefas no Bitrix (0136). DEPOIS do write-back de
    // propósito: aquele carrega edição de dado do usuário e tem prioridade
    // sobre um efeito colateral. Os dois dividem o mesmo orçamento de tempo.
    const taskMirror = await drainTaskMirrorQueue(db, deadline);

    // 2) Job ativo (manual OU automático) — avança de onde parou.
    let drove: string | null = null;
    let createdAuto = false;
    const running = await getRunningJob(db);
    if (running) {
      const p = await driveJob(db, running.jobId, deadline);
      drove = p.status;
    } else if (Date.now() < deadline) {
      // 3) Sem job rodando: cria um reconcile automático se passou ≥ 1h.
      const last = await lastAutoReconcileAt(db);
      if (last == null || Date.now() - last >= AUTO_INTERVAL_MS) {
        const { jobId } = await createJob(db, "reconcile", autoWindowDays(), "auto", null);
        createdAuto = true;
        const p = await driveJob(db, jobId, deadline);
        drove = p.status;
      }
    }

    return NextResponse.json({
      ok: true,
      staled,
      writeback,
      taskMirror,
      drove,
      createdAuto,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
