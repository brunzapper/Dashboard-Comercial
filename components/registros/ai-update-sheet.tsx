// Versão: 1.1 | Data: 07/08/2026
// v1.1 (07/08/2026): MODO SELEÇÃO (prop `selection`) — alvo = registros
//   marcados na tabela: os 4 fluxos (chat / copiar-prompt / colar-JSON /
//   aplicar) chamam as actions de seleção com os ids; chips de filtro viram
//   "Seleção manual: N"; a IA emite SÓ "alteracoes". Painel de prévia
//   extraído p/ update-preview.tsx (compartilhado com o bulk-edit-sheet).
//   Props controladas open/onOpenChange/hideTrigger (a barra de seleção é a
//   dona do gatilho) + onApplied (limpa a seleção na tabela).
// Sheet "Atualizar com IA" (/registros): o usuário descreve uma correção em
// massa ("todo SDR da reunião cuja fonte seja X vira Y") e a IA propõe UMA
// operação filtros + alterações (contrato registros-update). A PRÉVIA é
// resolvida no SERVIDOR (contagem exata + amostra antes→depois — a IA nunca
// emite ids) e NADA é gravado sem a confirmação explícita da contagem
// (checkbox); recorte acima do teto bloqueia o Aplicar. Duas entradas para o
// MESMO contrato: chat interno (exige IA configurada) e fluxo manual
// copiar-prompt → colar-JSON de IA externa (funciona SEM IA — padrão do
// OperationsAiSheet). Conversa 100% client-state; a resposta de um turno
// SUBSTITUI a proposta inteira.
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCopy, Wand2 } from "lucide-react";

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
import {
  AiChatLog,
  type AiChatEntry,
} from "@/components/dashboards/ai-chat-log";
import type {
  ApplyRecordsUpdateState,
  GenerateRecordsUpdateState,
  RecordsUpdatePreview,
} from "@/lib/ai/update-records";
import {
  applyRecordsSelectionUpdate,
  applyRecordsUpdate,
  buildRecordsSelectionUpdatePrompt,
  buildRecordsUpdatePrompt,
  generateRecordsSelectionUpdateWithAi,
  generateRecordsUpdateWithAi,
  previewRecordsSelectionUpdateJson,
  previewRecordsUpdateJson,
} from "@/app/(app)/registros/ai-update-actions";
import { UpdatePreviewPanel } from "./update-preview";

