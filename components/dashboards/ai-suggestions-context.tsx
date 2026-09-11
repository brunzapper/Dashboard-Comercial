// Versão: 1.0 | Data: 11/09/2026
// As conversas com a IA que estão em andamento neste painel — o estado que o
// dock desenha.
//
// Por que um contexto no nível do PAINEL, e não estado do widget: a conversa
// tem de sobreviver a quem a abriu. O widget Tree segue o registro em foco,
// então clicar na próxima linha da tabela o remonta com outro registro; trocar
// de aba o desmonta de vez. Com o estado lá dentro, a análise em curso morria
// no clique seguinte — e o pedido é justamente poder comentar no próximo
// registro enquanto a análise do anterior ainda roda.
//
// Aqui NÃO mora a verdade: ela está em `tree_ai_threads` (0139). Este contexto
// guarda a lista já carregada, quais fios estão rodando agora (isso é efêmero
// por natureza — um turno em voo não sobrevive a um F5, e o servidor não tem
// como saber que o navegador sumiu) e qual está aberto no dock.
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  listCommentThreads,
  openCommentThread,
  runCommentThread,
} from "@/app/(app)/dashboards/tree-actions";
import type { CommentThread } from "@/lib/ai/analyze-comment";
import { notifyActionError } from "@/lib/feedback/notify";

interface AiSuggestions {
  threads: CommentThread[];
  /** Ids dos fios com um turno em voo — o dock mostra o "pensando" neles. */
  busy: Set<string>;
  /** Fio aberto no dock (null = nenhum). */
  openId: string | null;
  open: (id: string | null) => void;
  minimized: boolean;
  setMinimized: (v: boolean) => void;
  /** Abre a conversa de um comentário recém-salvo e dispara a 1ª análise. */
  start: (input: {
    recordId: string;
    recordTitle: string;
    comment: string;
  }) => void;
  /** Manda uma réplica no fio aberto. */
  reply: (threadId: string, text: string) => void;
  /** Tira o fio da lista depois de aplicado/descartado (o servidor já sabe). */
  close: (threadId: string) => void;
}

const Ctx = createContext<AiSuggestions | null>(null);

export function AiSuggestionsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);

  // Uma carga só, na montagem: reencontra as conversas que ficaram esperando
  // confirmação de antes do F5. Não fica em polling — quem muda a linha é este
  // próprio navegador, e cada turno já devolve a versão nova.
  useEffect(() => {
    let alive = true;
    void listCommentThreads().then((list) => {
      if (alive && list.length > 0) setThreads(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  const upsert = useCallback((t: CommentThread) => {
    setThreads((prev) => {
      const i = prev.findIndex((x) => x.id === t.id);
      if (i < 0) return [t, ...prev];
      const next = [...prev];
      next[i] = t;
      return next;
    });
  }, []);

  const mark = useCallback((id: string, on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const start = useCallback<AiSuggestions["start"]>(
    (input) => {
      void (async () => {
        const opened = await openCommentThread(
          input.recordId,
          input.recordTitle,
          input.comment
        );
        if (!opened.ok || !opened.thread) {
          notifyActionError("Não foi possível abrir a conversa", opened.message);
          return;
        }
        // O fio entra na lista JÁ — com o comentário dentro e marcado como
        // ocupado. É esse instante que faltava: antes o widget fechava o
        // compositor (e com ele o único spinner da tela) e nada dizia que a IA
        // estava trabalhando.
        const id = opened.thread.id;
        upsert(opened.thread);
        setOpenId(id);
        setMinimized(false);
        mark(id, true);
        try {
          const res = await runCommentThread(id);
          if (res.thread) upsert(res.thread);
          else notifyActionError("A análise falhou", res.message);
        } finally {
          mark(id, false);
        }
      })();
    },
    [mark, upsert]
  );

  const reply = useCallback<AiSuggestions["reply"]>(
    (threadId, text) => {
      void (async () => {
        mark(threadId, true);
        try {
          const res = await runCommentThread(threadId, text);
          if (res.thread) upsert(res.thread);
          else notifyActionError("A análise falhou", res.message);
        } finally {
          mark(threadId, false);
        }
      })();
    },
    [mark, upsert]
  );

  const close = useCallback((threadId: string) => {
    setThreads((prev) => prev.filter((t) => t.id !== threadId));
    setOpenId((cur) => (cur === threadId ? null : cur));
  }, []);

  const value = useMemo<AiSuggestions>(
    () => ({
      threads,
      busy,
      openId,
      open: setOpenId,
      minimized,
      setMinimized,
      start,
      reply,
      close,
    }),
    [threads, busy, openId, minimized, start, reply, close]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Sem provider, um objeto INERTE em vez de erro: o widget Tree também roda no
 * viewer público de snapshot, onde não há dock nem IA — e lá o botão "Salvar e
 * analisar" nem aparece.
 */
const INERT: AiSuggestions = {
  threads: [],
  busy: new Set(),
  openId: null,
  open: () => {},
  minimized: false,
  setMinimized: () => {},
  start: () => {},
  reply: () => {},
  close: () => {},
};

export function useAiSuggestions(): AiSuggestions {
  return useContext(Ctx) ?? INERT;
}

/** Há dock nesta tela? É o que decide se o widget oferece "Salvar e analisar". */
export function useHasAiSuggestions(): boolean {
  return useContext(Ctx) != null;
}
