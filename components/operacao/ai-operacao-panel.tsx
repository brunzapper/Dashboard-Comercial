// Versão: 1.0 | Data: 07/09/2026
// Painel de IA da OPERAÇÃO — a "janela própria" que aparece enquanto se está
// dentro de /operacao, ESCOPADA pela sub-área aberta (o layout resolve o
// escopo pelo pathname e só monta o painel quando há um). Molde estrutural do
// AiEditPanel do dashboard: div fixa à direita (z-40, NÃO-modal — a tela atrás
// segue interativa), estados fechado|aberto|recolhido com chip flutuante,
// largura arrastável, prévia com Aplicar/Descartar, Desfazer e Recomeçar.
//
// Diferenças que a natureza do lugar impõe:
//  - o alvo da conversa (domínio, plano) vem do contexto que a TELA publica,
//    não da URL — e aparece no cabeçalho para não haver dúvida sobre o que
//    está sendo alterado;
//  - o Desfazer só existe onde o escopo o suporta (`hasUndo` do servidor);
//    onde não existe, o painel DIZ isso em vez de simular.
// O estado é sempre o canônico devolvido pelo servidor — nada de merge local.
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PanelRightClose, RotateCcw, Send, Undo2, Wand2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { usePanelWidth } from "@/components/ui/use-panel-width";
import { AiChatLog, type AiChatEntry } from "@/components/dashboards/ai-chat-log";
import { useOperacaoAiScope } from "@/components/operacao/ai-scope-context";
import type { OperacaoAiScopeMeta } from "@/lib/ai/operacao/scopes";
// Tipo direto do núcleo (server-only, mas `import type` é apagado no build) —
// a action não re-exporta tipos (quebraria o chunk de actions).
import type { OperacaoAiState } from "@/lib/ai/operacao/session";
import {
  applyOperacaoAiPending,
  discardOperacaoAiPending,
  loadOperacaoAiSession,
  resetOperacaoAiSession,
  undoOperacaoAiSession,
} from "@/app/(app)/operacao/ai-session-actions";

type PanelState = "closed" | "open" | "collapsed";
type Action = "load" | "apply" | "discard" | "undo" | "reset" | null;

