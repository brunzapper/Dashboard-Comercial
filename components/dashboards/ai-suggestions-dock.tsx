// Versão: 1.1 | Data: 11/09/2026
// v1.1 (11/09/2026): o log mostra o raciocínio ao vivo sob o "Analisando…"
// (`busyDetail`, prop que o AiChatLog já tinha para os outros dois painéis).
// Versão: 1.0 | Data: 11/09/2026
// O DOCK das sugestões da IA: um pop-up flutuante, minimizável, COMPARTILHADO
// por todas as conversas em andamento, com setinha para navegar entre elas.
//
// Três decisões que o desenho carrega:
//
//  1. Não é modal. A pessoa pede a análise e continua trabalhando — clicando na
//     próxima linha da tabela, lendo a árvore, comentando em outro registro.
//     Um diálogo que bloqueia a tela transformaria "espere a IA" em "pare".
//
//  2. Um pop-up para TODAS, não um por conversa. Com três análises em curso,
//     três cartões empilhados cobririam o painel; a setinha `‹ 2/3 ›` mantém a
//     mesma moldura e troca o conteúdo.
//
//  3. Minimizar não cancela nada. O botão flutuante fica com o número de
//     conversas abertas — é ele que responde "cadê a que eu pedi?".
//
// O log da conversa é o `AiChatLog` que o painel de dashboards e o sheet da
// Home já usam. Um segundo componente de chat seria a régua paralela da
// invariante 25, e este já sabe desenhar o estado "gerando".
"use client";

import { useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageSquare,
  Minus,
  Sparkles,
  X,
} from "lucide-react";

import { AiChatLog } from "@/components/dashboards/ai-chat-log";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  applyCommentThread,
  dismissCommentThread,
} from "@/app/(app)/dashboards/tree-actions";
import { notifyActionError } from "@/lib/feedback/notify";
import { cn } from "@/lib/utils";

import { useAiSuggestions } from "./ai-suggestions-context";

export function AiSuggestionsDock() {
  const dock = useAiSuggestions();
  const [draft, setDraft] = useState("");
  const [applying, setApplying] = useState(false);

  if (dock.threads.length === 0) return null;

  const index = Math.max(
    0,
    dock.threads.findIndex((t) => t.id === dock.openId)
  );
  const thread = dock.threads[index];
  const busy = dock.busy.has(thread.id);
  const total = dock.threads.length;
  // O badge conta o que ESPERA a pessoa: proposta pronta ou análise rodando.
  const pendentes = dock.threads.filter(
    (t) => t.acoes || dock.busy.has(t.id)
  ).length;

  const go = (delta: number) => {
    const next = (index + delta + total) % total;
    dock.open(dock.threads[next].id);
    setDraft("");
  };

  if (dock.minimized || !dock.openId) {
    return (
      <Button
        type="button"
        size="sm"
        className="fixed right-4 bottom-4 z-50 gap-2 shadow-lg"
        onClick={() => {
          dock.setMinimized(false);
          if (!dock.openId) dock.open(dock.threads[0].id);
        }}
      >
        <MessageSquare className="size-4" />
        Sugestões
        <span className="bg-background/25 rounded-full px-1.5 text-xs font-semibold">
          {pendentes > 0 ? pendentes : total}
        </span>
      </Button>
    );
  }

  const apply = () => {
    setApplying(true);
    void (async () => {
      try {
        const res = await applyCommentThread(thread.id);
        if (!res.ok) {
          notifyActionError(
            "Não foi possível aplicar",
            res.results?.find((r) => !r.ok)?.message ?? res.message
          );
          // Falha PARCIAL mantém o fio aberto: o servidor gravou o que deu
          // errado no log, e é ali que a pessoa pede o conserto.
          return;
        }
        dock.close(thread.id);
      } finally {
        setApplying(false);
      }
    })();
  };

  const discard = () => {
    void dismissCommentThread(thread.id);
    dock.close(thread.id);
  };

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    dock.reply(thread.id, text);
  };

  return (
    <div
      className="bg-background fixed right-4 bottom-4 z-50 flex max-h-[70vh] w-[min(26rem,calc(100vw-2rem))] flex-col gap-2 rounded-lg border p-3 shadow-xl"
      role="dialog"
      aria-label="Sugestões da IA"
    >
      <div className="flex items-center gap-1">
        <Sparkles className="text-primary size-4 shrink-0" />
        <span className="truncate text-sm font-medium" title={thread.recordTitle}>
          {thread.recordTitle || "Registro"}
        </span>
        {total > 1 ? (
          <span className="ml-auto flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label="Conversa anterior"
              onClick={() => go(-1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-muted-foreground text-xs tabular-nums">
              {index + 1}/{total}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label="Próxima conversa"
              onClick={() => go(1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("size-6", total > 1 ? "" : "ml-auto")}
          aria-label="Minimizar"
          onClick={() => dock.setMinimized(true)}
        >
          <Minus className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label="Descartar esta conversa"
          onClick={discard}
        >
          <X className="size-4" />
        </Button>
      </div>

      <AiChatLog
        entries={thread.chat}
        busy={busy}
        busyLabel="Analisando o comentário…"
        busyDetail={dock.thoughts.get(thread.id)}
        className="max-h-[40vh] min-h-16"
      />

      {thread.acoes && !busy ? (
        <div className="border-primary/50 bg-primary/5 flex flex-col gap-2 rounded-md border p-2">
          <ul className="flex flex-col gap-0.5 pl-4 text-sm">
            {thread.acoes.map((a, i) => (
              <li
                key={i}
                className={cn(
                  "list-disc",
                  // Ações que somem com coisa (excluir uma tarefa, apagar as
                  // ocorrências adiadas) não podem parecer iguais às outras: o
                  // clique que as aplica é um só.
                  a.destrutiva && "text-destructive font-medium"
                )}
              >
                {a.resumo}
              </li>
            ))}
          </ul>
          <span className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="gap-1"
              disabled={applying}
              onClick={apply}
            >
              {applying ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Aplicar
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={discard}>
              Descartar
            </Button>
          </span>
        </div>
      ) : null}

      {/* A réplica é o que dispensa escrever outro comentário para tentar de
          novo — "só a próxima", "adia para novembro", "esquece". */}
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Responder à IA…"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          aria-label="Responder à IA"
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || draft.trim() === ""}
          onClick={send}
        >
          Enviar
        </Button>
      </div>
    </div>
  );
}
