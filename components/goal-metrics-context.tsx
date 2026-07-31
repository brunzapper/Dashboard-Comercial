// Versão: 1.0 | Data: 31/07/2026
// Contexto client do REGISTRY de métricas de meta (goal_metrics: builtins +
// custom do sync_config) — alimenta os operandos `meta:<chave>` dos catálogos
// de fórmula agregada (widget-builder, /campos, Nota). Carregado no servidor
// (loadGoalMetrics) e provido em app/(app)/layout. Sem provider (ex.: viewer
// público), valem os builtins — inócuo: lá não há editor de fórmula.
"use client";

import { createContext, useContext } from "react";

import {
  BUILTIN_GOAL_METRICS,
  type GoalMetricDef,
} from "@/lib/metas/metrics";

const GoalMetricsContext = createContext<GoalMetricDef[]>(BUILTIN_GOAL_METRICS);

export function GoalMetricsProvider({
  metrics,
  children,
}: {
  metrics: GoalMetricDef[];
  children: React.ReactNode;
}) {
  return (
    <GoalMetricsContext.Provider value={metrics}>
      {children}
    </GoalMetricsContext.Provider>
  );
}

export function useGoalMetrics(): GoalMetricDef[] {
  return useContext(GoalMetricsContext);
}
