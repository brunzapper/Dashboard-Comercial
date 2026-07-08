// Versão: 1.0 | Data: 05/07/2026
// Executa a config de um widget via o RPC run_widget_query (client do usuário
// → RLS) e resolve os rótulos das dimensões FK (responsible/operation/lead:
// id→nome). Razões/derivados (TM, valor/conta) e comparação com meta ficam na
// Fase 6B (widget KPI estendido).
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AGG_LABELS,
  TRANSFORM_LABELS,
  type WidgetConfig,
  type WidgetData,
} from "./types";
import {
  fieldFk,
  fieldLabel,
  type AvailableField,
  type FkKind,
} from "./fields";

async function fetchFkLabels(
  supabase: SupabaseClient,
  fk: FkKind,
  ids: string[]
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  if (ids.length === 0) return map;

  if (fk === "responsible") {
    const { data } = await supabase
      .from("responsibles")
      .select("id, display_name")
      .in("id", ids);
    for (const r of data ?? []) map[r.id as string] = (r.display_name as string) ?? "—";
  } else if (fk === "operation") {
    const { data } = await supabase
      .from("operations")
      .select("id, name")
      .in("id", ids);
    for (const r of data ?? []) map[r.id as string] = (r.name as string) ?? "—";
  } else {
    const { data } = await supabase
      .from("records")
      .select("id, title")
      .in("id", ids);
    for (const r of data ?? []) map[r.id as string] = (r.title as string) ?? "—";
  }
  return map;
}

export async function runWidget(
  supabase: SupabaseClient,
  config: WidgetConfig,
  available: AvailableField[]
): Promise<WidgetData> {
  const { data, error } = await supabase.rpc("run_widget_query", {
    p_source: config.source,
    p_dimensions: config.dimensions,
    p_metrics: config.metrics,
    p_filters: config.filters,
  });
  if (error) throw new Error(error.message);

  const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];

  // Resolve rótulos das dimensões FK.
  for (let i = 0; i < config.dimensions.length; i++) {
    const dim = config.dimensions[i];
    const fk = fieldFk(dim.field, available);
    if (!fk) continue;
    const key = `dim_${i + 1}`;
    const ids = Array.from(
      new Set(rows.map((r) => r[key]).filter(Boolean) as string[])
    );
    if (ids.length === 0) continue;
    const labels = await fetchFkLabels(supabase, fk, ids);
    for (const r of rows) {
      const v = r[key];
      if (v != null) r[key] = labels[String(v)] ?? String(v);
    }
  }

  const dimensions = config.dimensions.map((d, i) => {
    const base = fieldLabel(d.field, available);
    const suffix =
      d.transform && d.transform !== "none"
        ? ` (${TRANSFORM_LABELS[d.transform]})`
        : "";
    return { key: `dim_${i + 1}`, label: `${base}${suffix}` };
  });

  const metrics = config.metrics.map((m, i) => ({
    key: `metric_${i + 1}`,
    label: `${AGG_LABELS[m.agg]} · ${fieldLabel(m.field, available)}`,
  }));

  return { rows, dimensions, metrics };
}
