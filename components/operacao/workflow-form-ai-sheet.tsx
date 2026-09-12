// Versão: 1.0 | Data: 12/09/2026
// "Preencher com IA" de um formulário do Workflow: a pessoa descreve o lead em
// uma ou duas frases e a IA aloca cada informação nos campos da tela.
//
// Ela NÃO lança. O resultado vai para as CAIXAS do formulário e quem lança é o
// clique em Lançar (invariante 25) — por isso não há botão "aplicar" aqui: o
// sheet fecha e o formulário fica preenchido, editável como sempre.
//
// O turno entra por ROTA (/api/operacao/workflow/ai-fill), não por Server
// Action: como action ele seguraria a fila do cliente, e as vítimas seriam o
// envio do formulário e o painel de recentes. O laço de leitura é o
// `readNdjsonTurn`, dono único.
//
// Sem IA configurada na org o gatilho não aparece (precedente do
// RecordsAiInsertSheet). Aqui não há fluxo de "copiar prompt" como no de
// operações: o valor está em preencher a tela, e colar JSON à mão seria mais
// trabalho que digitar nos campos.
"use client";

import { useRef, useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AiChatLog, type AiChatEntry } from "@/components/dashboards/ai-chat-log";
import { readNdjsonTurn } from "@/lib/ai/read-ndjson-turn";
import { serializeFormFill } from "@/lib/import/workflow-form/validate";
import type { FormFillValues } from "@/lib/import/workflow-form/types";
// Tipo do núcleo server-only: `import type` é apagado no build.
import type { FillFormState } from "@/lib/ai/fill-workflow-form";

export function WorkflowFormAiSheet({
  schemaKey,
  onFilled,
}: {
  schemaKey: string;
  /** Entrega as respostas ao formulário (ele remonta os campos preenchidos). */
  onFilled: (values: FormFillValues) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [chat, setChat] = useState<AiChatEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [liveThought, setLiveThought] = useState("");
  // Turnos anteriores e a última proposta: a conversa vive AQUI (não há tabela;
  // precedente do RecordsAiInsertSheet).
  const [turns, setTurns] = useState<string[]>([]);
  const pending = useRef<FormFillValues | null>(null);

  async function sendTurn() {
    const description = text.trim();
    if (!description || busy) return;
    setChat((c) => [...c, { kind: "user", text: description }]);
    setText("");
    setLiveThought("");
    setBusy(true);
    try {
      const res = await fetch("/api/operacao/workflow/ai-fill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaKey,
          description,
          priorTurns: turns,
          pendingJson: pending.current
            ? serializeFormFill(pending.current)
            : undefined,
        }),
      });
      const state = await readNdjsonTurn<FillFormState>(res, {
        onThought: (chunk) => setLiveThought((t) => t + chunk),
      });
      if (state.ok && state.values) {
        pending.current = state.values;
        setTurns((t) => [...t, description]);
        setChat((c) => [
          ...c,
          {
            kind: "ok",
            text: state.message ?? "Formulário preenchido.",
            summary: state.warnings,
          },
        ]);
        onFilled(state.values);
        // A resposta está na tela, atrás do sheet — fechar é o passo natural.
        setOpen(false);
      } else {
        setChat((c) => [
          ...c,
          {
            kind: "error",
            text: state.message ?? "Não foi possível preencher.",
            errors: state.errors,
          },
        ]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setChat((c) => [...c, { kind: "error", text: `Falha no turno: ${msg}` }]);
    } finally {
      setBusy(false);
      setLiveThought("");
    }
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Wand2 className="size-4" />
        Preencher com IA
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-3 sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Preencher com IA</SheetTitle>
          </SheetHeader>

          <p className="text-muted-foreground text-sm">
            Descreva o que quer lançar, do jeito que sair. A IA distribui as
            informações pelos campos do formulário — nada é lançado até você
            revisar e clicar em Lançar.
          </p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wf-ai-text">Descrição</Label>
            <Textarea
              id="wf-ai-text"
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Maria Silva, da ACME Indústria, chegou por indicação. Telefone (11) 98888-7777, quer proposta até o fim do mês."
              disabled={busy}
            />
          </div>

          <Button type="button" onClick={() => void sendTurn()} disabled={busy}>
            <Sparkles className="size-4" />
            {busy ? "Lendo…" : "Preencher"}
          </Button>

          <AiChatLog
            entries={chat}
            busy={busy}
            busyLabel="Lendo o texto…"
            busyDetail={liveThought}
            className="max-h-72"
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
