// Versão: 1.1 | Data: 18/09/2026
// v1.1 (18/09/2026): o contexto passa a carregar também os EIXOS (0143) —
//   famílias, membros e a declaração por dado. Um provider só, um carregamento
//   só: dois contextos irmãos divergiriam no primeiro sítio que esquecesse de
//   consumir o segundo, e é justamente a divergência entre a OFERTA (construtor)
//   e a VALIDAÇÃO (save) que a v2.8 já custou uma entrega.
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
import {
  EMPTY_MANUAL_AXIS_CATALOG,
  type ManualAxisCatalog,
} from "@/lib/manual-base/families";

const ManualSeriesContext = createContext<ManualSeries[]>([]);
const ManualAxesContext = createContext<ManualAxisCatalog>(
  EMPTY_MANUAL_AXIS_CATALOG
);

export function ManualSeriesProvider({
  series,
  axes = EMPTY_MANUAL_AXIS_CATALOG,
  children,
}: {
  series: ManualSeries[];
  axes?: ManualAxisCatalog;
  children: React.ReactNode;
}) {
  return (
    <ManualSeriesContext.Provider value={series}>
      <ManualAxesContext.Provider value={axes}>
        {children}
      </ManualAxesContext.Provider>
    </ManualSeriesContext.Provider>
  );
}

export function useManualSeries(): ManualSeries[] {
  return useContext(ManualSeriesContext);
}

/** Os EIXOS da Base manual (0143). Sem provider — viewer público — vem vazio,
 *  e lá não há editor de fórmula. */
export function useManualAxes(): ManualAxisCatalog {
  return useContext(ManualAxesContext);
}
