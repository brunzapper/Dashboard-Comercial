// Versão: 1.2 | Data: 03/10/2026
// v1.2 (03/10/2026): fim do N+1 de `goals` (redução de log ingestion do
//   Supabase): `findExplicit`/`sumGoals` leem de um MEMO por cliente —
//   uma consulta por (ano, métrica) por request, em vez de até 3 por meta por
//   mês. O memo vive na INSTÂNCIA do cliente (WeakMap): o client do usuário é
//   um por request (`createClient` em cache()), o service é um por chamada —
//   nunca atravessa requests. Quem GRAVA meta chama `invalidateGoalCache`
//   (lib/metas/upsert.ts) para a mesma action não ler valor velho. A
//   semântica (explicit-first, roll-up, ausência ⇒ null, erro degrada só a
//   chave) é a mesma.
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

/** v1.2: o que a resolução lê de uma linha de `goals`. */
interface GoalRowLite {
  period_month: number | null;
  scope: string;
  operation_id: string | null;
  responsible_id: string | null;
  target: number | string | null;
}

const GOAL_PAGE = 1000;
const goalMemo = new WeakMap<
  SupabaseClient,
  Map<string, Promise<GoalRowLite[]>>
>();

/**
 * v1.2: todas as metas de (ano, métrica) — UMA consulta por cliente (paginada
 * pelo teto de linhas do PostgREST). Falha não fica no memo: a próxima
 * resolução tenta de novo.
 */
function goalRows(
  supabase: SupabaseClient,
  year: number,
  metric: string
): Promise<GoalRowLite[]> {
  let byKey = goalMemo.get(supabase);
  if (!byKey) {
    byKey = new Map();
    goalMemo.set(supabase, byKey);
  }
  const key = `${year}|${metric}`;
  const hit = byKey.get(key);
  if (hit) return hit;
  const p = (async () => {
    const out: GoalRowLite[] = [];
    for (let from = 0; ; from += GOAL_PAGE) {
      const { data, error } = await supabase
        .from("goals")
        .select("period_month, scope, operation_id, responsible_id, target")
        .eq("period_year", year)
        .eq("metric", metric)
        .range(from, from + GOAL_PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as GoalRowLite[];
      out.push(...rows);
      if (rows.length < GOAL_PAGE) break;
    }
    return out;
  })();
  byKey.set(key, p);
  p.catch(() => {
    if (byKey.get(key) === p) byKey.delete(key);
  });
  return p;
}

/**
 * v1.2: como as consultas antigas — erro de leitura vira "sem linhas" (o
 * `{ data }` sem checar `error` devolvia null), nunca exceção.
 */
async function goalRowsOrEmpty(
  supabase: SupabaseClient,
  year: number,
  metric: string
): Promise<GoalRowLite[]> {
  try {
    return await goalRows(supabase, year, metric);
  } catch {
    return [];
  }
}

/** v1.2: descarta o memo de metas deste cliente (chamado após gravar). */
export function invalidateGoalCache(supabase: SupabaseClient): void {
  goalMemo.delete(supabase);
}

const sameMonth = (row: GoalRowLite, month: number | null | undefined) =>
  month == null ? row.period_month == null : row.period_month === month;

async function findExplicit(
  supabase: SupabaseClient,
  s: GoalScope
): Promise<number | null> {
  const rows = await goalRowsOrEmpty(supabase, s.year, s.metric);
  const hit = rows.find(
    (r) =>
      r.scope === s.scope &&
      sameMonth(r, s.month) &&
      (s.operationId != null
        ? r.operation_id === s.operationId
        : r.operation_id == null) &&
      (s.responsibleId != null
        ? r.responsible_id === s.responsibleId
        : r.responsible_id == null)
  );
  return hit ? Number(hit.target) : null;
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
  const rows = (await goalRowsOrEmpty(supabase, opts.year, opts.metric)).filter(
    (r) =>
      r.scope === opts.scope &&
      sameMonth(r, opts.month) &&
      (!opts.responsibleIds ||
        (r.responsible_id != null &&
          opts.responsibleIds.includes(r.responsible_id))) &&
      (!opts.operationIds ||
        (r.operation_id != null && opts.operationIds.includes(r.operation_id)))
  );
  if (rows.length === 0) return null;
  return rows.reduce((s, r) => s + Number(r.target ?? 0), 0);
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
