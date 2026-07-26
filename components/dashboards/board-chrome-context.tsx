"use client";
// Versão: 1.0 | Data: 26/07/2026
// Cromo dos cards do dashboard (DashboardSettings.hideComparisonLabels/
// hideBusinessDayBadges) propagado por context, no molde do FontScaleProvider:
// chega a WidgetCard/WidgetChart sem prop-drilling e vale automaticamente no
// viewer de snapshot (que renderiza o DashboardGrid real). Cada widget pode
// sobrescrever (tri-state): ComparisonSettings.hideLabel e
// AppearanceSettings.hideBusinessDayBadge. Default false/false protege
// renders fora do grid (ex.: página dedicada de kanban).
import { createContext, useContext } from "react";

export interface BoardChrome {
  hideComparisonLabels: boolean;
  hideBusinessDayBadges: boolean;
}

const BoardChromeContext = createContext<BoardChrome>({
  hideComparisonLabels: false,
  hideBusinessDayBadges: false,
});

export function BoardChromeProvider({
  value,
  children,
}: {
  value: BoardChrome;
  children: React.ReactNode;
}) {
  return (
    <BoardChromeContext.Provider value={value}>
      {children}
    </BoardChromeContext.Provider>
  );
}

export function useBoardChrome(): BoardChrome {
  return useContext(BoardChromeContext);
}
