// Versão: 1.0 | Data: 12/07/2026
// Fase 2: motor de auto-match. Para cada regra habilitada, casa registros da
// fonte A com os da fonte B por 2 pares de campos com FALLBACK (par 1 → par 2) e
// grava os matches (mode='auto') em record_matches. NUNCA sobrescreve um match
// existente (protege o que foi feito manualmente e evita churn). Idempotente.
// Espelha a ideia do índice de leads relacionados do Bitrix
// (lib/sync/bitrix/sync.ts: loadRelatedLeadIndex/resolveRelatedLeadFromIndex).
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  loadMatchRules,
  matchKey,
  refValue,
  MATCHABLE_COLS,
  type MatchableRecord,
  type MatchRule,
} from "@/lib/matching";

export interface AutoMatchResult {
  rulesRun: number;
  inserted: number;
}

// Carrega TODOS os registros de um record_type (paginado, para driblar o teto do
// PostgREST), com as colunas usadas na comparação.
async function loadRecordsOfType(
  db: SupabaseClient,
  recordType: string
): Promise<MatchableRecord[]> {
  const BATCH = 1000;
  const all: MatchableRecord[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await db
      .from("records")
      .select(MATCHABLE_COLS)
      .eq("record_type", recordType)
      .range(from, from + BATCH - 1);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as unknown as MatchableRecord[];
    if (chunk.length === 0) break;
    all.push(...chunk);
    from += chunk.length;
  }
  return all;
}

// Índice normValue → primeiro id (primeiro vence em colisão) para uma coluna.
function indexBy(recs: MatchableRecord[], ref: string): Map<string, string> {
  const idx = new Map<string, string>();
  for (const r of recs) {
    const k = matchKey(refValue(r, ref));
    if (k && !idx.has(k)) idx.set(k, r.id);
  }
  return idx;
}

// Par não-ordenado como chave (evita duplicar o match invertido de outra origem).
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

async function runRule(
  db: SupabaseClient,
  rule: MatchRule
): Promise<number> {
  const [aRecs, bRecs] = await Promise.all([
    loadRecordsOfType(db, rule.source_a),
    loadRecordsOfType(db, rule.source_b),
  ]);
  if (aRecs.length === 0 || bRecs.length === 0) return 0;

  const idx1 = indexBy(bRecs, rule.field_b_1);
  const idx2 = rule.field_a_2 && rule.field_b_2 ? indexBy(bRecs, rule.field_b_2) : null;

  // Pares já existentes (qualquer direção/modo) → não sobrescreve.
  const aIds = aRecs.map((r) => r.id);
  const existing = new Set<string>();
  {
    const BATCH = 300;
    for (let i = 0; i < aIds.length; i += BATCH) {
      const slice = aIds.slice(i, i + BATCH);
      const { data } = await db
        .from("record_matches")
        .select("record_a_id, record_b_id")
        .or(`record_a_id.in.(${slice.join(",")}),record_b_id.in.(${slice.join(",")})`);
      for (const m of data ?? [])
        existing.add(pairKey(m.record_a_id as string, m.record_b_id as string));
    }
  }

  const rows: {
    record_a_id: string;
    record_b_id: string;
    rule_id: string;
    mode: "auto";
    matched_on: string;
  }[] = [];
  for (const a of aRecs) {
    let bId: string | undefined;
    let matchedOn = rule.field_a_1;
    const k1 = matchKey(refValue(a, rule.field_a_1));
    if (k1) bId = idx1.get(k1);
    if (!bId && idx2 && rule.field_a_2) {
      const k2 = matchKey(refValue(a, rule.field_a_2));
      if (k2) {
        bId = idx2.get(k2);
        matchedOn = rule.field_a_2;
      }
    }
    if (!bId || bId === a.id) continue;
    if (existing.has(pairKey(a.id, bId))) continue;
    existing.add(pairKey(a.id, bId)); // evita duplicar no mesmo lote
    rows.push({
      record_a_id: a.id,
      record_b_id: bId,
      rule_id: rule.id,
      mode: "auto",
      matched_on: matchedOn,
    });
  }

  let inserted = 0;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error, count } = await db
      .from("record_matches")
      .upsert(rows.slice(i, i + BATCH), {
        onConflict: "record_a_id,record_b_id",
        ignoreDuplicates: true,
        count: "exact",
      });
    if (error) throw new Error(error.message);
    inserted += count ?? 0;
  }
  return inserted;
}

/** Roda o auto-match de todas as regras habilitadas (ou de uma só, se `ruleId`). */
export async function runAutoMatch(
  db: SupabaseClient,
  ruleId?: string
): Promise<AutoMatchResult> {
  const rules = (await loadMatchRules(db)).filter(
    (r) => r.enabled && (!ruleId || r.id === ruleId)
  );
  let inserted = 0;
  for (const rule of rules) inserted += await runRule(db, rule);
  return { rulesRun: rules.length, inserted };
}
