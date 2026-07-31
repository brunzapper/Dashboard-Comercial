// Versão: 1.0 | Data: 30/07/2026
// Upsert PROGRAMÁTICO de metas (goals) e do registry de métricas — IO fino com
// o client como argumento (testável; sem imports de lib/auth/*). Extraído de
// configuracoes/metas/actions.ts para ser compartilhado com a Remuneração
// (0112): a grade de remuneração digita alvos que SÃO linhas de goals (scope
// 'responsible', id canônico) — a área Metas gerencia os mesmos alvos.
// O índice único de goals usa coalesce() (expressão), então onConflict por
// colunas NÃO serve: o upsert é a dança find-then-update — mantenha os dois
// chamadores neste módulo único (nunca re-duplicar a dança).
import type { SupabaseClient } from "@supabase/supabase-js";

import { GOAL_METRICS_CONFIG_KEY } from "@/lib/config/goal-metrics";
import { mergeGoalMetrics, type GoalMetricDef } from "@/lib/metas/metrics";

/** Chave natural de uma meta (espelha o índice único com coalesce de 0016/0090). */
export interface GoalTargetKey {
  year: number;
  month: number | null; // null = meta anual
  scope: string; // 'global' | 'operation' | 'responsible'
  operationId?: string | null;
  responsibleId?: string | null;
  metric: string;
}

function findGoal(supabase: SupabaseClient, key: GoalTargetKey) {
  let find = supabase
    .from("goals")
    .select("id")
    .eq("period_year", key.year)
    .eq("scope", key.scope)
    .eq("metric", key.metric);
  find =
    key.month == null
      ? find.is("period_month", null)
      : find.eq("period_month", key.month);
  find = key.operationId
    ? find.eq("operation_id", key.operationId)
    : find.is("operation_id", null);
  find = key.responsibleId
    ? find.eq("responsible_id", key.responsibleId)
    : find.is("responsible_id", null);
  return find;
}

/**
 * Cria/atualiza a meta da chave. Retorna mensagem de erro ou null (ok).
 * Carimbo de org no INSERT (goals é raiz org-scoped — WITH CHECK falha alto
 * em org errada); o update é por id (a linha já tem org).
 */
export async function upsertGoalTarget(
  supabase: SupabaseClient,
  orgId: string | null,
  key: GoalTargetKey,
  target: number
): Promise<string | null> {
  if (!Number.isFinite(target)) return "Informe o alvo.";
  const { data: existing, error: findError } = await findGoal(
    supabase,
    key
  ).maybeSingle();
  if (findError) return findError.message;
  const row = {
    period_year: key.year,
    period_month: key.month,
    scope: key.scope,
    operation_id: key.operationId ?? null,
    responsible_id: key.responsibleId ?? null,
    metric: key.metric,
    target,
    ...(orgId ? { organization_id: orgId } : {}),
  };
  const { error } = existing?.id
    ? await supabase.from("goals").update({ target }).eq("id", existing.id)
    : await supabase.from("goals").insert(row);
  return error ? error.message : null;
}

/**
 * Exclui a meta da chave (célula de alvo LIMPA = "sem meta" — nunca gravar
 * target=0, que envenenaria o atingimento). Ausente = no-op.
 */
export async function deleteGoalTarget(
  supabase: SupabaseClient,
  key: GoalTargetKey
): Promise<string | null> {
  const { data: existing, error: findError } = await findGoal(
    supabase,
    key
  ).maybeSingle();
  if (findError) return findError.message;
  if (!existing?.id) return null;
  const { error } = await supabase.from("goals").delete().eq("id", existing.id);
  return error ? error.message : null;
}

/**
 * Registra métricas novas no registry 'goal_metrics' do sync_config (PK
 * composta org+key desde a 0090). Chave já existente (builtin ou custom) é
 * PULADA — nunca sobrescreve rótulo/money de métrica em uso. Retorna as
 * efetivamente adicionadas (o chamador decide se "nada a adicionar" é erro).
 */
export async function registerGoalMetrics(
  supabase: SupabaseClient,
  orgId: string | null,
  defs: GoalMetricDef[]
): Promise<{ added: GoalMetricDef[]; error: string | null }> {
  let regQuery = supabase
    .from("sync_config")
    .select("value")
    .eq("key", GOAL_METRICS_CONFIG_KEY);
  if (orgId) regQuery = regQuery.eq("organization_id", orgId);
  const { data, error: readError } = await regQuery.maybeSingle();
  if (readError) return { added: [], error: readError.message };
  const current = Array.isArray(data?.value) ? (data.value as unknown[]) : [];
  const existing = new Set(mergeGoalMetrics(current).map((m) => m.key));
  const added = defs.filter((d) => !existing.has(d.key));
  if (added.length === 0) return { added, error: null };
  const { error } = await supabase.from("sync_config").upsert(
    {
      key: GOAL_METRICS_CONFIG_KEY,
      value: [
        ...current,
        ...added.map((d) => ({
          key: d.key,
          label: d.label,
          ...(d.money ? { money: true } : {}),
        })),
      ],
      ...(orgId ? { organization_id: orgId } : {}),
    },
    { onConflict: "organization_id,key" }
  );
  return { added, error: error ? error.message : null };
}
