// Versão: 1.0 | Data: 08/09/2026
// v1.0 (08/09/2026): choke point ÚNICO de "quem causou este refetch?".
// Widgets deferidos (engine, Tabela Livre, kanban, agenda) re-buscam por DOIS
// gatilhos distintos que exigiam feedback OPOSTO e vinham indistinguíveis no
// mesmo efeito:
//   1. o USUÁRIO mexeu (1ª carga, período, filtro, __qf__/__pw__, config do
//      widget) — o fingerprint de escopo muda ⇒ feedback VISÍVEL (overlay/dim/
//      spinner): sem ele o usuário confunde dado obsoleto com o recorte novo;
//   2. o event bus avisou que um registro mudou (realtime/sync do Bitrix, que
//      roda a CADA MINUTO — pg-cron-tick.sql; ou mutação em outra tela) ⇒
//      refetch SILENCIOSO: quem só está apresentando/analisando não pediu
//      nada, e piscar o dashboard inteiro parece defeito do sistema.
// Regra (docs/arquitetura.md §4.10, "Feedback de carregamento"): a ORIGEM do
// refetch decide o feedback. Consumidor novo do bus NÃO acende overlay.
// Generaliza o `scopeRef` que o widget de kanban já fazia inline (v1.2).
"use client";

import { useCallback, useRef } from "react";

/**
 * Atraso do refetch disparado pelo event bus (realtime/sync). Bem maior que o
 * atraso de uma ação do usuário: uma rodada do sync do Bitrix emite rajadas de
 * eventos e cada re-busca é uma server action inteira. Como é SILENCIOSO, o
 * usuário não espera por ele — só coalesce.
 */
export const BUS_REFETCH_DELAY_MS = 1500;

/**
 * Devolve uma função que responde "este disparo do efeito foi causado pelo
 * USUÁRIO?" — `true` na PRIMEIRA rodada (carga inicial) e sempre que o
 * `scopeKey` mudou desde a rodada anterior; `false` quando o efeito re-rodou
 * com o MESMO escopo (só o tick do event bus mudou).
 *
 * Deve ser chamada UMA vez por rodada, DENTRO do efeito de fetch — a chamada
 * consome a comparação e memoriza o escopo para a rodada seguinte.
 *
 * ```ts
 * const originOf = useRefetchOrigin(scopeKey);
 * useEffect(() => {
 *   const userCaused = originOf();
 *   if (userCaused) setLoading(true); // silencioso quando veio do bus
 *   …
 * }, [scopeKey, tick, originOf]);
 * ```
 */
export function useRefetchOrigin(scopeKey: string): () => boolean {
  // null = ainda não rodou. A 1ª rodada conta como "do usuário" (é a carga
  // inicial, que tem skeleton/placeholder próprio).
  const seen = useRef<string | null>(null);
  return useCallback(() => {
    const first = seen.current === null;
    const changed = seen.current !== scopeKey;
    seen.current = scopeKey;
    return first || changed;
  }, [scopeKey]);
}
