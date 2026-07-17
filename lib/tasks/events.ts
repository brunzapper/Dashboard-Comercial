// Versão: 1.1 | Data: 17/07/2026
// Event bus CLIENT-SIDE de mudanças de tarefas/comentários/registros: mutação
// concluída em qualquer superfície → emitDataChanged → assinantes (widget
// kanban, agenda, sino, listas) recarregam na hora.
// v1.1 (17/07/2026): o bus também é alimentado pelo Supabase Realtime
// (components/realtime-refresher.tsx, coalescido) — mudanças de OUTROS
// usuários/syncs chegam pelo mesmo caminho; o alcance deixou de ser só a
// própria aba. Emita SEMPRE no client, após a Server Action resolver ok —
// nunca de dentro da action (não há window no server).
"use client";

import { useEffect, useRef } from "react";

export const DATA_CHANGED_EVENT = "app:tasks-changed";

export interface DataChangedDetail {
  kind: "task" | "comment" | "record";
  recordId?: string | null;
  taskId?: string | null;
  boardId?: string | null;
}

/** Anuncia uma mutação concluída (no-op fora do browser). */
export function emitDataChanged(detail: DataChangedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<DataChangedDetail>(DATA_CHANGED_EVENT, { detail })
  );
}

/**
 * Subscreve mudanças de dados. O handler fica em ref — o listener é registrado
 * uma única vez e sempre chama a versão mais recente (sem re-subscrever).
 */
export function useDataChanged(handler: (d: DataChangedDetail) => void): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const onEvent = (e: Event) => {
      ref.current((e as CustomEvent<DataChangedDetail>).detail);
    };
    window.addEventListener(DATA_CHANGED_EVENT, onEvent);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, onEvent);
  }, []);
}
