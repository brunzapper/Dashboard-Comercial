// Versão: 1.1 | Data: 26/07/2026
// v1.1 (26/07/2026): runAutoMatchIncremental — variante pós-sync do Bitrix
//   (lado A restrito por last_synced_at; regras filtradas pelos record_types
//   tocados) + retorno dos ids casados p/ recalc direcionado.
// Fase 2: motor de auto-match. Para cada regra habilitada, casa registros da
// fonte A com os da fonte B por 2 pares de campos com FALLBACK (par 1 → par 2) e
// grava os matches (mode='auto') em record_matches. NUNCA sobrescreve um match
// existente (protege o que foi feito manualmente e evita churn). Idempotente.
// Espelha a ideia do índice de leads relacionados do Bitrix
// (lib/sync/bitrix/sync.ts: loadRelatedLeadIndex/resolveRelatedLeadFromIndex).
import type { SupabaseClient } from "@supabase/supabase-js";

import { toSourceKey } from "@/lib/sources";
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

export interface IncrementalAutoMatchResult extends AutoMatchResult {
  /** Ids (lado A ∪ lado B) dos pares candidatos inseridos — superset inócuo
   * (ignoreDuplicates pode ter descartado alguns), insumo idempotente do
   * recalc direcionado. */
  recordIds: string[];
}

// Carrega TODOS os registros de um record_type (paginado, para driblar o teto do
// PostgREST), com as colunas usadas na comparação. `sinceLastSynced` restringe
// aos tocados pelo sync desde o instante dado (last_synced_at; nulos ficam
// fora — CSV/manual não passam por aqui).
async function loadRecordsOfType(
  db: SupabaseClient,
  recordType: string,
  sinceLastSynced?: string
): Promise<MatchableRecord[]> {
  const BATCH = 1000;
  const all: MatchableRecord[] = [];
  for (let from = 0; ; ) {
    let q = db
      .from("records")
      .select(MATCHABLE_COLS)
      .eq("record_type", recordType)
      // Lixeira (0121): registro na lixeira não forma match NOVO (a
      // hidratação de parceiros por id, abaixo, segue sem filtro).
      .is("deleted_at", null);
    if (sinceLastSynced) q = q.gte("last_synced_at", sinceLastSynced);
    const { data, error } = await q.range(from, from + BATCH - 1);
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

interface RunRuleResult {
  inserted: number;
  recordIds: string[];
}

// `sideASince`: variante INCREMENTAL — lado A restrito aos registros tocados
// pelo sync desde o instante dado; lado B segue indexado inteiro (base de
// referência tipicamente pequena, ex.: Parceiros).
async function runRule(
  db: SupabaseClient,
  rule: MatchRule,
  opts?: { sideASince?: string }
): Promise<RunRuleResult> {
  const [aRecs, bRecs] = await Promise.all([
    loadRecordsOfType(db, rule.source_a, opts?.sideASince),
    loadRecordsOfType(db, rule.source_b),
  ]);
  if (aRecs.length === 0 || bRecs.length === 0)
    return { inserted: 0, recordIds: [] };

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
  return {
    inserted,
    recordIds: rows.flatMap((r) => [r.record_a_id, r.record_b_id]),
  };
}

// Registro casado por fonte (SourceKey → registro). Usado para materializar os
// operandos match:<fonte>:<data> nos campos calculados e recalcular o lead time.
export type MatchedBySource = Record<string, MatchableRecord>;

/**
 * Resolve, para um LOTE de registros, o registro casado por fonte — prioriza
 * match manual > mais recente; para a fonte leads, cai no `related_lead_id`
 * quando não há match genérico (mesma precedência do RPC 0042). Faz poucas idas
 * ao banco (independente de N). `cols` define quais colunas carregar do casado.
 */
export async function resolveMatchedRecords(
  db: SupabaseClient,
  records: { id: string; related_lead_id?: string | null }[],
  cols: string = MATCHABLE_COLS
): Promise<Map<string, MatchedBySource>> {
  const result = new Map<string, MatchedBySource>();
  if (records.length === 0) return result;
  const ids = records.map((r) => r.id);

  type MatchRow = {
    record_a_id: string;
    record_b_id: string;
    mode: "auto" | "manual";
    created_at: string;
  };
  const matches: MatchRow[] = [];
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data } = await db
      .from("record_matches")
      .select("record_a_id, record_b_id, mode, created_at")
      .or(
        `record_a_id.in.(${slice.join(",")}),record_b_id.in.(${slice.join(",")})`
      );
    for (const m of (data ?? []) as MatchRow[]) matches.push(m);
  }

  const wanted = new Set<string>();
  for (const m of matches) {
    wanted.add(m.record_a_id);
    wanted.add(m.record_b_id);
  }
  for (const r of records) if (r.related_lead_id) wanted.add(r.related_lead_id);
  for (const id of ids) wanted.delete(id);

  const partnerById = new Map<string, MatchableRecord>();
  const wl = [...wanted];
  for (let i = 0; i < wl.length; i += CHUNK) {
    const slice = wl.slice(i, i + CHUNK);
    if (slice.length === 0) continue;
    const { data } = await db.from("records").select(cols).in("id", slice);
    for (const p of (data ?? []) as unknown as MatchableRecord[])
      partnerById.set(p.id, p);
  }

  const byRecord = new Map<string, MatchRow[]>();
  for (const m of matches) {
    for (const self of [m.record_a_id, m.record_b_id]) {
      const arr = byRecord.get(self);
      if (arr) arr.push(m);
      else byRecord.set(self, [m]);
    }
  }
  const rank = (m: MatchRow) =>
    (m.mode === "manual" ? 1 : 0) * 1e13 + Date.parse(m.created_at || "");

  for (const r of records) {
    const map: MatchedBySource = {};
    const own = (byRecord.get(r.id) ?? []).slice().sort((a, b) => rank(b) - rank(a));
    for (const m of own) {
      const partner = partnerById.get(
        m.record_a_id === r.id ? m.record_b_id : m.record_a_id
      );
      if (!partner) continue;
      const src = toSourceKey(partner.record_type);
      if (src && !map[src]) map[src] = partner;
    }
    if (!map.leads && r.related_lead_id) {
      const lead = partnerById.get(r.related_lead_id);
      if (lead) map.leads = lead;
    }
    result.set(r.id, map);
  }
  return result;
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
  for (const rule of rules) inserted += (await runRule(db, rule)).inserted;
  return { rulesRun: rules.length, inserted };
}

