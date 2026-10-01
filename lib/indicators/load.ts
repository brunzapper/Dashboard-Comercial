// Versão: 1.0 | Data: 01/10/2026
// Loader do catálogo de Indicadores (0149). `cache()` por request, org
// EXPLÍCITA quando conhecida (multi-org: a RLS deixa ver as duas orgs, o
// filtro resolve a VISÃO — padrão dos loaders de lib/config). Tabela ausente
// (pré-migração) ou falha ⇒ lista vazia: nada do resto do app depende dela.
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  INDICATOR_COLUMNS,
  parseIndicatorRow,
  type IndicatorDef,
} from "./model";

export const loadIndicators = cache(async function loadIndicators(
  supabase: SupabaseClient,
  orgId: string | null
): Promise<IndicatorDef[]> {
  try {
    let q = supabase
      .from("indicators")
      .select(INDICATOR_COLUMNS)
      .order("sort_order", { ascending: true })
      .order("label", { ascending: true });
    if (orgId) q = q.eq("organization_id", orgId);
    const { data, error } = await q;
    if (error || !data) return [];
    const out: IndicatorDef[] = [];
    for (const row of data as Record<string, unknown>[]) {
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