export function AiOperacaoPanel({
  scope,
  ai,
}: {
  scope: OperacaoAiScopeMeta;
  ai: { provider: string; model: string; hasKey: boolean } | null;
}) {
  const router = useRouter();
  const { target, targetLabel } = useOperacaoAiScope();
  const [panel, setPanel] = useState<PanelState>("closed");
  const { width: panelWidth, handleProps: panelHandleProps } = usePanelWidth(
    "ai-operacao-panel-width",
    400
  );
  const [loaded, setLoaded] = useState(false);
  const [chat, setChat] = useState<AiChatEntry[]>([]);
  const [pendingSummary, setPendingSummary] = useState<string[] | undefined>();
  const [pendingTarget, setPendingTarget] = useState<string | undefined>();
  const [hasUndo, setHasUndo] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [busy, startBusy] = useTransition();
  const [turnBusy, setTurnBusy] = useState(false);
  const [liveThought, setLiveThought] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const aiReady = Boolean(ai?.hasKey);
  const anyBusy = busy || turnBusy;
  const generating = turnBusy || (busy && action === "apply");
  // Prévia de OUTRO alvo: o servidor recusa o apply, então avisamos antes.
  const pendingElsewhere =
    pendingSummary != null && pendingTarget != null && pendingTarget !== target;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, generating, liveThought]);

  function absorb(res: OperacaoAiState) {
    if (res.ok) {
      setChat(res.chat);
      setPendingSummary(res.pendingSummary);
      setPendingTarget(res.pendingTarget);
      setHasUndo(res.hasUndo);
    }
    setNotice(res.message ?? null);
    if (res.applied) router.refresh();
  }

  // A carga é um EVENTO (abrir o painel), nunca um efeito: setState dentro de
  // useEffect é justamente o que a regra react-hooks/set-state-in-effect
  // proíbe. A troca de sub-aba não precisa de efeito porque o mount REMONTA o
  // painel por escopo (`key` em OperacaoAiPanelMount) — conversa nova, estado
  // novo, uma carga só.
  function openPanel() {
    setPanel("open");
    if (loaded) return;
    setLoaded(true);
    setAction("load");
    setNotice(null);
    startBusy(async () => {
      absorb(await loadOperacaoAiSession(scope.key));
    });
  }

  function run(a: Exclude<Action, null>, fn: () => Promise<OperacaoAiState>) {
    if (anyBusy) return;
    setAction(a);
    setNotice(null);
    startBusy(async () => {
      absorb(await fn());
    });
  }

  // Turno pela rota de STREAMING (NDJSON): linhas {type:"thought"} alimentam o
  // raciocínio ao vivo e a linha final {type:"state"} é o estado canônico.
  async function sendTurn() {
    const text = message.trim();
    if (!text || anyBusy) return;
    setChat((c) => [...c, { kind: "user", text }]);
    setMessage("");
    setNotice(null);
    setLiveThought("");
    setTurnBusy(true);
    try {
      const res = await fetch(`/api/operacao/${scope.key}/ai-turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, target }),
      });
      if (!res.ok || !res.body) throw new Error(`o servidor respondeu ${res.status}.`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalState: OperacaoAiState | null = null;
      const handleLine = (rawLine: string) => {
        const trimmed = rawLine.trim();
        if (!trimmed) return;
        const evt = JSON.parse(trimmed) as
          | { type: "thought"; text: string }
          | { type: "state"; state: OperacaoAiState };
        if (evt.type === "thought") setLiveThought((t) => t + evt.text);
        else if (evt.type === "state") finalState = evt.state;
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          handleLine(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
        }
      }
      if (buffer.trim()) handleLine(buffer);
      if (!finalState) throw new Error("resposta incompleta do servidor.");
      absorb(finalState);
    } catch (err) {
      // O turno pode ter concluído no servidor mesmo com o stream perdido — a
      // sessão persiste; um F5/reabrir recarrega o estado real.
      const msg = err instanceof Error ? err.message : String(err);
      setNotice(`Falha no turno: ${msg}`);
    } finally {
      setTurnBusy(false);
      setLiveThought("");
    }
  }

  if (panel === "closed") {
    return (
      <Button
        variant="outline"
        size="sm"
        className="fixed right-4 bottom-4 z-40 shadow-lg"
        onClick={openPanel}
        title={scope.description}
      >
        <Wand2 className="size-4" /> {scope.label}
      </Button>
    );
  }

  if (panel === "collapsed") {
    return (
      <Button
        className="fixed right-4 bottom-4 z-40 rounded-full shadow-lg"
        onClick={openPanel}
        title="Voltar para a conversa com a IA"
      >
        <Wand2 className={anyBusy ? "size-4 animate-pulse" : "size-4"} />
        IA{anyBusy ? "…" : ""}
      </Button>
    );
  }

  return (
    <>
      <div
        className="bg-background fixed inset-y-0 right-0 z-40 flex max-w-[90vw] flex-col gap-3 border-l p-4 shadow-lg"
        style={{ width: panelWidth }}
      >
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionar painel"
          title="Arraste para redimensionar o painel"
          {...panelHandleProps}
          className="hover:bg-primary/40 absolute top-0 left-0 z-20 h-full w-1.5 cursor-col-resize"
        />
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="flex items-center gap-2 font-semibold">
              <Wand2 className="size-4" /> {scope.label}
            </p>
            <p className="text-muted-foreground text-xs">
              {targetLabel
                ? `Conversa sobre: ${targetLabel}`
                : scope.description}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setPanel("collapsed")}
              title="Recolher para mexer na tela"
              aria-label="Recolher painel"
            >
              <PanelRightClose className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setPanel("closed")}
              title="Fechar"
              aria-label="Fechar painel"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        {busy && action === "load" ? (
          <p className="text-muted-foreground text-xs">Carregando sessão…</p>
        ) : chat.length === 0 && !generating ? (
          <p className="text-muted-foreground text-xs">
            {scope.description} Nada é gravado antes de você clicar em Aplicar.
          </p>
        ) : null}

        <AiChatLog
          ref={scrollRef}
          entries={chat}
          busy={generating}
          busyLabel={
            busy && action === "apply" ? "Aplicando as mudanças…" : "Gerando com IA…"
          }
          busyDetail={turnBusy ? liveThought || undefined : undefined}
          className="min-h-0 flex-1"
        />

        {notice ? (
          <p className="text-destructive text-xs" role="status">
            {notice}
          </p>
        ) : null}

        {pendingSummary ? (
          <div className="flex flex-col gap-2 rounded-md border border-amber-400/60 bg-amber-50 p-2 text-xs dark:bg-amber-950/30">
            <p className="font-medium">
              Prévia pronta — {pendingSummary.length} item(ns):
            </p>
            <ul className="max-h-32 list-disc overflow-y-auto pl-5">
              {pendingSummary.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
            {pendingElsewhere ? (
              <p className="text-destructive">
                Esta prévia é de outro item — volte a ele na tela para aplicar,
                ou descarte.
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={anyBusy || pendingElsewhere}
                onClick={() =>
                  run("apply", () => applyOperacaoAiPending(scope.key, target))
                }
              >
                Aplicar
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={anyBusy}
                onClick={() =>
                  run("discard", () => discardOperacaoAiPending(scope.key))
                }
              >
                Descartar
              </Button>
            </div>
          </div>
        ) : null}

        {aiReady ? (
          <>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={scope.placeholder}
              className="h-20 shrink-0"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={anyBusy || message.trim().length === 0}
                onClick={sendTurn}
              >
                {generating ? (
                  "Gerando…"
                ) : (
                  <>
                    <Send className="size-4" /> Enviar
                  </>
                )}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-xs">
            Nenhum provedor de IA configurado para esta organização. Um
            administrador pode conectar Gemini, Claude ou OpenAI em{" "}
            <Link href="/configuracoes/integracoes" className="underline">
              Configurações → Integrações
            </Link>
            .
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t pt-2">
          {hasUndo ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={anyBusy}
              onClick={() => run("undo", () => undoOperacaoAiSession(scope.key))}
              title="Restaura o estado anterior à última aplicação da IA."
            >
              <Undo2 className="size-4" /> Desfazer
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={anyBusy || (chat.length === 0 && !pendingSummary)}
            onClick={() => setConfirmRestart(true)}
            title="Apaga a conversa salva e recomeça do zero (não desfaz o que já foi aplicado)."
          >
            <RotateCcw className="size-4" /> Recomeçar
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmRestart}
        onOpenChange={setConfirmRestart}
        title="Recomeçar a conversa?"
        description="A conversa salva será apagada e você recomeça do zero. O que já foi aplicado não é desfeito."
        actionLabel="Recomeçar"
        destructive={false}
        onConfirm={() => {
          setConfirmRestart(false);
          run("reset", () => resetOperacaoAiSession(scope.key));
        }}
      />
    </>
  );
}
