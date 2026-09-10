// Versão: 1.0 | Data: 10/09/2026
// SELEÇÃO MÚLTIPLA — o dono único do `Set` de ids selecionados.
//
// Por que extrair agora: este desenho (Set imutável, toggle, poda contra os ids
// vivos, Esc limpa) já estava copiado em DOIS lugares
// (`components/registros/records-table.tsx` e `components/kanban/kanban-board.tsx`,
// o segundo declaradamente copiado do primeiro), e a seleção de tarefas ia
// acrescentar mais quatro. Seis cópias da mesma regra é a régua paralela da
// invariante 25 chegando por acúmulo — e o primeiro tratamento novo divergiria
// entre elas.
//
// DUAS decisões que o hook carrega, e que não são detalhe:
//
//   1. **A poda contra os ids vivos.** A lista embaixo muda (o RSC
//      re-renderiza, um filtro estreita, um item é excluído). Seleção que
//      sobrevive a um item que sumiu da tela é uma ação em massa mirando o que
//      ninguém vê. Por isso o `Set` efetivo é sempre recortado pelo universo
//      corrente — e o cálculo é DURANTE O RENDER, nunca num efeito (a regra
//      `react-hooks/set-state-in-effect` do projeto).
//
//   2. **O universo é a tela FILTRADA.** "Selecionar todas" marca o que está
//      visível, jamais "tudo o que existe no banco". A ação em massa tem teto
//      de 200 por chamada (`BULK_MAX_ITEMS`), e uma seleção que o usuário não
//      consegue ver não é uma seleção — é uma armadilha.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/** Estado do checkbox "selecionar todas" — o tri-estado do shadcn. */
export type AllCheckState = boolean | "indeterminate";

export interface BulkSelection {
  /** Ids selecionados E ainda presentes no universo, na ordem do universo. */
  selectedIds: string[];
  /** O conjunto efetivo (já podado) — para o `has` por linha. */
  selected: Set<string>;
  count: number;
  toggle: (id: string) => void;
  /** Marca/desmarca vários de uma vez (a cascata da Tree usa isto). */
  setMany: (ids: string[], checked: boolean) => void;
  clear: () => void;
  /** "Selecionar todas / nenhuma" sobre o universo corrente. */
  toggleAll: (checked: boolean) => void;
  allState: AllCheckState;
}

/**
 * @param liveIds o universo VISÍVEL, na ordem em que aparece na tela.
 * @param opts.escClears Esc limpa a seleção (padrão true — o comportamento de
 *   /registros e do kanban).
 */
export function useBulkSelection(
  liveIds: string[],
  opts: { escClears?: boolean } = {}
): BulkSelection {
  const [raw, setRaw] = useState<Set<string>>(() => new Set());

  // O universo como Set, estável enquanto o CONTEÚDO da lista não muda — um
  // array recriado a cada render (o caso comum) não invalida nada abaixo.
  // Ordem de inserção preservada: é ela que dá a ordem de `selectedIds`.
  const liveKey = liveIds.join("\u0000");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const live = useMemo(() => new Set(liveIds), [liveKey]);

  // A PODA, durante o render: o que saiu da tela sai da seleção. Fazer isso
  // num efeito daria um frame com a barra contando itens que já não existem.
  const selected = useMemo(() => {
    const out = new Set<string>();
    for (const id of raw) if (live.has(id)) out.add(id);
    return out;
  }, [raw, live]);

  // Ordem do UNIVERSO, não de clique: a barra e o resultado por item ficam
  // previsíveis (o usuário lê a lista de cima para baixo). Iterar o `Set`
  // preserva a ordem de inserção, que é a da tela — e mantém a dependência
  // em `live`, que é o que realmente muda.
  const selectedIds = useMemo(
    () => [...live].filter((id) => selected.has(id)),
    [live, selected]
  );

  const toggle = useCallback((id: string) => {
    setRaw((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setMany = useCallback((ids: string[], checked: boolean) => {
    if (ids.length === 0) return;
    setRaw((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    // `prev` vazio devolve o MESMO Set: sem re-render à toa quando o Esc é
    // apertado com nada selecionado.
    setRaw((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const toggleAll = useCallback(
    (checked: boolean) => setRaw(checked ? new Set(live) : new Set()),
    [live]
  );

  const allState: AllCheckState =
    live.size > 0 && selected.size === live.size
      ? true
      : selected.size > 0
        ? "indeterminate"
        : false;

  const escClears = opts.escClears !== false;
  useEffect(() => {
    if (!escClears) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [escClears, clear]);

  return {
    selectedIds,
    selected,
    count: selected.size,
    toggle,
    setMany,
    clear,
    toggleAll,
    allState,
  };
}
