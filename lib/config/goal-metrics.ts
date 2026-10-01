// Versão: 1.1 | Data: 01/10/2026
// v1.1 (01/10/2026): o registry inclui os INDICADORES (0149, tabela
// `indicators`) — lidos pela RLS (org do usuário) em paralelo ao sync_config;
// tabela ausente/erro degrada para o comportamento anterior.
// Versão: 1.0 | Data: 20/07/2026
// Loader do registry de métricas de meta: builtins (lib/metas/metrics.ts) +
// métricas custom persistidas em sync_config chave 'goal_metrics'
// (JSON [{key,label,money?}]). Mesma resiliência dos demais loaders de
// lib/config/: qualquer falha cai só nos builtins.
// Persistência sync_config: leitura p/ qualquer autenticado, escrita admin
// (0009). O viewer público de snapshots carrega via service role quando
// necessário (sem policy anon — regra do projeto).
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  mergeGoalMetrics,
  type GoalMetricDef,
} from "@/lib/metas/metrics";

export const GOAL_METRICS_CONFIG_KEY = "goal_metrics";

// v1.1 (01/10/2026): só o necessário p/ o registry (chave/rótulo/unidade).
async function loadIndicatorLabels(
  supabase: SupabaseClient
): Promise<{ key: string; label: string; unit: string }[]> {
  try {
    const { data, error } = await supabase
      .from("indicators")
      .select("key, label, unit")
      .order("sort_order", { ascending: true });
    if (error || !data) return [];
    return data as { key: string; label: string; unit: string }[];
  } catch {
    return [];
  }
}

export const loadGoalMetrics = cache(async function loadGoalMetrics(
  supabase: SupabaseClient
): Promise<GoalMetricDef[]> {
  try {
    const [{ data }, indicators] = await Promise.all([
      supabase
        .from("sync_config")
        .select("value")
        .eq("key", GOAL_METRICS_CONFIG_KEY)
        .maybeSingle(),
      loadIndicatorLabels(supabase),
    ]);
    return mergeGoalMetrics(data?.value, indicators);
  } catch {
    return mergeGoalMetrics(null);
  }
});
