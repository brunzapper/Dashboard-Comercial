// Versão: 1.0 | Data: 18/07/2026
// Hook de router.refresh() debounced e FORA da transition de quem chama.
// Uso: reconciliar a página após edições inline sem travar a célula — o
// setTimeout escapa da transition do commit (o `pending` da célula termina
// quando a action retorna, não quando a página re-renderiza) e o refresh roda
// como transition própria (não-urgente); uma rajada de N edições vira 1
// recompute. Padrão extraído do quick-table (scheduleRefresh) + dashboard-client
// (startTransition(router.refresh)).
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
