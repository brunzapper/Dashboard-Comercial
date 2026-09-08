// Versão: 1.0 | Data: 07/08/2026
// Sheet "Classificar com IA" (Operação → Mapeamentos): a IA propõe
// classificações para os valores PENDENTES do domínio aberto e a PRÉVIA é
// EDITÁVEL (inputs com datalist das categorias aceitas + remover item) —
// NADA é aplicado sem confirmação (o apply re-valida no servidor e grava
// origin='ai' pelos mesmos upserts da página; invariante 25). Duas entradas
// para o MESMO contrato: chat interno (exige IA configurada) e fluxo manual
// copiar-prompt → colar-JSON de IA externa (funciona SEM IA configurada —
// padrão do OperationsAiSheet). Conversa 100% client-state; a resposta de um
// turno SUBSTITUI a proposta inteira.
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCopy, Sparkles, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AiChatLog, type AiChatEntry } from "@/components/dashboards/ai-chat-log";
import type { ParsedMappingItem } from "@/lib/import/mappings/types";
import { serializeMappingsClassify } from "@/lib/import/mappings/validate";
import type {
  ApplyMappingsClassifyState,
  GenerateMappingsState,
} from "@/lib/ai/classify-mappings";
import {
  applyGeneratedMappings,
  buildMappingsPrompt,
  generateMappingsWithAi,
  previewMappingsJson,
} from "@/app/(app)/operacao/mapeamentos/ai-actions";

