// Versão: 1.0 | Data: 08/09/2026
// Sheet "Organizar com IA" da tela de Tarefas (/operacao/tarefas): a IA propõe
// criar, editar e concluir tarefas, e NADA é aplicado sem confirmação — o
// apply re-valida no servidor com catálogo FRESCO e escreve só pelos choke
// points de lib/tasks/actions.ts (invariante 25). Duas entradas para o MESMO
// contrato: chat interno (exige IA configurada) e o fluxo copiar-prompt →
// colar-JSON de IA externa, que funciona SEM IA configurada (padrão do
// OperationsAiSheet/KanbanAiSheet). Conversa 100% client-state; a resposta de
// um turno SUBSTITUI a proposta inteira. Prévia read-only — o ajuste fino é
// pela conversa ou pela própria tela.
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCopy, Sparkles, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AiChatLog, type AiChatEntry } from "@/components/dashboards/ai-chat-log";
import { serializeTasksEdit } from "@/lib/import/tasks/validate";
import type { ParsedTaskAction } from "@/lib/import/tasks/types";
// Tipos direto do núcleo server-only: `import type` é apagado no build, e a
// action NÃO pode re-exportar tipos (quebraria o chunk de actions).
import type {
  ApplyTasksState,
  GenerateTasksState,
} from "@/lib/ai/manage-tasks";
import {
  applyTasksEdit,
  buildTasksPrompt,
  generateTasksWithAi,
  previewTasksJson,
} from "@/app/(app)/operacao/tarefas/ai-actions";

