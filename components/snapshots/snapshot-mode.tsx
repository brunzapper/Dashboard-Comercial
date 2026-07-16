// Versão: 1.1 | Data: 16/07/2026
// v1.1 (16/07/2026): kanbanResults — quadro precomputado por widget kanban
//   (modo registros; tarefas nunca entram no snapshot).
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
import type { KanbanWidgetResult } from "@/app/(app)/dashboards/kanban-actions";

export interface SnapshotMode {
  snapshot: boolean;
  // Resultado BI/expressões por widget de Tabela Livre, precomputado na page
  // pública sobre o dataset congelado.
  quickTableResults?: Record<string, QuickTableResult>;
  // Quadro precomputado por widget kanban (só modo registros — read-only).
  kanbanResults?: Record<string, KanbanWidgetResult>;
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
