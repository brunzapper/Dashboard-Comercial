// Versão: 1.1 | Data: 31/07/2026
// v1.1: expõe `pendingIds` (ids dos cards com escrita em voo) p/ o indicador
//   POR CARD do board — refcount, não Set: o mesmo card pode ser re-enfileirado
//   antes do primeiro job drenar (A→X e depois A→Y; retry re-enfileira).
// Fila OTIMISTA das ações em massa do kanban: aplica a mudança local
// imediatamente (mover/excluir/badges), despacha as server actions em
// BACKGROUND (chunks sequenciais — actions serializam por cliente) e, com os
// resultados POR ITEM, reverte SÓ os cards que falharam, acumulando-os num
// painel persistente com "Tentar novamente". É o que deixa o movimento fluido:
// a UI nunca espera o banco. Extensão do padrão fire-and-forget do
// quick-table (saveCells) com granularidade por item. Quem decide COMO aplicar/
// reverter é o job (o board conhece o shape das colunas); a fila cuida de
// ordem, pending, falhas e do momento de reconciliar (onSettled ao drenar).
"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import type { KanbanColumnCards } from "@/lib/kanban/data";
import type { BulkActionState } from "@/lib/kanban/bulk-helpers";

export interface QueueItem {
  id: string;
  fromKey: string;
  title: string;
  dateValue: string | null;
}

export interface QueueJob {
  // Rótulo curto da ação p/ mensagens ("mover", "excluir"…).
  label: string;
  items: QueueItem[];
  // Aplicação otimista (todos os itens) e reversão parcial (só os falhos).
  apply: (cols: KanbanColumnCards[]) => KanbanColumnCards[];
  revert: (
    cols: KanbanColumnCards[],
    failedIds: Set<string>
  ) => KanbanColumnCards[];
  // Executa UM chunk no servidor; resultados por item.
  exec: (items: QueueItem[]) => Promise<BulkActionState>;
}

export interface BulkFailure {
  id: string;
  title: string;
  message: string;
  job: QueueJob;
}

const EXEC_CHUNK = 50;

export function useKanbanBulkQueue(opts: {
  setColumns: React.Dispatch<React.SetStateAction<KanbanColumnCards[]>>;
  // Reconciliar ao drenar (emitDataChanged + refresh debounced do board).
  onSettled: () => void;
}): {
  pending: number;
  // Ids dos cards com escrita em voo (indicador por card no board).
  pendingIds: Set<string>;
  failures: BulkFailure[];
  enqueue: (job: QueueJob) => void;
  retry: () => void;
  dismissFailures: () => void;
} {
  const { setColumns, onSettled } = opts;
  const [pending, setPending] = useState(0);
  // Refcount por card (id → nº de jobs em voo que o incluem).
  const [pendingById, setPendingById] = useState<Map<string, number>>(
    new Map()
  );
  const [failures, setFailures] = useState<BulkFailure[]>([]);
  const jobsRef = useRef<QueueJob[]>([]);
  const runningRef = useRef(false);

  const drain = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      for (;;) {
        const job = jobsRef.current.shift();
        if (!job) break;
        const failed = new Map<string, string>();
        for (let i = 0; i < job.items.length; i += EXEC_CHUNK) {
          const slice = job.items.slice(i, i + EXEC_CHUNK);
          let state: BulkActionState;
          try {
            state = await job.exec(slice);
          } catch {
            state = { ok: false, message: "Falha de rede." };
          }
          if (!state.ok) {
            const msg = state.message ?? "Falha ao processar.";
            for (const item of slice) failed.set(item.id, msg);
          } else {
            for (const r of state.results ?? []) {
              if (!r.ok) failed.set(r.id, r.message ?? "Falha ao processar.");
            }
          }
          setPending((p) => Math.max(0, p - slice.length));
          // Decrementa mesmo em falha: o item falho é revertido e vai ao
          // painel de falhas — não está mais "sincronizando".
          setPendingById((prev) => {
            const next = new Map(prev);
            for (const item of slice) {
              const n = (next.get(item.id) ?? 0) - 1;
              if (n <= 0) next.delete(item.id);
              else next.set(item.id, n);
            }
            return next;
          });
        }
        if (failed.size > 0) {
          const failedIds = new Set(failed.keys());
          setColumns((cols) => job.revert(cols, failedIds));
          setFailures((prev) => [
            ...prev,
            ...job.items
              .filter((it) => failed.has(it.id))
              .map((it) => ({
                id: it.id,
                title: it.title,
                message: failed.get(it.id)!,
                job,
              })),
          ]);
        }
      }
    } finally {
      runningRef.current = false;
      // Drenou: reconcilia UMA vez (os dados frescos chegam via props e o
      // guard de resync do board os aplica com pending === 0).
      onSettled();
    }
  }, [setColumns, onSettled]);

  const enqueue = useCallback(
    (job: QueueJob) => {
      if (job.items.length === 0) return;
      setColumns((cols) => job.apply(cols));
      setPending((p) => p + job.items.length);
      setPendingById((prev) => {
        const next = new Map(prev);
        for (const item of job.items)
          next.set(item.id, (next.get(item.id) ?? 0) + 1);
        return next;
      });
      jobsRef.current.push(job);
      void drain();
    },
    [setColumns, drain]
  );

  const retry = useCallback(() => {
    setFailures((prev) => {
      // Re-enfileira agrupando pelos jobs de origem (mesma ação/exec).
      const byJob = new Map<QueueJob, BulkFailure[]>();
      for (const f of prev) {
        if (!byJob.has(f.job)) byJob.set(f.job, []);
        byJob.get(f.job)!.push(f);
      }
      for (const [job, fails] of byJob) {
        const ids = new Set(fails.map((f) => f.id));
        enqueue({
          ...job,
          items: job.items.filter((it) => ids.has(it.id)),
        });
      }
      return [];
    });
  }, [enqueue]);

  const dismissFailures = useCallback(() => setFailures([]), []);

  const pendingIds = useMemo(
    () => new Set(pendingById.keys()),
    [pendingById]
  );

  return { pending, pendingIds, failures, enqueue, retry, dismissFailures };
}
