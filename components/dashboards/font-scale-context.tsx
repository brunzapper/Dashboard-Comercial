"use client";
// Versão: 1.0 | Data: 22/07/2026
// Escala de fonte do dashboard (DashboardSettings.fontScale) propagada por
// context: chega a WidgetCard/WidgetChart/tabelas sem prop-drilling e vale
// automaticamente no viewer de snapshot (que renderiza o DashboardGrid real).
// Default 1 protege renders fora do grid (ex.: página dedicada de kanban).
import { createContext, useContext } from "react";

const FontScaleContext = createContext(1);

export function FontScaleProvider({
  value,
  children,
}: {
  value: number;
  children: React.ReactNode;
}) {
  return (
    <FontScaleContext.Provider value={value}>
      {children}
    </FontScaleContext.Provider>
  );
}

export function useFontScale(): number {
  return useContext(FontScaleContext);
}
