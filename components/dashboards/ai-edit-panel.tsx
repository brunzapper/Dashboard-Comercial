// Versão: 1.0 | Data: 24/07/2026
// Painel "Editar com IA" DENTRO do dashboard — sessão persistida por
// (usuário, board) em dashboard_ai_sessions (0098). Sempre modo EDITAR (alvo =
// o próprio board); o cliente envia só a mensagem nova e SUBSTITUI o estado
// pelo canônico devolvido pelas actions (chat/pendingSummary/hasUndo) — nada de
// merge local. Painel NÃO-MODAL: div fixa à direita, sem overlay nem portal
// (o dashboard atrás segue interativo; z-40 fica abaixo dos Sheets, z-50), e
// RECOLHÍVEL para um chip flutuante — dá para testar o dashboard com o turno em
// voo e voltar. "Recomeçar" zera a conversa mas preserva o Desfazer; "Desfazer
// edição da IA" restaura o snapshot pré-turno persistido (sobrevive a F5).
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  PanelRightClose,
  RotateCcw,
  Send,
  Undo2,
  Wand2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  AiChatLog,
  type AiChatEntry,
} from "@/components/dashboards/ai-chat-log";
import {
  applyAiEditPending,
  discardAiEditPending,
  loadAiEditSession,
  resetAiEditSession,
  runAiEditTurn,
  undoAiEditSession,
  type AiEditSessionState,
} from "@/app/(app)/dashboards/ai-session-actions";

type PanelState = "closed" | "open" | "collapsed";
type Action = "load" | "turn" | "apply" | "undo" | "reset" | null;

