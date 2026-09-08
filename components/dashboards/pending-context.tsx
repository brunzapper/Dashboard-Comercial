// Versão: 1.1 | Data: 07/08/2026
// Contexto de "recarregando dados" do dashboard. A barra de período dispara uma
// navegação RSC (router.replace) que recomputa os widgets no servidor; sem
// indicativo, os dados antigos ficam parados e trocam de repente. Este contexto
// compartilha um useTransition entre quem navega (PeriodControls) e quem exibe
// o overlay (DashboardGrid), para mostrar "Carregando…" enquanto isso.
// v1.1: run() é EXCLUSIVO para navegação real (router.replace/refresh de
// período/URL — o overlay é não-bloqueante, pointer-events-none). SAVES de
// widget (filtro rápido, __ff__, __pw__, nota, aparência) NÃO passam por aqui:
// usam o padrão otimista em background (lib/feedback/use-background-save.ts)
// com pending granular por controle — reintroduzir um save neste transition
// escurece o board inteiro pelo tempo do re-render RSC.
"use client";

import { createContext, useContext, useMemo, useTransition } from "react";

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
  // Referência estável do value: objeto novo por render re-renderizava todos
  // os consumidores (grid inteiro) a cada render do provider.
  const value = useMemo<NavPending>(
    () => ({ pending, run: (fn) => startTransition(fn) }),
    [pending]
  );
  return (
    <PendingContext.Provider value={value}>
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
