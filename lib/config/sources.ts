// Versão: 1.1 | Data: 16/07/2026
// v1.1 (16/07/2026): manual_entry (0061) — a fonte aceita criação manual.
// Loader do catálogo de fontes dinâmicas (tabela data_sources, migração 0060).
// Mesma resiliência de lib/config/source-labels.ts: qualquer falha (tabela
// ausente pré-migração, erro de rede) cai nos 3 builtins de lib/sources.ts.
// RLS: leitura p/ autenticados; o viewer público de snapshots carrega via
// service role (app/s/[token]), sem policy anon (regra do projeto).
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { BUILTIN_SOURCES, type SourceDef } from "@/lib/sources";

export const loadSources = cache(async function loadSources(
  supabase: SupabaseClient
): Promise<SourceDef[]> {
  try {
    const { data, error } = await supabase
      .from("data_sources")
      .select(
        "key, record_type, label, short_label, default_period_field, builtin, manual_entry"
      )
      .order("builtin", { ascending: false })
      .order("created_at", { ascending: true });
    if (error || !data || data.length === 0) return BUILTIN_SOURCES;
    return data.map((r) => {
      const key = r.key as string;
      const label = (r.label as string) || key;
      return {
        key,
        recordType: (r.record_type as string) || key,
        label,
        shortLabel: (r.short_label as string) || label,
        defaultPeriodField:
          (r.default_period_field as string) || "source_created_at",
        builtin: Boolean(r.builtin),
        manualEntry: Boolean(r.manual_entry),
      };
    });
  } catch {
    return BUILTIN_SOURCES;
  }
});
