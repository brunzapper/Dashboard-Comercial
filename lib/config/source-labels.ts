// Versão: 1.1 | Data: 16/07/2026
// Rótulos de exibição das fontes (nomes CURTOS dos prefixos/chips nos dropdowns
// de campo + rótulo "Geral"), editados em Configurações → Fontes.
// v1.1 (16/07/2026): fontes dinâmicas — o nome curto por fonte agora é
//   canônico em data_sources.short_label (catálogo; migração 0060 copia o
//   legado). sync_config 'source_labels' segue guardando o rótulo "geral" e os
//   overrides LEGADOS dos builtins — que só valem enquanto o catálogo ainda
//   está no valor semeado (pré-migração/fallback), espelhando a guarda da 0060.
// Persistência sync_config: leitura p/ qualquer autenticado, escrita admin
// (0009). O viewer público de snapshots carrega via service role
// (app/s/[token]), sem policy anon (regra do projeto).
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  BUILTIN_SOURCES,
  DEFAULT_SOURCE_DISPLAY_LABELS,
  type SourceDef,
  type SourceDisplayLabels,
} from "@/lib/sources";

export const SOURCE_LABELS_CONFIG_KEY = "source_labels";

function cleanLabel(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 && s.length <= 40 ? s : null;
}

/** Mescla catálogo + valor salvo (parcial/ausente/inválido) com os defaults. */
export function mergeSourceLabels(
  value: unknown,
  sources: SourceDef[] = BUILTIN_SOURCES
): SourceDisplayLabels {
  const raw = (value ?? {}) as Record<string, unknown>;
  const out: SourceDisplayLabels = {};
  for (const s of sources) {
    out[s.key] = s.shortLabel;
    // Override legado do sync_config: só enquanto o catálogo está no valor
    // semeado do builtin (mesma guarda da migração 0060).
    const seeded = BUILTIN_SOURCES.find((b) => b.key === s.key)?.shortLabel;
    if (s.builtin && s.shortLabel === seeded) {
      const legacy = cleanLabel(raw[s.key]);
      if (legacy) out[s.key] = legacy;
    }
  }
  out.geral =
    cleanLabel(raw.geral) ?? DEFAULT_SOURCE_DISPLAY_LABELS.geral;
  return out;
}

/**
 * Só o fetch do sync_config (não depende do catálogo de fontes) — permite
 * buscar em paralelo com loadSources e mesclar depois via mergeSourceLabels.
 */
export async function loadSourceLabelsValue(
  supabase: SupabaseClient
): Promise<unknown> {
  const { data } = await supabase
    .from("sync_config")
    .select("value")
    .eq("key", SOURCE_LABELS_CONFIG_KEY)
    .maybeSingle();
  return data?.value;
}

/** Lê os rótulos de exibição das fontes; qualquer falha cai nos defaults. */
export async function loadSourceLabels(
  supabase: SupabaseClient,
  sources: SourceDef[] = BUILTIN_SOURCES
): Promise<SourceDisplayLabels> {
  return mergeSourceLabels(await loadSourceLabelsValue(supabase), sources);
}
