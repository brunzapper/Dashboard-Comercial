// Versão: 1.1 | Data: 31/07/2026
// Resolução de metas (goals) com roll-up ("as metas se comunicam"):
// explicit-first e, na falta, soma de baixo p/ cima (responsáveis → operação →
// global), respeitando a subárvore de operações (operation_subtree).
// v1.1: goalPeriodScope (regra período→ano/mês EXTRAÍDA byte-idêntica do KPI
// modo meta — o card e o operando `meta:` de fórmulas compartilham a MESMA
// semântica) + resolveGoalOperandValues (uma resolveGoal GLOBAL por chave;
// falha/ausência degrada por chave para null — nunca 0 fabricado, nunca
// derruba o widget).
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

/**
 * Regra período→(ano, mês) da meta — byte-idêntica ao inline histórico do KPI
 * modo meta: sem período ⇒ mês corrente (ou anual com `annualDefault`); com
 * período, meta do MÊS quando o intervalo cabe num único mês; senão meta
 * ANUAL do ano da data inicial (nunca soma metas de meses). O param é
 * estrutural (from/to) p/ não importar tipos de lib/widgets aqui.
 */
export function goalPeriodScope(
  period: { from?: string | null; to?: string | null } | null | undefined,
  now: Date,
  annualDefault?: boolean
): { year: number; month: number | null } {
  let year = now.getFullYear();
  let month: number | null = annualDefault ? null : now.getMonth() + 1;
  if (period?.from) {
    const from = new Date(`${period.from}T00:00:00`);
    const to = period.to ? new Date(`${period.to}T00:00:00`) : null;
    year = from.getFullYear();
    const sameMonth =
      to != null &&
      to.getFullYear() === from.getFullYear() &&
      to.getMonth() === from.getMonth();
    month = sameMonth ? from.getMonth() + 1 : null;
  }
  return { year, month };
}

/**
 * Valores dos operandos `meta:<chave>` de uma consulta: uma resolveGoal de
 * escopo GLOBAL por chave (roll-up incluso), em paralelo. Falha de UMA chave
 * degrada aquela chave para null (o ref fica sem lowering e a fórmula exibe
 * "—") — nunca lança, nunca fabrica 0.
 */
export async function resolveGoalOperandValues(
  supabase: SupabaseClient,
  keys: string[],
  scope: { year: number; month: number | null }
): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  await Promise.all(
    keys.map(async (key) => {
      try {
        const goal = await resolveGoal(supabase, {
          scope: "global",
          year: scope.year,
          month: scope.month,
          metric: key,
        });
        out[key] = goal.target;
      } catch {
        out[key] = null;
      }
    })
  );
  return out;
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
