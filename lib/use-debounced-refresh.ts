// Versão: 1.2 | Data: 04/09/2026
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
// v1.2 (04/09/2026): o refresh agendado SOBREVIVE ao desmonte de quem o
// agendou. Antes o timer vivia num useRef do componente e o cleanup o
// cancelava: como a troca de aba do dashboard DESMONTA os widgets da aba
// anterior (dashboard-client: só os widgets da aba ativa são renderizados), o
// filtro era gravado no banco mas a página nunca reconciliava — ao voltar à
// aba, o controle re-semeava das props RSC antigas e exibia o valor anterior.
// Agora o timer é de MÓDULO (a coalescência deixa de ser por controle e passa
// a ser global — rajada de N controles segue virando 1 refresh), o disparo usa
// o startTransition GLOBAL do React (o useTransition do componente morre com
// ele) e o cleanup não cancela mais nada. Guarda: o pathname é capturado no
// agendamento e o refresh é descartado se a rota mudou (o usuário saiu do
// dashboard antes de o timer disparar).
"use client";

import { startTransition, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Timer ÚNICO do app: a coalescência deixa de ser por controle e passa a ser
// global. Fora do React de propósito — é o que faz o refresh sobreviver ao
// desmonte. `pendingDeadline` guarda o prazo em voo: como os consumidores pedem
// prazos diferentes (300 no useRefreshOnActionOk, 800 no padrão, 1500 na tabela
// de registros), um agendamento LONGO não pode adiar um curto que já estava
// para vencer — só rearma quem vence ANTES. Efeito colateral desejado: uma
// rajada contínua não adia o refresh indefinidamente.
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingDeadline = 0;

export function useDebouncedRefresh(delay = 800): () => void {
  const router = useRouter();
  return useCallback(() => {
    // Rota do agendamento: se o usuário navegar para outra página antes do
    // disparo, o refresh não tem mais o que reconciliar aqui. Só o PATHNAME
    // conta — a troca de aba do dashboard mexe na query (?tab=) e não pode
    // cancelar a reconciliação do filtro que a motivou.
    const path = typeof window === "undefined" ? "" : window.location.pathname;
    const target = Date.now() + delay;
    if (pendingTimer && pendingDeadline <= target) return;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingDeadline = target;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      if (typeof window !== "undefined" && window.location.pathname !== path) {
        return;
      }
      startTransition(() => router.refresh());
    }, delay);
  }, [router, delay]);
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
