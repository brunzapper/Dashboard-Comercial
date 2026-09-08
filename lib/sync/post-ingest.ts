// Versão: 1.0 | Data: 03/08/2026
// Cauda incremental pós-ingestão — choke point ÚNICO das rotas de push
// (/api/sync/sheets e /api/ingest/[source]). Substitui a cauda global antiga
// (runAutoMatch + recalcAllFormulaFields — O(N) na tabela inteira, que
// estourava o teto de 60s da Vercel a cada push) pelo padrão incremental do
// hook pós-job do Bitrix (maybeAutoMatchAfterJob, lib/sync/bitrix/runner.ts):
// auto-match restrito aos record_types tocados + recalc direcionado.
//
// Diferença p/ o hook do Bitrix: além dos ids recém-casados, recalca também
// os touchedIds do push e os PARCEIROS já casados deles (record_matches) — a
// cauda global reparava fórmulas match:<fonte> de registros ANTIGOS (ex.:
// lead cujo parceiro venda_site mudou neste push) e espelhar só o hook
// regrediria isso. Best-effort e limitado por TEMPO (budgetUntil): duração
// era o modo de falha da rota (FUNCTION_INVOCATION_TIMEOUT), não só exceção.
//
// Nota: regra de match em que o record_type tocado é SÓ source_b cai em
// runRule cheio (matching-engine.ts — o índice é do lado B); o budget cobre e
// o botão "Executar todas" em Campos → Matches é a mitigação manual.
import type { SupabaseClient } from "@supabase/supabase-js";

import { runAutoMatchIncremental } from "@/lib/records/matching-engine";
import { recalcFormulaFieldsForRecords } from "@/lib/records/recalc";

const PARTNER_LOOKUP_BATCH = 200;

export interface PostSyncOptions {
  /** record_types tocados pelo push (filtra as regras de match). */
  recordTypes: string[];
  /** Instante de início do push — restringe o lado A do match incremental. */
  since: string;
  /** Ids inseridos/atualizados pelo push (insumo do recalc direcionado). */
  touchedIds: string[];
  /** Limite em Date.now(): já estourado, a cauda inteira é pulada. */
  budgetUntil: number;
}

export interface PostSyncResult {
  ran: boolean;
  matchInserted: number;
  recalced: number;
}

// Parceiros já casados (record_matches, qualquer direção) dos ids dados —
// mesmo shape da fase 1 do resolveMatchedRecords (matching-engine.ts).
async function matchedPartnerIds(
  db: SupabaseClient,
  ids: string[]
): Promise<string[]> {
  const partners: string[] = [];
  const own = new Set(ids);
  for (let i = 0; i < ids.length; i += PARTNER_LOOKUP_BATCH) {
    const slice = ids.slice(i, i + PARTNER_LOOKUP_BATCH);
    const { data } = await db
      .from("record_matches")
      .select("record_a_id, record_b_id")
      .or(
        `record_a_id.in.(${slice.join(",")}),record_b_id.in.(${slice.join(",")})`
      );
    for (const m of data ?? []) {
      const a = m.record_a_id as string;
      const b = m.record_b_id as string;
      if (!own.has(a)) partners.push(a);
      if (!own.has(b)) partners.push(b);
    }
  }
  return partners;
}

/**
 * Auto-match incremental + recalc direcionado dos registros tocados por um
 * push. O chamador embrulha em try/catch (best-effort — o push já persistiu).
 */
export async function runIncrementalPostSync(
  db: SupabaseClient,
  opts: PostSyncOptions
): Promise<PostSyncResult> {
  if (opts.touchedIds.length === 0 || Date.now() >= opts.budgetUntil) {
    return { ran: false, matchInserted: 0, recalced: 0 };
  }
  const match = await runAutoMatchIncremental(db, {
    touchedRecordTypes: opts.recordTypes,
    since: opts.since,
  });
  const partners = await matchedPartnerIds(db, opts.touchedIds);
  const recalced = await recalcFormulaFieldsForRecords([
    ...opts.touchedIds,
    ...match.recordIds,
    ...partners,
  ]);
  return { ran: true, matchInserted: match.inserted, recalced };
}
