// Versão: 1.0 | Data: 28/07/2026
// PROBE "≥1 linha preenchida" dos campos de data de uma base (0110): alimenta
// o picker "Campo de data do filtro de período" de Registros → Bases com a
// lista "só colunas com dados" (montagem pura em lib/source-date-fields.ts).
// Sempre via PostgREST com o client do USUÁRIO (RLS 0089–0091 escopa a org) e
// `is_mock = false` em toda consulta — mock é sintético e NUNCA conta como
// dado. NÃO trocar por run_widget_query: `is_mock` não está nas colunas de
// filtro do RPC e a regra 0052 removeria o gate `not is_mock` quando uma
// chave de Data Reunião estivesse entre as métricas. `limit(1)` (early-exit)
// em vez de count exact: página admin de baixa frequência, sem varrer a base
// quando há dado.
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ALWAYS_FILLED_CORE_PERIOD_FIELDS,
  NULLABLE_CORE_PERIOD_FIELDS,
} from "@/lib/source-date-fields";

export interface PeriodFieldProbe {
  // A base tem ≥1 linha NÃO-mock? (false = fallback das colunas core no picker)
  hasRows: boolean;
  // Valores de campo de período com ≥1 linha preenchida não-mock
  // ("closed_at", "custom:<key>", ...).
  filled: Set<string>;
}

// Uma linha não-mock com `col` preenchida? (sem col = existência da base).
// `nonEmpty` acrescenta "e não-vazia" — semântica dos custom (texto no jsonb),
// a mesma do ramo count do RPC (0049). Erro degrada para "não" (a coluna some
// da oferta; a página nunca quebra).
async function probeOne(
  supabase: SupabaseClient,
  recordType: string,
  col?: string,
  nonEmpty = false
): Promise<boolean> {
  let query = supabase
    .from("records")
    .select("id")
    .eq("record_type", recordType)
    .eq("is_mock", false);
  if (col) {
    query = query.not(col, "is", null);
    if (nonEmpty) query = query.neq(col, "");
  }
  const { data, error } = await query.limit(1);
  return !error && Boolean(data && data.length > 0);
}

/**
 * Sonda quais campos de data da base têm ≥1 linha preenchida não-mock.
 * `customKeys` são field_keys de campos custom de DATA, SEM o prefixo
 * "custom:" (o retorno os devolve prefixados).
 */
export async function probeFilledPeriodFields(
  supabase: SupabaseClient,
  recordType: string,
  customKeys: string[]
): Promise<PeriodFieldProbe> {
  const hasRows = await probeOne(supabase, recordType);
  const filled = new Set<string>();
  if (!hasRows) return { hasRows, filled };

  // created_at/updated_at são NOT NULL: preenchidas em qualquer linha.
  for (const col of ALWAYS_FILLED_CORE_PERIOD_FIELDS) filled.add(col);
  await Promise.all([
    ...NULLABLE_CORE_PERIOD_FIELDS.map(async (col) => {
      if (await probeOne(supabase, recordType, col)) filled.add(col);
    }),
    ...customKeys.map(async (key) => {
      if (
        await probeOne(supabase, recordType, `custom_fields->>${key}`, true)
      )
        filled.add(`custom:${key}`);
    }),
  ]);
  return { hasRows, filled };
}
