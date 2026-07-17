// Versão: 1.0 | Data: 17/07/2026
// Assinante Supabase Realtime do app autenticado (montado uma vez no layout
// (app)): postgres_changes de records/tasks/comments (publication 0071) usados
// apenas como SINAL — nenhum dado do payload é aplicado. Ao receber eventos:
//   1. emitDataChanged por kind presente no buffer (kanban/agenda/sino já
//      reagem ao bus — lib/tasks/events.ts);
//   2. router.refresh() coalescido (RSC recomputa dashboards/listas).
// Assim, mudanças de OUTROS usuários e dos syncs aparecem sem navegar.
//
// Coalescing obrigatório: um sync do Bitrix pode emitir centenas de eventos —
// debounce trailing de 2s com teto de 10s de espera ⇒ no máx. 1 refresh por
// rajada. Aba oculta: desassina (economiza conexão) e, ao voltar, faz UM
// refresh de recuperação + reassina. RLS vale no canal: cada usuário só recebe
// eventos de linhas que pode ver. Erro/timeout do canal: retry com backoff.
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/browser";
import { emitDataChanged, type DataChangedDetail } from "@/lib/tasks/events";

const TABLE_KIND: Record<string, DataChangedDetail["kind"]> = {
  records: "record",
  tasks: "task",
  comments: "comment",
};

const DEBOUNCE_MS = 2000;
const MAX_WAIT_MS = 10000;
const RETRY_BASE_MS = 5000;
const RETRY_MAX_MS = 60000;

export function RealtimeRefresher() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    let disposed = false;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
    const pendingKinds = new Set<DataChangedDetail["kind"]>();

    const clearFlushTimers = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (maxWaitTimer) clearTimeout(maxWaitTimer);
      debounceTimer = null;
      maxWaitTimer = null;
    };

    const flush = () => {
      clearFlushTimers();
      if (pendingKinds.size === 0) return;
      const kinds = [...pendingKinds];
      pendingKinds.clear();
      for (const kind of kinds) emitDataChanged({ kind });
      router.refresh();
    };

    const onEvent = (table: string) => {
      const kind = TABLE_KIND[table];
      if (!kind) return;
      pendingKinds.add(kind);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(flush, DEBOUNCE_MS);
      if (!maxWaitTimer) maxWaitTimer = setTimeout(flush, MAX_WAIT_MS);
    };

    const unsubscribe = () => {
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
    };

    const scheduleRetry = () => {
      if (disposed || document.hidden || retryTimer) return;
      const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retry);
      retry += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        unsubscribe();
        subscribe();
      }, delay);
    };

    const subscribe = () => {
      if (disposed || document.hidden || channel) return;
      let ch = supabase.channel("app-data-changes");
      for (const table of Object.keys(TABLE_KIND)) {
        ch = ch.on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          () => onEvent(table)
        );
      }
      channel = ch.subscribe((status) => {
        if (status === "SUBSCRIBED") retry = 0;
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          scheduleRetry();
        }
      });
    };

    const onVisibility = () => {
      if (document.hidden) {
        // Aba em segundo plano: solta a conexão e descarta a rajada pendente —
        // a recuperação ao voltar cobre o que aconteceu enquanto isso.
        unsubscribe();
        clearFlushTimers();
        pendingKinds.clear();
      } else {
        subscribe();
        // Refresh único de recuperação (eventos durante a aba oculta se perdem).
        router.refresh();
      }
    };

    subscribe();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      clearFlushTimers();
      unsubscribe();
    };
    // router é estável (useRouter); assina uma vez por mount do layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
