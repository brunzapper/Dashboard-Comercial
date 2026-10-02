"use client";
// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): estilo EFETIVO do dashboard (lib/dashboards/style.ts)
//   propagado por context, no molde do FontScaleProvider/BoardChromeProvider:
//   chega aos widgets sem prop-drilling e vale no viewer de snapshot (que
//   renderiza o DashboardGrid real). As CORES chegam pelas variáveis CSS do
//   contêiner; este context carrega as decisões ESTRUTURAIS (forma do card,
//   título, tabela, gráfico), que não cabem numa variável.
//   Default = Clássico: render fora de um board (página dedicada de kanban,
//   testes) segue byte-idêntico.
import { createContext, useContext } from "react";

import {
  DASHBOARD_STYLES,
  type ResolvedDashboardStyle,
} from "@/lib/dashboards/style";

const DEFAULT: ResolvedDashboardStyle = {
  ...DASHBOARD_STYLES.classico,
  origin: "app",
};

const DashboardStyleContext = createContext<ResolvedDashboardStyle>(DEFAULT);

export function DashboardStyleProvider({
  value,
  children,
}: {
  value: ResolvedDashboardStyle;
  children: React.ReactNode;
}) {
  return (
    <DashboardStyleContext.Provider value={value}>
      {children}
    </DashboardStyleContext.Provider>
  );
}

export function useDashboardStyle(): ResolvedDashboardStyle {
  return useContext(DashboardStyleContext);
}
