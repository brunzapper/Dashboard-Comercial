// Versão: 1.0 | Data: 07/09/2026
// Sheet "Configurar com IA" do QUADRO KANBAN (páginas /kanbans/[id] e
// /kanbans/w/[widgetId]): a IA propõe a configuração do quadro (colunas,
// cards, indicador do cabeçalho) e as automações, e NADA é aplicado sem
// confirmação — o apply re-valida no servidor e escreve só pelos choke points
// (invariante 25). Duas entradas para o MESMO contrato: chat interno (exige IA
// configurada) e o fluxo copiar-prompt → colar-JSON de IA externa, que
// funciona SEM IA configurada (padrão do OperationsAiSheet/MappingsAiSheet).
// Conversa 100% client-state; a resposta de um turno SUBSTITUI a proposta
// inteira. Prévia read-only (o ajuste fino é pela conversa ou pela própria UI
// do quadro, que continua sendo a fonte para quem prefere clicar).
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
import type { KanbanColumn } from "@/lib/kanban/types";
import type { KanbanOwner } from "@/lib/kanban/data";
// Tipos direto do núcleo server-only: `import type` é apagado no build, e a
// action NÃO pode re-exportar tipos (quebraria o chunk de actions).
import type {
  ApplyKanbanState,
  GenerateKanbanState,
} from "@/lib/ai/kanban-config";
import {
  applyKanbanConfig,
  buildKanbanConfigPrompt,
  generateKanbanConfigWithAi,
  previewKanbanConfigJson,
} from "@/app/(app)/kanbans/ai-actions";

export function KanbanAiSheet({
  owner,
  columns,
  ai,
}: {
  owner: KanbanOwner;
  /** Colunas JÁ derivadas pela página — mesmo arranjo do AutomationsSheet. */
  columns: KanbanColumn[];
  ai: { provider: string; model: string; hasKey: boolean } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState<AiChatEntry[]>([]);
  const [turns, setTurns] = useState<string[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [pendingSummary, setPendingSummary] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [promptFallback, setPromptFallback] = useState<string | null>(null);
  const [pasteJson, setPasteJson] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

  const hints = columns.map((c) => ({ key: c.key, label: c.label }));
  const aiReady = Boolean(ai?.hasKey);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, busy]);

  const pushResult = (res: GenerateKanbanState) => {
    if (res.ok && res.json) {
      setPending(res.json);
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
      const res = await generateKanbanConfigWithAi({
        owner,
        columns: hints,
        description: text,
        priorTurns: turns,
        pendingJson: pending ?? undefined,
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
      const res = await previewKanbanConfigJson(owner, hints, raw);
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
      const res = await buildKanbanConfigPrompt(owner, hints);
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
    if (!pending || busy || applying) return;
    setApplying(true);
    try {
      const res: ApplyKanbanState = await applyKanbanConfig(
        owner,
        hints,
        pending
      );
      if ((res.appliedCount ?? 0) > 0) {
        setPending(null);
        setPendingSummary([]);
        router.refresh();
      }
      const failLines = (res.failed ?? []).map((f) => `${f.item}: ${f.message}`);
      setChat((c) => [
        ...c,
        res.ok
          ? {
              kind: "ok",
              text: res.message ?? "Configuração aplicada.",
              summary: failLines.length > 0 ? failLines : undefined,
            }
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
          text: "Falha de comunicação ao aplicar — confira o quadro antes de tentar de novo.",
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
        title="Descreva o quadro que você quer e a IA monta colunas, cards e automações"
      >
        <Wand2 className="size-4" /> Configurar com IA
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-3 sm:max-w-xl">
          <SheetHeader className="gap-1">
            <SheetTitle className="flex items-center gap-2">
              <Sparkles className="size-4" /> Configurar com IA
            </SheetTitle>
            <SheetDescription>
              Descreva o quadro que você quer — colunas, o que aparece nos cards,
              o indicador do cabeçalho e as automações que movem cards sozinhas.
              Nada é gravado antes de você clicar em Aplicar.
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

            {pending ? (
              <div className="flex flex-col gap-2 rounded-md border border-amber-400/60 bg-amber-50 p-2 text-xs dark:bg-amber-950/30">
                <p className="font-medium">Prévia pronta:</p>
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
                    {applying ? "Aplicando…" : "Aplicar"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || applying}
                    onClick={() => {
                      setPending(null);
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
                <Label htmlFor="kanban-ai-desc">O que você quer neste quadro?</Label>
                <Textarea
                  id="kanban-ai-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex.: crie as fases Entrada, Proposta e Fechamento, mostre o valor somado no topo de cada coluna e mova para Entrada o que ficar 7 dias parado."
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
                placeholder='Cole aqui o JSON no formato "kanban-config".'
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
