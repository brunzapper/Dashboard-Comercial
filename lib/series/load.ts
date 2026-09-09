// Versão: 1.0 | Data: 09/09/2026
// Leitura das exceções de cadência (`series_settings`, 0132).
//
// Aceita org EXPLÍCITA porque o chamador principal é o tick (service role, que
// bypassa RLS): consulta sem escopo de org misturaria a cadência de duas
// organizações na mesma série homônima. Pela tela, o client RLS do usuário já
// recorta e o `orgId` é redundante mas inofensivo.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { SeriesSetting } from "./cadence";
import type { SeriesScopeKind } from "./types";

const SELECT =
  "id, series_key, scope_kind, scope_value, cadence_days, active, note, updated_at";

export interface SeriesSettingRow extends SeriesSetting {
  id: string;
  seriesKey: string;
  note: string | null;
  updatedAt: string;
}

function toRow(r: Record<string, unknown>): SeriesSettingRow {
  return {
    id: r.id as string,
    seriesKey: r.series_key as string,
    scopeKind: r.scope_kind as SeriesScopeKind,
    scopeValue: r.scope_value as string,
    cadenceDays: (r.cadence_days as number | null) ?? null,
    active: r.active !== false,
    note: (r.note as string | null) ?? null,
    updatedAt: r.updated_at as string,
  };
}

/** Exceções agrupadas por série — o formato que o avaliador consome. */
export async function loadSeriesSettings(
  db: SupabaseClient,
  orgId: string | null,
  seriesKeys: string[]
): Promise<Map<string, SeriesSetting[]>> {
  const out = new Map<string, SeriesSetting[]>();
  if (seriesKeys.length === 0) return out;

  let q = db.from("series_settings").select(SELECT).in("series_key", seriesKeys);
  if (orgId) q = q.eq("organization_id", orgId);
  const { data, error } = await q;
  if (error || !data) return out;

  for (const raw of data as Record<string, unknown>[]) {
    const row = toRow(raw);
    const list = out.get(row.seriesKey);
    if (list) list.push(row);
    else out.set(row.seriesKey, [row]);
  }
  return out;
}

/** Exceções de UMA série, cruas — o painel de gestão e a Tree. */
export async function loadSeriesSettingRows(
  db: SupabaseClient,
  orgId: string | null,
  seriesKey: string
): Promise<SeriesSettingRow[]> {
  let q = db
    .from("series_settings")
    .select(SELECT)
    .eq("series_key", seriesKey)
    .order("scope_kind")
    .order("scope_value");
  if (orgId) q = q.eq("organization_id", orgId);
  const { data, error } = await q;
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(toRow);
}