export function TasksAiSheet({
  ai,
}: {
  ai: { provider: string; model: string; hasKey: boolean } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState<AiChatEntry[]>([]);
  const [turns, setTurns] = useState<string[]>([]);
  const [pending, setPending] = useState<ParsedTaskAction[]>([]);
  const [pendingSummary, setPendingSummary] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [promptFallback, setPromptFallback] = useState<string | null>(null);
  const [pasteJson, setPasteJson] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

  const aiReady = Boolean(ai?.hasKey);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, busy]);

  const pushResult = (res: GenerateTasksState) => {
    if (res.ok && res.actions && res.actions.length > 0) {
      setPending(res.actions);
      setPendingSummary(res.summary ?? []);
      setChat((c) => [
        ...c,
        {
          kind: "ok",
          text: res.message ?? "Prévia pronta.",
          summary: [
            ...(res.summary ?? []),
            ...(res.warnings ?? []).map((w) => `Aviso: ${w}`),
          ],
        },
      ]);
    } else {
      setChat((c) => [
        ...c,
        {
          kind: "error",
          text: res.message ?? "Falha ao gerar a proposta.",
          errors: res.errors,
        },
      ]);
    }
  };

  async function sendTurn() {
    const text = description.trim();
    if (!text || busy || applying) return;
    setChat((c) => [...c, { kind: "user", text }]);
    setDescription("");
    setBusy(true);
    try {
      const res = await generateTasksWithAi({
        description: text,
        priorTurns: turns,
        pendingJson:
          pending.length > 0 ? serializeTasksEdit(pending) : undefined,
      });
      // O turno entra no histórico MESMO em falha: o contexto do usuário não
      // se perde por um erro do modelo (padrão dos demais assistentes).
      setTurns((t) => [...t, text]);
      pushResult(res);
    } catch {
      setChat((c) => [
        ...c,
        { kind: "error", text: "Falha de comunicação ao gerar — tente de novo." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function validatePasted() {
    const raw = pasteJson.trim();
    if (!raw || busy || applying) return;
    setBusy(true);
    setChat((c) => [...c, { kind: "user", text: "(JSON colado de IA externa)" }]);
    try {
      const res = await previewTasksJson(raw);
      if (res.ok) setPasteJson("");
      pushResult(res);
    } catch {
      setChat((c) => [
        ...c,
        { kind: "error", text: "Falha de comunicação ao validar o JSON." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function copyPrompt() {
    setBusy(true);
    try {
      const res = await buildTasksPrompt();
      if (!res.ok || !res.prompt) {
        setChat((c) => [
          ...c,
          { kind: "error", text: res.message ?? "Falha ao montar o prompt." },
        ]);
        return;
      }
      try {
        await navigator.clipboard.writeText(res.prompt);
        setPromptFallback(null);
        setChat((c) => [
          ...c,
          {
            kind: "ok",
            text: "Prompt copiado — cole numa IA externa e traga o JSON de volta.",
          },
        ]);
      } catch {
        // Navegador bloqueou a cópia — exibe o texto para copiar à mão.
        setPromptFallback(res.prompt);
      }
    } finally {
      setBusy(false);
    }
  }

  async function applyPending() {
    if (pending.length === 0 || busy || applying) return;
    setApplying(true);
    try {
      const res: ApplyTasksState = await applyTasksEdit(serializeTasksEdit(pending));
      if ((res.appliedCount ?? 0) > 0) {
        setPending([]);
        setPendingSummary([]);
        router.refresh();
      }
      const failLines = (res.results ?? [])
        .filter((r) => !r.ok)
        .map((r) => `${r.titulo}: ${r.message ?? "falha."}`);
      setChat((c) => [
        ...c,
        res.ok
          ? { kind: "ok", text: res.message ?? "Ações aplicadas." }
          : {
              kind: "error",
              text: res.message ?? "Falha ao aplicar.",
              errors: res.errors ?? failLines,
            },
      ]);
    } catch {
      setChat((c) => [
        ...c,
        {
          kind: "error",
          text: "Falha de comunicação ao aplicar — confira a lista antes de tentar de novo.",
        },
      ]);
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        title="Descreva o que precisa e a IA cria, reagenda ou conclui tarefas"
      >
        <Wand2 className="size-4" /> Organizar com IA
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-3 sm:max-w-xl">
          <SheetHeader className="gap-1">
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="size-4" /> Organizar com IA
            </SheetTitle>
            <SheetDescription>
              Descreva o que precisa — criar tarefas, mudar prazo ou responsável,
              concluir o que já foi feito. Nada é gravado antes de você clicar em
              Aplicar.
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
            <AiChatLog
              ref={chatRef}
              entries={chat}
              busy={busy}
              busyLabel="Gerando com IA…"
              className="max-h-64 min-h-24"
            />

            {pending.length > 0 ? (
              <div className="flex flex-col gap-2 rounded-md border border-amber-400/60 bg-amber-50 p-2 text-xs dark:bg-amber-950/30">
                <p className="font-medium">
                  Prévia — {pending.length} ação(ões):
                </p>
                <ul className="max-h-40 list-disc overflow-y-auto pl-5">
                  {pendingSummary.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || applying}
                    onClick={applyPending}
                  >
                    {applying ? "Aplicando…" : `Aplicar ${pending.length} ação(ões)`}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || applying}
                    onClick={() => {
                      setPending([]);
                      setPendingSummary([]);
                    }}
                  >
                    Descartar
                  </Button>
                </div>
              </div>
            ) : null}

            {aiReady ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="tasks-ai-desc">O que você quer fazer?</Label>
                <Textarea
                  id="tasks-ai-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex.: crie uma tarefa de follow-up da Acme para a Maria na sexta às 10h e conclua a de enviar o contrato."
                  className="h-20"
                />
                <div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || applying || description.trim().length === 0}
                    onClick={sendTurn}
                  >
                    {busy ? "Gerando…" : "Gerar proposta"}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">
                Nenhum provedor de IA configurado para esta organização — use o
                fluxo de IA externa abaixo (copiar o prompt e colar a resposta).
              </p>
            )}

            <div className="flex flex-col gap-2 border-t pt-3">
              <p className="text-muted-foreground text-xs">
                Ou use uma IA externa: copie o prompt, cole a resposta aqui.
              </p>
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || applying}
                  onClick={copyPrompt}
                >
                  <ClipboardCopy className="size-4" /> Copiar prompt
                </Button>
              </div>
              {promptFallback ? (
                <Textarea
                  readOnly
                  value={promptFallback}
                  className="h-32 font-mono text-[11px]"
                  onFocus={(e) => e.currentTarget.select()}
                />
              ) : null}
              <Textarea
                value={pasteJson}
                onChange={(e) => setPasteJson(e.target.value)}
                placeholder='Cole aqui o JSON no formato "tarefas-edit".'
                className="h-24 font-mono text-[11px]"
              />
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || applying || pasteJson.trim().length === 0}
                  onClick={validatePasted}
                >
                  Validar JSON colado
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
