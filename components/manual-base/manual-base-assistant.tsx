// Versão: 1.0 | Data: 17/09/2026
// O assistente da BASE MANUAL (0142): cole a tabela que o Meetime, o Apollo ou
// a planilha cospem e a IA devolve os lançamentos.
//
// Três entradas, um contrato só (`base-manual-edit`):
//   1. conversa — o turno entra pela ROTA NDJSON, não por action (uma action
//      de dois minutos congelaria a fila do cliente, e a vítima seria a
//      própria grade que a pessoa está editando ao lado);
//   2. "Copiar prompt" — o MESMO SPEC, para quem usa IA externa;
//   3. "Colar JSON" — a resposta dela, pelo MESMO validador.
//
// A (2) e a (3) existem para a Base manual funcionar numa organização que não
// tem IA configurada — precedente do fluxo de operações e de mapeamentos.
//
// A IA nunca escreve: o que ela produz é uma PRÉVIA guardada no servidor, e
// aplicar é um clique de gente (invariante 25).
"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { AiChatLog, type AiChatEntry } from "@/components/dashboards/ai-chat-log";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { readNdjsonTurn } from "@/lib/ai/read-ndjson-turn";
import { notifyActionError } from "@/lib/feedback/notify";
import { useDebouncedRefresh } from "@/lib/use-debounced-refresh";
import {
  applyManualBaseSession,
  copyManualBasePrompt,
  discardManualBasePending,
  loadManualBaseSession,
  pasteManualBaseJson,
  resetManualBaseSession,
} from "@/app/(app)/registros/base-manual/ai-actions";
import type { ManualBaseSessionState } from "@/lib/ai/manual-base-session";

const TURN_URL = "/api/registros/base-manual/ai-turn";

const toEntries = (s: ManualBaseSessionState | null): AiChatEntry[] =>
  (s?.chat ?? []).map((c) =>
    c.role === "user"
      ? { kind: "user" as const, text: c.text }
      : { kind: "ok" as const, text: c.text }
  );

export function ManualBaseAssistant() {
  const refresh = useDebouncedRefresh();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ManualBaseSessionState | null>(null);
  const [draft, setDraft] = useState("");
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [busy, setBusy] = useState(false);
  const [thought, setThought] = useState("");
  const [, startTransition] = useTransition();
  const logRef = useRef<HTMLDivElement>(null);

  // A conversa carrega ao ABRIR: é evento, não reação a escopo. setState fica
  // dentro da transition (regra react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!open) return;
    startTransition(async () => {
      setState(await loadManualBaseSession());
    });
  }, [open]);

  const run = (fn: () => Promise<ManualBaseSessionState>) => {
    startTransition(async () => {
      const s = await fn();
      setState(s);
      if (!s.ok && s.message) notifyActionError("Base manual", s.message);
    });
  };

  const send = async () => {
    const description = draft.trim();
    if (!description || busy) return;
    setBusy(true);
    setThought("");
    // O compositor esvazia ANTES do turno, mas o texto já está no log do
    // servidor — e o spinner fica no log, nunca no compositor.
    setDraft("");
    try {
      const res = await fetch(TURN_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const next = await readNdjsonTurn<ManualBaseSessionState>(res, {
        onThought: (chunk) => setThought((t) => (t + chunk).slice(-1200)),
      });
      setState(next);
      if (!next.ok && next.message) notifyActionError("Base manual", next.message);
    } catch (e) {
      // Falha de stream NÃO marca a conversa como perdida: o turno pode ter
      // concluído no servidor, e a linha persiste. Reabrir mostra o estado real.
      notifyActionError(
        "Falha ao falar com a IA",
        e instanceof Error ? e.message : String(e)
      );
      setState(await loadManualBaseSession());
    } finally {
      setBusy(false);
      setThought("");
    }
  };

  const apply = () => {
    startTransition(async () => {
      const res = await applyManualBaseSession();
      if (res.session) setState(res.session);
      if (!res.ok && res.message) notifyActionError("Base manual", res.message);
      // Os números mudaram: o refresh reconcilia a grade e, com o carimbo novo,
      // os widgets do dashboard.
      refresh();
    });
  };

  const copyPrompt = () => {
    startTransition(async () => {
      const res = await copyManualBasePrompt();
      if (!res.ok || !res.prompt) {
        notifyActionError(
          "Não foi possível montar o prompt",
          res.message ?? null
        );
        return;
      }
      try {
        await navigator.clipboard.writeText(res.prompt);
      } catch {
        notifyActionError(
          "Não consegui copiar",
          "Selecione o texto do prompt e copie manualmente."
        );
      }
    });
  };

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [state, thought]);

  if (!open) {
    return (
      <div className="border-t pt-3">
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          Lançar com IA
        </Button>
        <p className="text-muted-foreground mt-1 text-xs">
          Cole a tabela de números (ou descreva) e revise antes de aplicar.
        </p>
      </div>
    );
  }

  const entries = toEntries(state);
  const summary = state?.summary ?? [];

  return (
    <section className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Lançar com IA</h3>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={copyPrompt}>
            Copiar prompt
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowPaste((v) => !v)}
          >
            Colar JSON
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => run(resetManualBaseSession)}
          >
            Recomeçar
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Fechar
          </Button>
        </div>
      </div>

      <AiChatLog
        entries={entries}
        busy={busy}
        busyLabel="Lendo os números…"
        busyDetail={thought}
        className="max-h-64"
        ref={logRef}
      />

      {state?.errors && state.errors.length > 0 ? (
        <ul className="text-destructive list-disc pl-5 text-xs">
          {state.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}

      {summary.length > 0 ? (
        <div className="bg-muted/40 flex flex-col gap-2 rounded-md p-2">
          <p className="text-xs font-medium">Prévia — confira antes de aplicar</p>
          <ul className="flex flex-col gap-0.5 text-xs">
            {summary.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          {(state?.warnings ?? []).length > 0 ? (
            <ul className="text-muted-foreground list-disc pl-5 text-xs">
              {state!.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={apply}>
              Aplicar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => run(discardManualBasePending)}
            >
              Descartar
            </Button>
          </div>
        </div>
      ) : null}

      {showPaste ? (
        <div className="flex flex-col gap-2">
          <Textarea
            rows={5}
            placeholder="Cole aqui o JSON devolvido pela IA externa…"
            value={paste}
            onChange={(ev) => setPaste(ev.target.value)}
          />
          <div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                const raw = paste;
                setPaste("");
                run(() => pasteManualBaseJson(raw));
              }}
            >
              Conferir JSON
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Textarea
          rows={4}
          placeholder={
            "Cole a tabela. Ex.:\nDados mensais de agosto\nOperação\t# Accounts emailed\t# Emails replied\nOutbound\t5261\t35"
          }
          value={draft}
          onChange={(ev) => setDraft(ev.target.value)}
          disabled={busy}
        />
        <div>
          <Button type="button" onClick={send} disabled={busy || !draft.trim()}>
            {busy ? "Lendo…" : "Enviar"}
          </Button>
        </div>
      </div>
    </section>
  );
}