export function RecordsAiUpdateSheet({
  source,
  ai,
  selection,
  open: openProp,
  onOpenChange,
  hideTrigger,
  onApplied,
}: {
  source: { key: string; label: string };
  ai: { provider: string; model: string; hasKey: boolean } | null;
  /** Modo seleção: alvo = estes ids (a IA emite só "alteracoes"). */
  selection?: { ids: string[] };
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  /** Chamado após um apply que escreveu algo (limpar seleção na tabela). */
  onApplied?: () => void;
}) {
  const router = useRouter();
  const [selfOpen, setSelfOpen] = useState(false);
  const open = openProp ?? selfOpen;
  const setOpen = onOpenChange ?? setSelfOpen;
  const [chat, setChat] = useState<AiChatEntry[]>([]);
  const [turns, setTurns] = useState<string[]>([]);
  // Proposta pendente: JSON canônico (reenviado no apply/turno seguinte) +
  // prévia server-side correspondente.
  const [pendingJson, setPendingJson] = useState<string | null>(null);
  const [preview, setPreview] = useState<RecordsUpdatePreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  // Fluxo manual (IA externa): prompt copiado + JSON colado.
  const [promptFallback, setPromptFallback] = useState<string | null>(null);
  const [pasteJson, setPasteJson] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, busy]);

  const clearPending = () => {
    setPendingJson(null);
    setPreview(null);
    setConfirmed(false);
  };

  const pushResult = (res: GenerateRecordsUpdateState) => {
    if (res.ok) {
      setPendingJson(res.pendingJson ?? null);
      setPreview(res.preview ?? null);
      setConfirmed(false);
      setChat((c) => [
        ...c,
        {
          kind: "ok",
          text: res.message ?? "Prévia pronta.",
          summary: [
            ...(res.preview?.filterLabels ?? []).map((f) => `Filtro: ${f}`),
            ...(res.preview?.changeLabels ?? []).map(
              (ch) => `Alterar ${ch.label} → ${ch.value}`
            ),
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
      const input = {
        sourceKey: source.key,
        description: text,
        priorTurns: turns,
        pendingJson: pendingJson ?? undefined,
      };
      const res = selection
        ? await generateRecordsSelectionUpdateWithAi({
            ...input,
            recordIds: selection.ids,
          })
        : await generateRecordsUpdateWithAi(input);
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
      const res = selection
        ? await previewRecordsSelectionUpdateJson(raw, source.key, selection.ids)
        : await previewRecordsUpdateJson(raw, source.key);
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
      const res = selection
        ? await buildRecordsSelectionUpdatePrompt(source.key, selection.ids)
        : await buildRecordsUpdatePrompt(source.key);
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
    if (!pendingJson || !preview || busy || applying) return;
    if (preview.overCap || preview.total === 0 || !confirmed) return;
    setApplying(true);
    try {
      const res: ApplyRecordsUpdateState = selection
        ? await applyRecordsSelectionUpdate(
            pendingJson,
            source.key,
            selection.ids
          )
        : await applyRecordsUpdate(pendingJson, source.key);
      if ((res.changedCount ?? 0) > 0) {
        clearPending();
        router.refresh();
        onApplied?.();
      }
      setChat((c) => [
        ...c,
        res.ok
          ? { kind: "ok", text: res.message ?? "Registros atualizados." }
          : {
              kind: "error",
              text: res.message ?? "Falha ao aplicar.",
              errors:
                res.errors ??
                (res.failures ?? []).map((f) => `${f.title}: ${f.message}`),
            },
      ]);
    } catch {
      setChat((c) => [
        ...c,
        {
          kind: "error",
          text: "Falha de comunicação ao aplicar — confira os registros antes de tentar de novo.",
        },
      ]);
    } finally {
      setApplying(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {hideTrigger ? null : (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Wand2 className="size-4" />
          Atualizar com IA
        </Button>
      )}
      <SheetContent className="flex flex-col overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            {selection
              ? `Editar com IA — ${selection.ids.length} selecionado(s)`
              : `Atualizar registros com IA — ${source.label}`}
          </SheetTitle>
          <SheetDescription>
            {selection
              ? "Descreva a alteração para os registros selecionados (ex.: " +
                '"marque todos como Perdido"). O servidor mostra a prévia ' +
                "antes → depois — nada é gravado sem a sua confirmação."
              : "Descreva uma correção em massa (ex.: “todos com fonte X " +
                "ficam com SDR Fulano”). O servidor mostra quantos " +
                "registros casam e uma amostra antes de você confirmar — " +
                "nada é gravado sem isso."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 px-4 pb-6">
          <AiChatLog
            entries={chat}
            busy={busy}
            busyLabel="Processando…"
            className="max-h-56"
            ref={chatRef}
          />

          {preview && pendingJson ? (
            <UpdatePreviewPanel
              preview={preview}
              selectionCount={selection?.ids.length}
              confirmed={confirmed}
              onConfirmedChange={setConfirmed}
              applying={applying}
              busy={busy}
              onApply={applyPending}
              onDiscard={clearPending}
            />
          ) : null}

          {ai?.hasKey ? (
            <div className="flex flex-col gap-2">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  pendingJson
                    ? "Peça ajustes na proposta (a resposta substitui a prévia inteira)…"
                    : 'Ex.: todos os registros cuja Fonte seja "Formulário de CRM" devem ficar com SDR da Reunião = Paulo Vitor Santos'
                }
                rows={3}
                disabled={busy || applying}
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-muted-foreground text-xs">
                  Usa {ai.provider} · {ai.model}. Nada é gravado sem a sua
                  confirmação.
                </p>
                <Button size="sm" onClick={sendTurn} disabled={busy || applying}>
                  {busy ? "Gerando…" : "Enviar"}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              Chat interno indisponível — configure o provedor de IA em
              Configurações → Integrações, ou use o fluxo manual abaixo.
            </p>
          )}

          {/* Fluxo manual (IA externa): mesmo contrato, mesma prévia/apply. */}
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <Label className="text-sm font-medium">
              Ou use uma IA externa (copiar prompt → colar JSON)
            </Label>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={copyPrompt}
                disabled={busy || applying}
              >
                <ClipboardCopy className="size-4" /> Copiar prompt
              </Button>
              <p className="text-muted-foreground text-xs">
                O prompt inclui o formato e o catálogo de campos desta base.
              </p>
            </div>
            {promptFallback ? (
              <Textarea
                readOnly
                value={promptFallback}
                rows={6}
                className="font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
            ) : null}
            <Textarea
              value={pasteJson}
              onChange={(e) => setPasteJson(e.target.value)}
              placeholder="Cole aqui o JSON devolvido pela IA externa…"
              rows={4}
              className="font-mono text-xs"
              disabled={busy || applying}
            />
            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={validatePasted}
                disabled={busy || applying || pasteJson.trim() === ""}
              >
                Validar JSON
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
