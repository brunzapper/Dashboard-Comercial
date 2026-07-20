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

export const loadGoalMetrics = cache(async function loadGoalMetrics(
  supabase: SupabaseClient
): Promise<GoalMetricDef[]> {
  try {
    const { data } = await supabase
      .from("sync_config")
      .select("value")
      .eq("key", GOAL_METRICS_CONFIG_KEY)
      .maybeSingle();
    return mergeGoalMetrics(data?.value);
  } catch {
    return mergeGoalMetrics(null);
  }
});