export function MappingsAiSheet({
  ai,
  domainKey,
  domainLabel,
  rawFieldLabel,
  targets,
  optionsByTarget,
  pendingCount,
  onApplied,
}: {
  ai: { provider: string; model: string; hasKey: boolean } | null;
  domainKey: string;
  domainLabel: string;
  rawFieldLabel: string;
  targets: { fieldKey: string; label: string }[];
  optionsByTarget: Record<string, string[]>;
  pendingCount: number;
  /** Superfícies com overview em estado (aba Campos) recarregam por aqui. */
  onApplied?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState<AiChatEntry[]>([]);
  const [turns, setTurns] = useState<string[]>([]);
  const [pending, setPending] = useState<ParsedMappingItem[]>([]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [promptFallback, setPromptFallback] = useState<string | null>(null);
  const [pasteJson, setPasteJson] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, busy]);

  const listId = (fieldKey: string) => `vm-ai-opts-${domainKey}-${fieldKey}`;

  const pushResult = (res: GenerateMappingsState) => {
    if (res.ok) {
      setPending(res.items ?? []);
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

  async function sendTurn(auto = false) {
    const text = auto
      ? "Classifique os valores pendentes listados no contexto."
      : description.trim();
    if ((!auto && !text) || busy || applying) return;
    setChat((c) => [...c, { kind: "user", text }]);
    setDescription("");
    setBusy(true);
    try {
      const res = await generateMappingsWithAi({
        domainKey,
        description: text,
        priorTurns: turns,
        pendingJson:
          pending.length > 0
            ? serializeMappingsClassify(domainKey, pending)
            : undefined,
      });
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
      const res = await previewMappingsJson(domainKey, raw);
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
      const res = await buildMappingsPrompt(domainKey);
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
      const res: ApplyMappingsClassifyState = await applyGeneratedMappings(
        domainKey,
        serializeMappingsClassify(domainKey, pending)
      );
      const applied = res.appliedCount ?? 0;
      if (applied > 0) {
        setPending([]);
        router.refresh();
        onApplied?.();
      }
      const failLines = (res.failed ?? []).map(
        (f) => `${f.rawValue}: ${f.message}`
      );
      setChat((c) => [
        ...c,
        res.ok
          ? { kind: "ok", text: res.message ?? "Classificações aplicadas." }
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
          text: "Falha de comunicação ao aplicar — confira os mapeamentos antes de tentar de novo.",
        },
      ]);
    } finally {
      setApplying(false);
    }
  }

  // Prévia EDITÁVEL: ajuste inline vira o payload do apply (re-validado lá).
  const setOutput = (index: number, fieldKey: string, value: string) =>
    setPending((items) =>
      items.map((it, i) =>
        i === index
          ? {
              ...it,
              outputs: value.trim()
                ? { ...it.outputs, [fieldKey]: value }
                : Object.fromEntries(
                    Object.entries(it.outputs).filter(([k]) => k !== fieldKey)
                  ),
            }
          : it
      )
    );
  const removeItem = (index: number) =>
    setPending((items) => items.filter((_, i) => i !== index));

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={pendingCount === 0}
        title={
          pendingCount === 0
            ? "Não há valores pendentes neste domínio."
            : undefined
        }
      >
        <Sparkles className="size-4" />
        Classificar com IA
      </Button>
      <SheetContent className="flex flex-col overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Classificar {domainLabel.toLowerCase()} com IA</SheetTitle>
          <SheetDescription>
            A IA propõe classificações para os {pendingCount} valor(es)
            pendente(s) de {rawFieldLabel.toLowerCase()}. Revise/edite a prévia
            — nada é gravado sem a sua confirmação.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 px-4 pb-6">
          {targets.map((t) => (
            <datalist key={t.fieldKey} id={listId(t.fieldKey)}>
              {(optionsByTarget[t.fieldKey] ?? []).map((opt) => (
                <option key={opt} value={opt} />
              ))}
            </datalist>
          ))}

          <AiChatLog
            entries={chat}
            busy={busy}
            busyLabel="Processando…"
            className="max-h-48"
            ref={chatRef}
          />

          {pending.length > 0 ? (
            <div className="rounded-md border border-amber-300/60 bg-amber-50/60 p-3 dark:border-amber-400/30 dark:bg-amber-950/20">
              <p className="mb-2 text-sm font-medium">
                Prévia — {pending.length} classificação(ões). Edite direto nas
                células ou peça ajustes pelo chat (a resposta substitui a
                proposta inteira).
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{rawFieldLabel}</TableHead>
                      <TableHead className="w-20">Registros</TableHead>
                      {targets.map((t) => (
                        <TableHead key={t.fieldKey}>{t.label}</TableHead>
                      ))}
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.map((it, i) => (
                      <TableRow key={it.rawNorm}>
                        <TableCell
                          className="max-w-56 truncate font-medium"
                          title={it.rawValue}
                        >
                          {it.rawValue}
                        </TableCell>
                        <TableCell className="tabular-nums">{it.count}</TableCell>
                        {targets.map((t) => (
                          <TableCell key={t.fieldKey}>
                            <Input
                              value={it.outputs[t.fieldKey] ?? ""}
                              list={listId(t.fieldKey)}
                              placeholder="—"
                              onChange={(e) =>
                                setOutput(i, t.fieldKey, e.target.value)
                              }
                              disabled={applying}
                              className="h-8"
                              aria-label={`${t.label} para ${it.rawValue}`}
                            />
                          </TableCell>
                        ))}
                        <TableCell>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => removeItem(i)}
                            disabled={applying}
                            aria-label={`Remover ${it.rawValue} da prévia`}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" onClick={applyPending} disabled={applying || busy}>
                  {applying
                    ? "Aplicando…"
                    : `Aplicar ${pending.length} classificação(ões)`}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPending([])}
                  disabled={applying}
                >
                  Descartar
                </Button>
              </div>
            </div>
          ) : null}

          {ai?.hasKey ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => sendTurn(true)}
                  disabled={busy || applying}
                >
                  {busy ? "Gerando…" : "Classificar pendentes"}
                </Button>
                <p className="text-muted-foreground text-xs">
                  Usa {ai.provider} · {ai.model}. Nada é gravado sem a sua
                  confirmação.
                </p>
              </div>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  pending.length > 0
                    ? "Peça ajustes na proposta (a resposta substitui a prévia inteira)…"
                    : 'Instruções opcionais — ex.: "cargos de fundador contam como C-Level"'
                }
                rows={2}
                disabled={busy || applying}
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => sendTurn()}
                  disabled={busy || applying || description.trim() === ""}
                >
                  Enviar instrução
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
                O prompt inclui o formato, as categorias aceitas e os valores
                pendentes.
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
              placeholder="Cole aqui a resposta da IA externa (JSON ou CSV valor,<campos>)…"
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
                Validar resposta
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
