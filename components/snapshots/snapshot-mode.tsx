// Versão: 1.0 | Data: 15/07/2026
// Modo SNAPSHOT (viewer público /s/<token>): contexto lido pelos componentes
// do dashboard que precisam se comportar diferente sem sessão:
//  * QuickFiltersBar grava a seleção na URL (qf_<widget>_<entry>) em vez de
//    persistir no servidor (a seleção é POR VISITANTE, nunca compartilhada);
//  * CalculatorWidget avalia local e NUNCA persiste a expressão;
//  * QuickTableWidget usa o resultado BI precomputado no servidor da página
//    (a action deferida runQuickTable exige sessão) e fica somente-leitura.
// Fora do provider, `snapshot` é false e nada muda no app autenticado.
"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { QuickTableResult } from "@/app/(app)/dashboards/quick-table-actions";

export interface SnapshotMode {
  snapshot: boolean;
  // Resultado BI/expressões por widget de Tabela Livre, precomputado na page
  // pública sobre o dataset congelado.
  quickTableResults?: Record<string, QuickTableResult>;
}

const SnapshotModeContext = createContext<SnapshotMode>({ snapshot: false });

export function SnapshotModeProvider({
  value,
  children,
}: {
  value: SnapshotMode;
  children: ReactNode;
}) {
  return (
    <SnapshotModeContext.Provider value={value}>
      {children}
    </SnapshotModeContext.Provider>
  );
}

export function useSnapshotMode(): SnapshotMode {
  return useContext(SnapshotModeContext);
}
