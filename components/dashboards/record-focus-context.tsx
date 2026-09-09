// Versão: 1.0 | Data: 09/09/2026
// O REGISTRO EM FOCO de um painel: quem a tabela clicou, e que os widgets Tree
// sem registro fixo passam a mostrar.
//
// Sem isto, o widget Tree e o clique da linha nunca se falavam: o clique abria
// um painel lateral com uma Tree PRÓPRIA dentro, e o widget que a pessoa
// posicionou no dashboard ficava eternamente no estado vazio, esperando um
// `settings.tree.recordId` que nenhuma tela sabia escrever.
//
// O foco é EFÊMERO, e isso é uma decisão, não uma economia. Ele NÃO vai para
// `dashboard_table_cells` como `__qf__`/`__pw__`: aquelas são escolhas de
// CONFIGURAÇÃO, compartilhadas entre todo mundo que abre o painel. Um registro
// em foco é um momento de análise de UMA pessoa — persistir faria o clique de
// um mudar a tela de todos os outros, ao vivo, sem que ninguém tivesse pedido.
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

interface RecordFocus {
  /** Registro em foco, ou null. */
  recordId: string | null;
  /** Título dele, só para o widget dizer o que está mostrando enquanto carrega. */
  title: string | null;
  focus: (recordId: string | null, title?: string | null) => void;
  /**
   * Quantos widgets Tree neste painel seguem o foco. É isso que decide se o
   * clique da linha FOCA (há para onde olhar) ou abre o painel lateral (não
   * há) — sem essa contagem, a tabela abriria um Sheet por cima de um widget
   * que já ia mostrar a mesma coisa.
   */
  followers: number;
  registerFollower: () => () => void;
}

const Ctx = createContext<RecordFocus | null>(null);

export function RecordFocusProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<{
    recordId: string | null;
    title: string | null;
  }>({ recordId: null, title: null });
  const [followers, setFollowers] = useState(0);

  const focus = useCallback(
    (recordId: string | null, title: string | null = null) => {
      setState({ recordId, title });
    },
    []
  );

  // Contagem por montagem/desmontagem: trocar de aba do dashboard desmonta os
  // widgets da aba anterior, e um contador que só subisse deixaria a tabela
  // achando que ainda há uma Tree para focar.
  const registerFollower = useCallback(() => {
    setFollowers((n) => n + 1);
    return () => setFollowers((n) => Math.max(0, n - 1));
  }, []);

  const value = useMemo(
    () => ({ ...state, focus, followers, registerFollower }),
    [state, focus, followers, registerFollower]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * O foco do painel. Fora de um provider devolve um objeto INERTE em vez de
 * lançar: a tabela e a Tree também são usadas fora do dashboard (o viewer de
 * snapshot, a página cheia do kanban), e ali simplesmente não há foco.
 */
export function useRecordFocus(): RecordFocus {
  const ctx = useContext(Ctx);
  return (
    ctx ?? {
      recordId: null,
      title: null,
      focus: () => {},
      followers: 0,
      registerFollower: () => () => {},
    }
  );
}
