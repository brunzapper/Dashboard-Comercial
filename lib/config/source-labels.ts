// Versão: 1.0 | Data: 15/07/2026
// Rótulos de exibição das fontes (nomes CURTOS dos prefixos/chips nos dropdowns
// de campo + rótulo "Geral"), personalizáveis em Configurações → Fontes.
// Persistência: sync_config chave 'source_labels' (RLS: leitura p/ qualquer
// autenticado, escrita admin — 0009). O viewer público de snapshots carrega via
// service role (app/s/[token]), sem policy anon (regra do projeto).
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_SOURCE_DISPLAY_LABELS,
  type SourceDisplayLabels,
} from "@/lib/sources";

export const SOURCE_LABELS_CONFIG_KEY = "source_labels";

function cleanLabel(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 && s.length <= 40 ? s : null;
}

/** Mescla o valor salvo (parcial/ausente/inválido) com os defaults. */
export function mergeSourceLabels(value: unknown): SourceDisplayLabels {
  const raw = (value ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_SOURCE_DISPLAY_LABELS };
  for (const key of ["leads", "deals", "estudo", "geral"] as const) {
    const label = cleanLabel(raw[key]);
    if (label) out[key] = label;
  }
  return out;
}

/** Lê os rótulos de exibição das fontes; qualquer falha cai nos defaults. */
export async function loadSourceLabels(
  supabase: SupabaseClient
): Promise<SourceDisplayLabels> {
  const { data } = await supabase
    .from("sync_config")
    .select("value")
    .eq("key", SOURCE_LABELS_CONFIG_KEY)
    .maybeSingle();
  return mergeSourceLabels(data?.value);
}
