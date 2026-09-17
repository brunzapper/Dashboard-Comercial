// Versão: 1.0 | Data: 17/09/2026
// Contexto client dos DADOS da Base manual (manual_series, 0142) — alimenta os
// operandos `manual:<chave>` dos catálogos de fórmula agregada
// (widget-builder, /campos, Nota) e o gestor da base.
//
// Espelho exato do goal-metrics-context: carregado no servidor
// (loadManualSeries) e provido em app/(app)/layout. Sem provider (viewer
// público de snapshot), a lista é VAZIA — lá não há editor de fórmula, e as
// fórmulas já gravadas resolvem pelos lançamentos CONGELADOS do snapshot, que
// vêm por outro caminho (o adapter de snapshot).
"use client";

import { createContext, useContext } from "react";

import type { ManualSeries } from "@/lib/manual-base/types";

const ManualSeriesContext = createContext<ManualSeries[]>([]);

export function ManualSeriesProvider({
  series,
  children,
}: {
  series: ManualSeries[];
  children: React.ReactNode;
}) {
  return (
    <ManualSeriesContext.Provider value={series}>
      {children}
    </ManualSeriesContext.Provider>
  );
}

export function useManualSeries(): ManualSeries[] {
  return useContext(ManualSeriesContext);
}
