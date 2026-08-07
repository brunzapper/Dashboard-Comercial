// Versão: 1.1 | Data: 07/08/2026
// Hook de router.refresh() debounced e FORA da transition de quem chama.
// Uso: reconciliar a página após edições inline sem travar a célula — o
// setTimeout escapa da transition do commit (o `pending` da célula termina
// quando a action retorna, não quando a página re-renderiza) e o refresh roda
// como transition própria (não-urgente); uma rajada de N edições vira 1
// recompute. Padrão extraído do quick-table (scheduleRefresh) + dashboard-client
// (startTransition(router.refresh)).
// v1.1: useRefreshOnActionOk — refresh pós-sucesso de formulários
// useActionState cujas actions NÃO revalidam mais (o form libera quando o
// INSERT/UPDATE retorna; o refresh re-renderiza a rota atual INCLUINDO o
// layout — sidebar/providers atualizam — como transition não-urgente).
"use client";

import { useCallback, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

export function useDebouncedRefresh(delay = 800): () => void {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, startTransition] = useTransition();
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      startTransition(() => router.refresh());
    }, delay);
  }, [router, delay, startTransition]);
}

// Dispara o refresh debounced quando um formulário useActionState conclui com
// ok:true. Compara por IDENTIDADE do state (cada dispatch devolve um objeto
// novo), então dois submits ok consecutivos disparam dois agendamentos —
// coalescidos pelo debounce (rajada de ↑/↓ de reordenação = 1 recompute).
export function useRefreshOnActionOk(
  state: { ok?: boolean },
  delay = 300
): void {
  const refresh = useDebouncedRefresh(delay);
  const prev = useRef(state);
  useEffect(() => {
    if (state !== prev.current) {
      prev.current = state;
      if (state.ok) refresh();
    }
  }, [state, refresh]);
}
