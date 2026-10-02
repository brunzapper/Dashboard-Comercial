// Versão: 1.1 | Data: 02/10/2026
// v1.1 (02/10/2026): coluna `attention_pct` (0150) com FALLBACK para as
//   colunas anteriores se a migração ainda não rodou — o catálogo não some.
// Loader do catálogo de Indicadores (0149). `cache()` por request, org
// EXPLÍCITA quando conhecida (multi-org: a RLS deixa ver as duas orgs, o
// filtro resolve a VISÃO — padrão dos loaders de lib/config). Tabela ausente
// (pré-migração) ou falha ⇒ lista vazia: nada do resto do app depende dela.
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  INDICATOR_COLUMNS,
  INDICATOR_COLUMNS_LEGACY,
  parseIndicatorRow,
  type IndicatorDef,
} from "./model";

export const loadIndicators = cache(async function loadIndicators(
  supabase: SupabaseClient,
  orgId: string | null
): Promise<IndicatorDef[]> {
  try {
    const query = (cols: string) => {
      let q = supabase
        .from("indicators")
        .select(cols)
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true });
      if (orgId) q = q.eq("organization_id", orgId);
      return q;
    };
    let { data, error } = await query(INDICATOR_COLUMNS);
    if (error) ({ data, error } = await query(INDICATOR_COLUMNS_LEGACY));
    if (error || !data) return [];
    const out: IndicatorDef[] = [];
    for (const row of data as unknown as Record<string, unknown>[]) {
      const def = parseIndicatorRow(row);
      if (def) out.push(def);
    }
    return out;
  } catch {
    return [];
  }
});

/** Mapa por chave (consumidores olham um indicador por vez). */
export function indicatorsByKey(defs: IndicatorDef[]): Map<string, IndicatorDef> {
  return new Map(defs.map((d) => [d.key, d]));
}
