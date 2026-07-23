// Versão: 1.4 | Data: 23/07/2026
// v1.4 (23/07/2026): multi-org (0090) — parâmetro opcional orgId filtra o
//   catálogo pela organização ATIVA. A RLS já escopa às orgs do usuário; o
//   filtro explícito resolve a visão de quem pertence a 2+ orgs (Owner) e o
//   viewer público (service role, que enxerga tudo). null/ausente = sem
//   filtro (comportamento atual; caminhos pré-migração e ingest por chave).
// v1.1 (16/07/2026): manual_entry (0061) — a fonte aceita criação manual.
// v1.3 (19/07/2026): timezone (0079) — fuso da ORIGEM da fonte; datetimes
//   ingeridos normalizam p/ Brasília no sync. Subs não têm (ingestão é da pai).
// v1.2 (19/07/2026): SUB-FONTES (0078) — une `data_sources` + `sub_sources` num
//   único SourceDef[]. Cada sub herda o record_type da PAI e carrega parentKey +
//   filter (WidgetFilter[]); aparece após as fontes raiz. Falha ao ler
//   sub_sources (tabela ausente pré-migração) apenas omite as subs.
// Loader do catálogo de fontes dinâmicas (tabela data_sources, migração 0060).
// Mesma resiliência de lib/config/source-labels.ts: qualquer falha (tabela
// ausente pré-migração, erro de rede) cai nos 3 builtins de lib/sources.ts.
// RLS: leitura p/ autenticados; o viewer público de snapshots carrega via
// service role (app/s/[token]), sem policy anon (regra do projeto).
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { BUILTIN_SOURCES, type SourceDef } from "@/lib/sources";
import type { WidgetFilter } from "@/lib/widgets/types";

export const loadSources = cache(async function loadSources(
  supabase: SupabaseClient,
  orgId?: string | null
): Promise<SourceDef[]> {
  try {
    let query = supabase
      .from("data_sources")
      .select(
        "key, record_type, label, short_label, default_period_field, builtin, manual_entry, timezone"
      )
      .order("builtin", { ascending: false })
      .order("created_at", { ascending: true });
    if (orgId) query = query.eq("organization_id", orgId);
    const { data, error } = await query;
    if (error || !data || data.length === 0) return BUILTIN_SOURCES;
    const roots: SourceDef[] = data.map((r) => {
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
        timezone: (r.timezone as string | null) || null,
      };
    });

    // Sub-fontes (0078): herdam o record_type da pai. Tabela ausente / erro =
    // só omite as subs (mantém as fontes raiz).
    const rtByKey = new Map(roots.map((s) => [s.key, s.recordType]));
    const { data: subData } = await supabase
      .from("sub_sources")
      .select("key, parent_key, label, short_label, default_period_field, filter")
      .order("created_at", { ascending: true });
    const subs: SourceDef[] = (subData ?? [])
      .map((r): SourceDef | null => {
        const key = r.key as string;
        const parentKey = r.parent_key as string;
        const recordType = rtByKey.get(parentKey);
        if (!recordType) return null; // pai fora do catálogo (não deve ocorrer)
        const label = (r.label as string) || key;
        const filter = Array.isArray(r.filter) ? (r.filter as WidgetFilter[]) : [];
        return {
          key,
          recordType,
          label,
          shortLabel: (r.short_label as string) || label,
          defaultPeriodField:
            (r.default_period_field as string) || "source_created_at",
          builtin: false,
          manualEntry: false,
          parentKey,
          filter,
        };
      })
      .filter((s): s is SourceDef => s != null);

    return [...roots, ...subs];
  } catch {
    return BUILTIN_SOURCES;
  }
});
