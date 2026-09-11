// Versão: 1.0 | Data: 11/09/2026
// VARREDURA DO PUSH: o que não veio numa rodada COMPLETA da planilha saiu dela
// e vai para a Lixeira. Lado TypeScript da 0140 — a régua de decisão que pode
// apagar dado vive no SQL (sheet_push_sweep), aqui ficam o enquadramento do
// push e o modo de operação.
//
// Por que o enquadramento existe: o Apps Script fatia o envio em chunks de ≤500
// linhas e cada chunk é um POST separado, então nenhum request isolado vê a
// planilha inteira. O .gs gera um `push_id` por execução e numera os chunks;
// cada chunk deposita o que viu e só o ÚLTIMO dispara a varredura.
//
// Fail-closed por estrutura: chunk que falha faz a rota responder não-2xx, o
// .gs aborta os seguintes, o último nunca chega e nada é varrido. Push sem
// enquadramento (script legado) NUNCA varre.
import type { SupabaseClient } from "@supabase/supabase-js";

/** Enquadramento de um push multi-chunk. */
export interface PushFrame {
  pushId: string;
  chunk: number;
  chunks: number;
}

export type SweepMode = "off" | "dry" | "on";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lê o enquadramento do corpo do push. Qualquer coisa fora do contrato devolve
 * null = MODO LEGADO: o push sincroniza normalmente e a varredura não roda.
 * É o que mantém o script pré-v1.2 aceito sem que ele possa apagar nada.
 */
export function readPushFrame(payload: Record<string, unknown>): PushFrame | null {
  const pushId = typeof payload.push_id === "string" ? payload.push_id.trim() : "";
  if (!UUID_RE.test(pushId)) return null;
  const chunk = Number(payload.chunk);
  const chunks = Number(payload.chunks);
  if (!Number.isInteger(chunk) || !Number.isInteger(chunks)) return null;
  if (chunk < 1 || chunks < 1 || chunk > chunks) return null;
  return { pushId, chunk, chunks };
}

export function isLastChunk(frame: PushFrame): boolean {
  return frame.chunk === frame.chunks;
}

/**
 * Modo da varredura, por env. O padrão é `dry`: a rodada calcula e REPORTA o
 * que apagaria sem escrever nada. Ligar (`on`) é decisão explícita, depois de
 * uma temporada lendo os `would_sweep` no log do Apps Script.
 */
export function sweepMode(
  env: Record<string, string | undefined> = process.env
): SweepMode {
  const raw = (env.SHEET_SWEEP_MODE ?? "").trim().toLowerCase();
  if (raw === "on") return "on";
  if (raw === "off") return "off";
  return "dry";
}

/** Org dona da base — a varredura é sempre escopada por ela (0090). */
export async function resolveSourceOrg(
  db: SupabaseClient,
  recordType: string
): Promise<string | null> {
  const { data } = await db
    .from("data_sources")
    .select("organization_id")
    .eq("record_type", recordType)
    .maybeSingle();
  return (data?.organization_id as string | undefined) ?? null;
}

/**
 * Deposita o que ESTE chunk viu. `poisoned` marca o push cujo conjunto visto
 * está incompleto (o adapter errou) — a varredura recusa, em vez de apagar o
 * que apenas não foi lido.
 */
export async function recordPushChunk(
  db: SupabaseClient,
  opts: {
    frame: PushFrame;
    organizationId: string;
    recordType: string;
    sourceSystem: string;
    seenSourceIds: string[];
    poisoned: boolean;
  }
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db.rpc("sync_push_record_chunk", {
    p_push_id: opts.frame.pushId,
    p_source_system: opts.sourceSystem,
    p_record_type: opts.recordType,
    p_organization_id: opts.organizationId,
    p_chunk: opts.frame.chunk,
    p_chunks: opts.frame.chunks,
    p_source_ids: opts.seenSourceIds,
    p_poisoned: opts.poisoned,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface SweepReport {
  status: string;
  total?: number;
  swept?: number;
  would_sweep?: number;
  missing?: number;
  limit?: number;
  curated?: number;
  sample?: string[];
}

/** Dispara a varredura (só faz sentido no último chunk). */
export async function runSheetSweep(
  db: SupabaseClient,
  pushId: string,
  opts: { dryRun: boolean; maxRatio?: number; minRows?: number }
): Promise<SweepReport> {
  const { data, error } = await db.rpc("sheet_push_sweep", {
    p_push_id: pushId,
    p_max_ratio: opts.maxRatio ?? 0.1,
    p_min_rows: opts.minRows ?? 1,
    p_dry_run: opts.dryRun,
  });
  if (error) return { status: `error: ${error.message}` };
  return (data ?? { status: "unknown" }) as SweepReport;
}

/** Push parcial deixa run + seen para trás; o cascade leva o seen junto. */
export async function purgeStalePushRuns(db: SupabaseClient): Promise<void> {
  await db.rpc("sync_push_purge_stale", { p_days: 2 });
}
