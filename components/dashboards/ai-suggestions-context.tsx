// Versão: 1.1 | Data: 11/09/2026
// v1.1 (11/09/2026): o TURNO saiu da Server Action para a rota
//   `/api/tree/ai-turn`. Não é preferência de transporte: o Next despacha
//   Server Actions UMA DE CADA VEZ por cliente, e o turno segura a fila por até
//   240s — enquanto a IA analisava, clicar noutra linha da tabela deixava a
//   Tree em "Carregando…" até a análise acabar, porque `loadRecordTree` também
//   é action e ficava atrás dela. Era o oposto do que o dock existe para fazer.
//   Junto veio o raciocínio ao vivo (o cano NDJSON já precisava existir para o
//   POST longo não apanhar de timeout de ociosidade).
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
} from "@/app/(app)/dashboards/tree-actions";
import type { CommentThread } from "@/lib/ai/analyze-comment";
import { readNdjsonTurn } from "@/lib/ai/read-ndjson-turn";
import { notifyActionError } from "@/lib/feedback/notify";

/** O que a rota devolve na linha final. */
type TurnState = { ok: boolean; message?: string; thread?: CommentThread };

interface AiSuggestions {
  threads: CommentThread[];
  /** Ids dos fios com um turno em voo — o dock mostra o "pensando" neles. */
  busy: Set<string>;
  /**
   * v1.1: raciocínio ao vivo POR FIO. Um campo só misturaria o de duas
   * conversas transmitindo ao mesmo tempo — que é o caso de uso do dock.
   * Efêmero: nada disto vai para a linha.
   */
  thoughts: Map<string, string>;
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
  const [thoughts, setThoughts] = useState<Map<string, string>>(new Map());

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
    // O raciocínio some junto com o "ocupado": ele explica a ESPERA, e depois
    // do resultado só seria ruído sobre a proposta.
    if (!on) {
      setThoughts((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  /**
   * Um turno, pela ROTA (nunca por action — ver o cabeçalho).
   *
   * Falha de rede não marca a conversa como perdida: o turno pode ter concluído
   * no servidor mesmo com o stream cortado, e a linha persiste. Reabrir o dock
   * recarrega o estado real — mesma regra dos painéis de dashboard e Operação.
   */
  const runTurn = useCallback(
    async (threadId: string, reply?: string): Promise<CommentThread | null> => {
      const res = await fetch("/api/tree/ai-turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, ...(reply ? { reply } : {}) }),
      });
      const state = await readNdjsonTurn<TurnState>(res, {
        onThought: (chunk) =>
          setThoughts((prev) => {
            const next = new Map(prev);
            next.set(threadId, (next.get(threadId) ?? "") + chunk);
            return next;
          }),
      });
      if (state.thread) return state.thread;
      notifyActionError("A análise falhou", state.message);
      return null;
    },
    []
  );

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
          const thread = await runTurn(id);
          if (thread) upsert(thread);
        } catch (err) {
          notifyActionError(
            "A análise falhou",
            err instanceof Error ? err.message : String(err)
          );
        } finally {
          mark(id, false);
        }
      })();
    },
    [mark, runTurn, upsert]
  );

  const reply = useCallback<AiSuggestions["reply"]>(
    (threadId, text) => {
      void (async () => {
        mark(threadId, true);
        try {
          const thread = await runTurn(threadId, text);
          if (thread) upsert(thread);
        } catch (err) {
          notifyActionError(
            "A análise falhou",
            err instanceof Error ? err.message : String(err)
          );
        } finally {
          mark(threadId, false);
        }
      })();
    },
    [mark, runTurn, upsert]
  );

  const close = useCallback((threadId: string) => {
    setThreads((prev) => prev.filter((t) => t.id !== threadId));
    setOpenId((cur) => (cur === threadId ? null : cur));
  }, []);

  const value = useMemo<AiSuggestions>(
    () => ({
      threads,
      busy,
      thoughts,
      openId,
      open: setOpenId,
      minimized,
      setMinimized,
      start,
      reply,
      close,
    }),
    [threads, busy, thoughts, openId, minimized, start, reply, close]
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
  thoughts: new Map(),
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
