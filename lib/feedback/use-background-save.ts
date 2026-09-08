// Versão: 1.1 | Data: 04/09/2026
// v1.1 (04/09/2026): só documentação. O save já sobrevivia ao desmonte de quem
// o disparou (a IIFE não é cancelada), mas o refresh de reconciliação NÃO — ele
// vivia num timer do componente. Com useDebouncedRefresh v1.2 o timer é de
// módulo e sobrevive: gravação e reconciliação seguem valendo quando o controle
// desmonta no meio (troca de aba do dashboard). Quem tem debounce PRÓPRIO antes
// do save (filtros rápidos, filtro por campo, barra de tabela) precisa flushar o
// payload pendente no desmonte — o save aqui só recebe o que já foi disparado.
// Hook ÚNICO do padrão "save otimista em background" (docs/arquitetura.md
// §Feedback de carregamento): o chamador aplica o estado otimista ANTES e
// dispara `save()` — a UI segue interativa. A action deve rodar SEM
// revalidatePath (opts { revalidate: false }): o await volta logo após o
// INSERT/UPDATE, não após o re-render RSC da rota. Falha (ok:false ou
// rejeição) vira toast (notifyOnError) + `revert()` granular do controle;
// sucesso agenda UM router.refresh() debounced — reconciliador ÚNICO destes
// fluxos (o realtime não cobre dashboard_table_cells/widgets/
// entity_custom_values). `pendingKeys` alimenta spinner POR CONTROLE (nunca
// overlay de tela); `hasPending` guarda os reseeds do padrão seedKey (eco
// antigo não pode clobberar o otimista com save em voo). Refcount por key:
// dois saves em voo do mesmo controle = 1 pending (padrão pendingById da
// fila do kanban).
"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { notifyOnError } from "@/lib/feedback/notify";
import { useDebouncedRefresh } from "@/lib/use-debounced-refresh";

type ActionLike = { ok?: boolean; message?: string } | void | null | undefined;

export interface BackgroundSaveInput {
  /** Identidade do controle (célula/chip/linha) — governa o refcount. */
  key: string;
  /** Contexto pt-BR do toast de erro (ex.: "Não foi possível salvar o filtro"). */
  context: string;
  /** Chamada da server action, já com `{ revalidate: false }`. */
  action: () => Promise<ActionLike>;
  /** Restaura o estado otimista do controle na falha (revert granular). */
  revert?: () => void;
  /** false = não agendar o refresh de reconciliação no sucesso (default true). */
  reconcile?: boolean;
}

export interface BackgroundSave {
  save: (input: BackgroundSaveInput) => void;
  /** Keys com save em voo (spinner por controle). */
  pendingKeys: ReadonlySet<string>;
  /** Guarda anti-reseed: enquanto true, o eco de props do servidor é stale. */
  hasPending: boolean;
}

export function useBackgroundSave(): BackgroundSave {
  const refresh = useDebouncedRefresh();
  // Refcount por key: o estado é derivado do Map (nunca mutado no render).
  const countsRef = useRef<Map<string, number>>(new Map());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  const save = useCallback(
    (input: BackgroundSaveInput) => {
      const counts = countsRef.current;
      counts.set(input.key, (counts.get(input.key) ?? 0) + 1);
      setPendingKeys(new Set(counts.keys()));
      void (async () => {
        const res = await notifyOnError(input.action(), input.context);
        // Contrato do notifyOnError: undefined = rejeição (rede); ok:false =
        // recusa da action. Ambos revertem; sucesso reconcilia via refresh
        // debounced (agendado APÓS o commit — o eco já traz o valor gravado).
        if (res === undefined || res?.ok === false) input.revert?.();
        else if (input.reconcile !== false) refresh();
        const n = (counts.get(input.key) ?? 1) - 1;
        if (n <= 0) counts.delete(input.key);
        else counts.set(input.key, n);
        setPendingKeys(new Set(counts.keys()));
      })();
    },
    [refresh]
  );

  return useMemo(
    () => ({ save, pendingKeys, hasPending: pendingKeys.size > 0 }),
    [save, pendingKeys]
  );
}
