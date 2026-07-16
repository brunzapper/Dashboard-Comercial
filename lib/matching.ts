// Versão: 1.0 | Data: 12/07/2026
// Fase 2: matching configurável entre fontes. Tipos + carregamento das regras
// (match_rules) e utilidades de comparação de valores. O motor de auto-match
// vive em lib/records/matching-engine.ts; a exposição `match:<fonte>:<ref>` nos
// widgets é do RPC (migração 0042) e do modo lista (lib/widgets/record-list.ts).
import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeName } from "@/lib/sync/shared";
import { toSourceKey, type SourceKey } from "@/lib/sources";

// record_type de uma fonte qualquer (fontes dinâmicas: key === record_type).
export type MatchRecordType = string;

export interface MatchRule {
  id: string;
  label: string;
  source_a: MatchRecordType;
  source_b: MatchRecordType;
  field_a_1: string;
  field_b_1: string;
  field_a_2: string | null;
  field_b_2: string | null;
  enabled: boolean;
  priority: number;
}

export interface RecordMatch {
  id: string;
  record_a_id: string;
  record_b_id: string;
  rule_id: string | null;
  mode: "auto" | "manual";
  matched_on: string | null;
}

/** Carrega todas as regras de auto-match (globais), por prioridade. */
export async function loadMatchRules(
  supabase: SupabaseClient
): Promise<MatchRule[]> {
  const { data } = await supabase
    .from("match_rules")
    .select(
      "id, label, source_a, source_b, field_a_1, field_b_1, field_a_2, field_b_2, enabled, priority"
    )
    .order("priority", { ascending: true })
    .order("label", { ascending: true });
  return (data ?? []) as MatchRule[];
}

// Registro "cru" o suficiente para extrair qualquer ref de match (núcleo comum +
// custom_fields). Um subconjunto amplo das colunas permitidas em _widget_col_expr.
export interface MatchableRecord {
  id: string;
  record_type: MatchRecordType;
  [col: string]: unknown;
  custom_fields?: Record<string, unknown> | null;
}

// Colunas do núcleo carregadas para comparação (cobre os refs de match usuais).
export const MATCHABLE_COLS =
  "id, record_type, title, stage, channel, sale_type, currency, value, mrr, closed_at, opened_at, source_created_at, custom_fields";

/** Valor cru de um ref (coluna do núcleo ou custom:<key>) num registro. */
export function refValue(rec: MatchableRecord, ref: string): unknown {
  if (ref.startsWith("custom:")) return rec.custom_fields?.[ref.slice(7)] ?? null;
  return rec[ref] ?? null;
}

/**
 * Chave de comparação normalizada de um valor (case/acentos/espaços). null/vazio
 * => null (não casa). Serve tanto para e-mail quanto para nome (normalizeName
 * baixa caixa, remove acentos e colapsa espaços).
 */
export function matchKey(value: unknown): string | null {
  if (value == null) return null;
  const s = normalizeName(String(value));
  return s === "" ? null : s;
}

/** SourceKey de um record_type (p/ montar refs match:<fonte>:…). */
export function sourceKeyOf(rt: MatchRecordType): SourceKey {
  return toSourceKey(rt);
}
