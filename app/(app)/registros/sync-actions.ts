// Versão: 2.1 | Data: 18/07/2026
// Server Actions do painel de sync (Bitrix), guardadas por admin. Desde a Fase de
// sync automático, TODA a lógica de passos vive em lib/sync/bitrix/runner.ts —
// aqui só validamos o admin e delegamos, usando o service role (createServiceClient),
// então o SYNC_SECRET nunca é exposto ao browser.
//
// v2.0: o navegador NÃO dirige mais o loop. O painel apenas ENFILEIRA o job
// (startSyncJob) e observa o progresso (getActiveSyncJob); quem avança o job é o
// tick agendado (/api/sync/tick), então navegar/fechar a aba não interrompe.
// v2.1 (18/07/2026): getWritebackPendingCount — contagem de write-backs
//   pendentes p/ o badge de /registros; client do USUÁRIO (a RLS 0038 já
//   restringe a leitura da fila a quem tem view_all_records).
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  createJob,
  getJob,
  getRunningJob,
  stepJob,
  type StepProgress,
  type SyncKind,
} from "@/lib/sync/bitrix/runner";

export type { StepProgress } from "@/lib/sync/bitrix/runner";

async function ensureAdmin(): Promise<string | null> {
  const s = await getSessionInfo();
  if (!s) return "Sessão expirada.";
  if (!s.roles.includes("admin")) return "Apenas administradores podem sincronizar.";
  return null;
}

/** Enfileira um job de sync (manual). O tick agendado o avança até concluir. */
export async function startSyncJob(
  kind: SyncKind,
  days: number
): Promise<{ jobId: string }> {
  const err = await ensureAdmin();
  if (err) throw new Error(err);
  const session = await getSessionInfo();
  const db = createServiceClient();
  const { jobId } = await createJob(db, kind, days, "manual", session?.user.id ?? null);
  return { jobId };
}

/**
 * Avança o job em UM passo. Mantido para o botão "Retomar" e como rede de
 * segurança caso o tick agendado não esteja ativo — o fluxo normal é o tick
 * dirigir o job no servidor.
 */
export async function stepSyncJob(jobId: string): Promise<StepProgress> {
  const err = await ensureAdmin();
  if (err) throw new Error(err);
  const db = createServiceClient();
  return stepJob(db, jobId);
}

/** Último job em andamento (para observar o progresso / retomar ao reabrir). */
export async function getActiveSyncJob(): Promise<StepProgress | null> {
  const err = await ensureAdmin();
  if (err) return null;
  const db = createServiceClient();
  return getRunningJob(db);
}

/** Snapshot de um job específico (qualquer status) — usado pelo polling do painel. */
export async function getSyncJobById(jobId: string): Promise<StepProgress | null> {
  const err = await ensureAdmin();
  if (err) return null;
  const db = createServiceClient();
  return getJob(db, jobId);
}

/**
 * Quantos write-backs aguardam envio ao Bitrix (status='pending'). Consulta
 * head/count barata com o client do usuário — a RLS (0038) já limita a leitura
 * da fila a quem tem view_all_records (gestor/admin, o mesmo público de
 * /registros). Sem a permissão, retorna 0 (o badge some).
 */
export async function getWritebackPendingCount(): Promise<number> {
  const s = await getSessionInfo();
  if (!s?.permissions.includes("view_all_records")) return 0;
  const supabase = await createClient();
  const { count } = await supabase
    .from("bitrix_writeback_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}
