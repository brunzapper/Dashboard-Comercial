// Versão: 1.0 | Data: 05/07/2026
// Resolução de metas (goals) com roll-up ("as metas se comunicam"):
// explicit-first e, na falta, soma de baixo p/ cima (responsáveis → operação →
// global), respeitando a subárvore de operações (operation_subtree).
import type { SupabaseClient } from "@supabase/supabase-js";

export interface GoalScope {
  scope: "global" | "operation" | "responsible";
  operationId?: string | null;
  responsibleId?: string | null;
  year: number;
  month?: number | null; // null = anual
  metric: string;
}

export interface ResolvedGoal {
  target: number | null;
  source: "explicit" | "rollup" | "none";
}

async function findExplicit(
  supabase: SupabaseClient,
  s: GoalScope
): Promise<number | null> {
  let q = supabase
    .from("goals")
    .select("target")
    .eq("period_year", s.year)
    .eq("scope", s.scope)
    .eq("metric", s.metric);
  q = s.month == null ? q.is("period_month", null) : q.eq("period_month", s.month);
  q =
    s.operationId != null
      ? q.eq("operation_id", s.operationId)
      : q.is("operation_id", null);
  q =
    s.responsibleId != null
      ? q.eq("responsible_id", s.responsibleId)
      : q.is("responsible_id", null);
  const { data } = await q.maybeSingle();
  return data ? Number(data.target) : null;
}

async function sumGoals(
  supabase: SupabaseClient,
  opts: {
    year: number;
    month?: number | null;
    scope: "operation" | "responsible";
    metric: string;
    responsibleIds?: string[];
    operationIds?: string[];
  }
): Promise<number | null> {
  let q = supabase
    .from("goals")
    .select("target")
    .eq("period_year", opts.year)
    .eq("scope", opts.scope)
    .eq("metric", opts.metric);
  q =
    opts.month == null
      ? q.is("period_month", null)
      : q.eq("period_month", opts.month);
  if (opts.responsibleIds) q = q.in("responsible_id", opts.responsibleIds);
  if (opts.operationIds) q = q.in("operation_id", opts.operationIds);
  const { data } = await q;
  if (!data || data.length === 0) return null;
  return data.reduce((s, r) => s + Number(r.target ?? 0), 0);
}

async function subtreeOps(
  supabase: SupabaseClient,
  operationId: string
): Promise<string[]> {
  const { data } = await supabase.rpc("operation_subtree", {
    p_root: operationId,
  });
  return (data ?? []).map((r: { operation_id: string }) => r.operation_id);
}

export async function resolveGoal(
  supabase: SupabaseClient,
  s: GoalScope
): Promise<ResolvedGoal> {
  const explicit = await findExplicit(supabase, s);
  if (explicit != null) return { target: explicit, source: "explicit" };

  if (s.scope === "responsible") return { target: null, source: "none" };

  if (s.scope === "operation" && s.operationId) {
    const ops = await subtreeOps(supabase, s.operationId);
    const { data: maps } = await supabase
      .from("responsible_operations")
      .select("responsible_id")
      .in("operation_id", ops);
    const respIds = Array.from(
      new Set((maps ?? []).map((m) => m.responsible_id as string))
    );
    if (respIds.length === 0) return { target: null, source: "none" };
    const sum = await sumGoals(supabase, {
      year: s.year,
      month: s.month,
      scope: "responsible",
      metric: s.metric,
      responsibleIds: respIds,
    });
    return sum != null
      ? { target: sum, source: "rollup" }
      : { target: null, source: "none" };
  }

  // global: soma metas de operação; na falta, soma metas de responsável.
  const opSum = await sumGoals(supabase, {
    year: s.year,
    month: s.month,
    scope: "operation",
    metric: s.metric,
  });
  if (opSum != null) return { target: opSum, source: "rollup" };
  const respSum = await sumGoals(supabase, {
    year: s.year,
    month: s.month,
    scope: "responsible",
    metric: s.metric,
  });
  return respSum != null
    ? { target: respSum, source: "rollup" }
    : { target: null, source: "none" };
}
