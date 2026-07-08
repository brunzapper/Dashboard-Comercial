// Versão: 1.0 | Data: 05/07/2026
// Executa a config de um widget via o RPC run_widget_query (client do usuário
// → RLS) e resolve os rótulos das dimensões FK (responsible/operation/lead:
// id→nome). Razões/derivados (TM, valor/conta) e comparação com meta ficam na
// Fase 6B (widget KPI estendido).
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AGG_LABELS,
  TRANSFORM_LABELS,
  type Metric,
  type WidgetConfig,
  type WidgetData,
  type WidgetFilter,
} from "./types";
import {
  fieldFk,
  fieldLabel,
  type AvailableField,
  type FkKind,
} from "./fields";
import { resolveGoal } from "@/lib/metas/resolve";

// Resolve tokens de período (@month_start, @year_start, ...) para datas ISO,
// deixando os presets "do mês/ano" relativos ao momento da consulta.
function resolveToken(v: unknown): unknown {
  if (typeof v !== "string" || !v.startsWith("@")) return v;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  switch (v) {
    case "@today":
      return iso(now);
    case "@month_start":
      return iso(new Date(y, m, 1));
    case "@month_end":
      return iso(new Date(y, m + 1, 0));
    case "@year_start":
      return iso(new Date(y, 0, 1));
    case "@year_end":
      return iso(new Date(y, 11, 31));
    default:
      return v;
  }
}

function resolveFilters(filters: WidgetFilter[]): WidgetFilter[] {
  return filters.map((f) => ({
    ...f,
    value: Array.isArray(f.value)
      ? f.value.map(resolveToken)
      : resolveToken(f.value),
  }));
}

function metricForMeta(metric: string): Metric {
  if (metric === "clientes") return { field: "*", agg: "count" };
  return { field: metric, agg: "sum" };
}

async function aggregate(
  supabase: SupabaseClient,
  metrics: Metric[],
  filters: WidgetFilter[]
): Promise<number[]> {
  const { data, error } = await supabase.rpc("run_widget_query", {
    p_source: "records",
    p_dimensions: [],
    p_metrics: metrics,
    p_filters: filters,
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data : [])[0] ?? {};
  return metrics.map((_, i) => Number(row[`metric_${i + 1}`] ?? 0));
}

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

// KPI com meta ou razão (Fase 6B). Retorna WidgetData.kpi.
async function runKpi(
  supabase: SupabaseClient,
  config: WidgetConfig,
  filters: WidgetFilter[]
): Promise<WidgetData> {
  const s = config.settings ?? {};
  const empty = { rows: [], dimensions: [], metrics: [] };

  if (s.mode === "ratio") {
    const num = s.numerator ?? { field: "mrr", agg: "sum" };
    const den = s.denominator ?? { field: "*", agg: "count" };
    const [n, d] = await aggregate(supabase, [num, den], filters);
    return {
      ...empty,
      kpi: {
        mode: "ratio",
        label: s.label ?? "Razão",
        value: d ? n / d : null,
      },
    };
  }

  // modo meta
  const metric = s.metric ?? "mrr";
  const [realizado] = await aggregate(supabase, [metricForMeta(metric)], filters);
  const now = new Date();
  const year = now.getFullYear();
  const month = s.period === "year" ? null : now.getMonth() + 1;
  const goal = await resolveGoal(supabase, {
    scope: s.scope ?? "global",
    operationId: s.operationId ?? null,
    responsibleId: s.responsibleId ?? null,
    year,
    month,
    metric,
  });
  const meta = goal.target;
  return {
    ...empty,
    kpi: {
      mode: "meta",
      label: s.label ?? metric.toUpperCase(),
      realizado,
      meta,
      pct: meta ? realizado / meta : null,
      falta: meta != null ? meta - realizado : null,
    },
  };
}

export async function runWidget(
  supabase: SupabaseClient,
  config: WidgetConfig,
  available: AvailableField[]
): Promise<WidgetData> {
  const filters = resolveFilters(config.filters ?? []);

  if (config.visual_type === "kpi" && config.settings?.mode) {
    return runKpi(supabase, config, filters);
  }

  const { data, error } = await supabase.rpc("run_widget_query", {
    p_source: config.source,
    p_dimensions: config.dimensions,
    p_metrics: config.metrics,
    p_filters: filters,
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