/**
 * Auto-match INCREMENTAL pós-sync: roda só as regras cujos record_types foram
 * tocados. Regra com `source_a` tocado → lado A restrito por `last_synced_at
 * >= since` (lado B indexado inteiro); regra com SÓ `source_b` tocado → runRule
 * cheio (o índice é do lado B — não dá para restringi-lo sem perder matches de
 * A antigos). Preserva ignoreDuplicates (nunca sobrescreve manual). Devolve os
 * ids dos pares inseridos para o recalc direcionado.
 */
export async function runAutoMatchIncremental(
  db: SupabaseClient,
  opts: { touchedRecordTypes: string[]; since?: string }
): Promise<IncrementalAutoMatchResult> {
  const touched = new Set(opts.touchedRecordTypes);
  const rules = (await loadMatchRules(db)).filter(
    (r) => r.enabled && (touched.has(r.source_a) || touched.has(r.source_b))
  );
  let inserted = 0;
  const recordIds: string[] = [];
  for (const rule of rules) {
    const incremental = opts.since && touched.has(rule.source_a);
    const res = await runRule(
      db,
      rule,
      incremental ? { sideASince: opts.since } : undefined
    );
    inserted += res.inserted;
    if (res.inserted > 0) recordIds.push(...res.recordIds);
  }
  return { rulesRun: rules.length, inserted, recordIds };
}
