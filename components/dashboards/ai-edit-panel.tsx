// Versão: 1.1 | Data: 26/07/2026
// Painel "Editar com IA" DENTRO do dashboard — sessão persistida por
// (usuário, board) em dashboard_ai_sessions (0098). Sempre modo EDITAR (alvo =
// o próprio board); o cliente envia só a mensagem nova e SUBSTITUI o estado
// pelo canônico devolvido pelas actions (chat/pendingSummary/hasUndo) — nada de
// merge local. Painel NÃO-MODAL: div fixa à direita, sem overlay nem portal
// (o dashboard atrás segue interativo; z-40 fica abaixo dos Sheets, z-50), e
// RECOLHÍVEL para um chip flutuante — dá para testar o dashboard com o turno em
// voo e voltar. "Recomeçar" zera a conversa mas preserva o Desfazer; "Desfazer
// edição da IA" restaura o snapshot pré-turno persistido (sobrevive a F5).
// v1.1 (26/07/2026): título do painel = MODELO configurado (1ª letra
// maiúscula; fallback "Editar com IA" sem config) e o TURNO passa a entrar
// pela rota de streaming /api/dashboards/<id>/ai-turn (NDJSON) — o raciocínio
// do modelo aparece ao vivo no log (efêmero, some ao concluir; demais actions
// seguem server actions). Botões de gatilho/chip mantêm "Editar com IA"/"IA".
"use client";

import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useTransition,
} from "react";
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
  undoAiEditSession,
} from "@/app/(app)/dashboards/ai-session-actions";
// Tipo direto do núcleo (server-only, mas `import type` é apagado no build) —
// a action não re-exporta tipos (quebraria o chunk de actions; ver lá).
import type { AiEditSessionState } from "@/lib/ai/edit-session";
import { AI_PROVIDER_LABELS, isAiProvider } from "@/lib/ai/models";

type PanelState = "closed" | "open" | "collapsed";
// "turn" não passa mais por aqui — o turno usa a rota de streaming (turnBusy).
type Action = "load" | "apply" | "undo" | "reset" | null;

// Handle imperativo p/ o trigger externo (dropdown "Editar" da toolbar).
export interface AiEditPanelHandle {
  open: () => void;
}

export function AiEditPanel({
  dashboardId,
  ai,
  hideTrigger,
  ref,
}: {
  dashboardId: string;
  ai: { provider: string; model: string; hasKey: boolean } | null;
  // Trigger externo (dropdown "Editar" da toolbar): esconde os botões inline
  // da toolbar (o chip flutuante do estado recolhido permanece); a abertura
  // vem pelo handle (`ref.open()` — idempotente, reabre do estado recolhido).
  hideTrigger?: boolean;
  ref?: React.Ref<AiEditPanelHandle>;
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
  // Turno em voo pela rota de streaming (fora do useTransition das actions) +
  // raciocínio ao vivo acumulado do stream (efêmero — zera ao concluir).
  const [turnBusy, setTurnBusy] = useState(false);
  const [liveThought, setLiveThought] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const aiReady = Boolean(ai?.hasKey);
  const anyBusy = busy || turnBusy;
  const generating = turnBusy || (busy && action === "apply");

  // Título do painel: o MODELO configurado, com a 1ª letra maiúscula.
  const panelTitle = ai?.model
    ? ai.model.charAt(0).toUpperCase() + ai.model.slice(1)
    : "Editar com IA";
  const providerLabel =
    ai && isAiProvider(ai.provider)
      ? AI_PROVIDER_LABELS[ai.provider]
      : ai?.provider;

  // Auto-scroll do log ao fim a cada entrada nova / início de geração /
  // trecho novo de raciocínio.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, generating, liveThought]);

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
    if (anyBusy) return;
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

  useImperativeHandle(ref, () => ({ open: openPanel }));

  // Turno via rota de STREAMING (NDJSON): linhas {type:"thought"} alimentam o
  // raciocínio ao vivo e a linha final {type:"state"} é o MESMO estado
  // canônico das actions (absorb substitui tudo).
  async function sendTurn() {
    const text = message.trim();
    if (!text || anyBusy) return;
    // Otimista: o estado final devolve o chat completo (inclui esta entrada).
    setChat((c) => [...c, { kind: "user", text }]);
    setMessage("");
    setNotice(null);
    setLiveThought("");
    setTurnBusy(true);
    try {
      const res = await fetch(`/api/dashboards/${dashboardId}/ai-turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, autoApply }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`o servidor respondeu ${res.status}.`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalState: AiEditSessionState | null = null;
      const handleLine = (raw: string) => {
        const trimmed = raw.trim();
        if (!trimmed) return;
        const evt = JSON.parse(trimmed) as
          | { type: "thought"; text: string }
          | { type: "state"; state: AiEditSessionState };
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
      // O turno pode ter concluído no servidor mesmo com o stream perdido —
      // a sessão persiste no banco; um F5/reabrir recarrega o estado real.
      const msg = err instanceof Error ? err.message : String(err);
      setNotice(`Falha no turno: ${msg}`);
    } finally {
      setTurnBusy(false);
      setLiveThought("");
    }
  }

  function restartSession() {
    if (anyBusy) return;
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
          <Wand2 className={anyBusy ? "size-4 animate-pulse" : "size-4"} />
          IA{anyBusy ? "…" : ""}
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
              <Wand2 className="size-4" /> {panelTitle}
            </p>
            <p className="text-muted-foreground text-xs">
              {aiReady
                ? `Edita este dashboard conversando (${providerLabel}). A conversa fica salva para você.`
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
                busy && action === "apply"
                  ? "Aplicando as mudanças…"
                  : "Gerando com IA…"
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
                    disabled={anyBusy}
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
                    disabled={anyBusy}
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
                disabled={anyBusy || !hasUndo}
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
                disabled={anyBusy || (chat.length === 0 && !pendingSummary)}
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