export function AiEditPanel({
  dashboardId,
  ai,
  hideTrigger,
  openSignal,
}: {
  dashboardId: string;
  ai: { provider: string; model: string; hasKey: boolean } | null;
  // Trigger externo (dropdown "Editar" da toolbar): esconde os botões inline
  // da toolbar (o chip flutuante do estado recolhido permanece) e abre o
  // painel quando `openSignal` incrementa (contador; 0 inicial não abre).
  hideTrigger?: boolean;
  openSignal?: number;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<PanelState>("closed");
  const [loaded, setLoaded] = useState(false);
  const [chat, setChat] = useState<AiChatEntry[]>([]);
  const [pendingSummary, setPendingSummary] = useState<string[] | undefined>(
    undefined
  );
  const [hasUndo, setHasUndo] = useState(false);
  const [autoApply, setAutoApply] = useState(true);
  const [message, setMessage] = useState("");
  // Aviso fora do chat: erro de gate/salvamento (ok:false não substitui o chat).
  const [notice, setNotice] = useState<string | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [busy, startBusy] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  const aiReady = Boolean(ai?.hasKey);
  const generating = busy && (action === "turn" || action === "apply");

  // Auto-scroll do log ao fim a cada entrada nova / início de geração.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, generating]);

  // Estado canônico devolvido por toda action: substitui por inteiro quando ok;
  // ok:false (gate) só vira aviso — o chat local não é apagado.
  function absorb(res: AiEditSessionState) {
    if (res.ok) {
      setChat(res.chat);
      setPendingSummary(res.pendingSummary);
      setHasUndo(res.hasUndo);
    }
    setNotice(res.message ?? null);
    if (res.applied) router.refresh();
  }

  function run(a: Exclude<Action, null>, fn: () => Promise<AiEditSessionState>) {
    if (busy) return;
    setAction(a);
    setNotice(null);
    startBusy(async () => {
      absorb(await fn());
    });
  }

  function openPanel() {
    setPanel("open");
    if (!loaded) {
      setLoaded(true);
      run("load", () => loadAiEditSession(dashboardId));
    }
  }

  // Abertura pelo trigger externo: idempotente (abrir já-aberto é no-op) e
  // reabre a partir do estado recolhido.
  useEffect(() => {
    if (!openSignal) return; // 0/undefined inicial: não abre no mount
    openPanel();
    // openPanel é recriada por render; o sinal é a única dependência real.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);

  function sendTurn() {
    const text = message.trim();
    if (!text || busy) return;
    // Otimista: a action devolve o chat completo (inclui esta entrada).
    setChat((c) => [...c, { kind: "user", text }]);
    setMessage("");
    run("turn", () => runAiEditTurn(dashboardId, text, autoApply));
  }

  function restartSession() {
    if (busy) return;
    if (
      !window.confirm(
        "Apagar a conversa e recomeçar do zero? O Desfazer da última edição continua disponível."
      )
    ) {
      return;
    }
    run("reset", () => resetAiEditSession(dashboardId));
  }

  if (panel === "closed") {
    if (hideTrigger) return null;
    return (
      <Button variant="outline" size="sm" onClick={openPanel}>
        <Wand2 className="size-4" /> Editar com IA
      </Button>
    );
  }

  if (panel === "collapsed") {
    return (
      <>
        {hideTrigger ? null : (
          <Button variant="outline" size="sm" onClick={() => setPanel("open")}>
            <Wand2 className="size-4" /> Editar com IA
          </Button>
        )}
        <Button
          className="fixed right-4 bottom-4 z-40 rounded-full shadow-lg"
          onClick={() => setPanel("open")}
          title="Voltar para a edição com IA"
        >
          <Wand2 className={busy ? "size-4 animate-pulse" : "size-4"} />
          IA{busy ? "…" : ""}
        </Button>
      </>
    );
  }

  return (
    <>
      {hideTrigger ? null : (
        <Button
          variant="default"
          size="sm"
          onClick={() => setPanel("collapsed")}
        >
          <Wand2 className="size-4" /> Editar com IA
        </Button>
      )}
      <div className="bg-background fixed inset-y-0 right-0 z-40 flex w-[400px] max-w-[90vw] flex-col gap-3 border-l p-4 shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="flex items-center gap-2 font-semibold">
              <Wand2 className="size-4" /> Editar com IA
            </p>
            <p className="text-muted-foreground text-xs">
              {aiReady
                ? `Edita este dashboard conversando (${ai?.provider} · ${ai?.model}). A conversa fica salva para você.`
                : "Edita este dashboard conversando com a IA."}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => setPanel("collapsed")}
              title="Recolher para testar o dashboard"
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

        {aiReady ? (
          <>
            {busy && action === "load" ? (
              <p className="text-muted-foreground text-xs">Carregando sessão…</p>
            ) : chat.length === 0 && !generating ? (
              <p className="text-muted-foreground text-xs">
                Descreva a mudança que você quer neste dashboard — a IA
                altera/adiciona widgets, mas nunca exclui (remoção é manual).
              </p>
            ) : null}

            <AiChatLog
              ref={scrollRef}
              entries={chat}
              busy={generating}
              busyLabel={
                action === "apply" ? "Aplicando as mudanças…" : "Gerando com IA…"
              }
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
                  Prévia pronta — {pendingSummary.length} widget(s):
                </p>
                <ul className="max-h-32 list-disc overflow-y-auto pl-5">
                  {pendingSummary.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run("apply", () => applyAiEditPending(dashboardId))
                    }
                  >
                    Aplicar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run("reset", () => discardAiEditPending(dashboardId))
                    }
                  >
                    Descartar
                  </Button>
                </div>
              </div>
            ) : null}

            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                chat.length > 0
                  ? "Continue a conversa — ex.: agora aumente o gráfico e adicione um funil."
                  : "O que melhorar neste dashboard? Ex.: adicione comparação com o mês anterior nos cards."
              }
              className="h-20 shrink-0"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy || message.trim().length === 0}
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
              <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                <Checkbox
                  checked={autoApply}
                  onCheckedChange={(v) => setAutoApply(v === true)}
                />
                Aplicar automaticamente
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t pt-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !hasUndo}
                onClick={() =>
                  run("undo", () => undoAiEditSession(dashboardId))
                }
                title="Restaura o dashboard ao estado anterior à última edição da IA (mudanças manuais feitas depois dela também voltam)."
              >
                <Undo2 className="size-4" /> Desfazer edição da IA
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy || (chat.length === 0 && !pendingSummary)}
                onClick={restartSession}
                title="Apaga a conversa salva e recomeça do zero (não mexe no dashboard nem no Desfazer)."
              >
                <RotateCcw className="size-4" /> Recomeçar
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
      </div>
    </>
  );
}
