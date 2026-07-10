// Versão: 1.0 | Data: 10/07/2026
// Contexto de "recarregando dados" do dashboard. A barra de período e os widgets
// de filtro disparam uma navegação RSC (router.replace) que recomputa os widgets
// no servidor; sem indicativo, os dados antigos ficam parados e trocam de repente.
// Este contexto compartilha um useTransition entre quem navega (PeriodControls) e
// quem exibe o overlay (DashboardGrid), para mostrar "Carregando…" enquanto isso.
"use client";

import { createContext, useContext, useTransition } from "react";

interface NavPending {
  pending: boolean;
  run: (fn: () => void) => void;
}

const PendingContext = createContext<NavPending | null>(null);

export function DashboardPendingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <PendingContext.Provider
      value={{ pending, run: (fn) => startTransition(fn) }}
    >
      {children}
    </PendingContext.Provider>
  );
}

// Retorna o transition compartilhado quando há provider; senão, um transition
// local (mantém PeriodControls utilizável fora do dashboard).
export function useNavPending(): NavPending {
  const ctx = useContext(PendingContext);
  const [pending, startTransition] = useTransition();
  return ctx ?? { pending, run: (fn) => startTransition(fn) };
}
