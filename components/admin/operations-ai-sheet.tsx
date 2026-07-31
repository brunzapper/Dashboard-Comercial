// Versão: 1.0 | Data: 31/07/2026
// Sheet "Gerir com IA" (Configurações → Operações): o admin descreve em texto
// livre e a IA propõe um lote de até 15 ações (criar/editar/vincular/
// desvincular — sem exclusão); a PRÉVIA lista as ações e NADA é aplicado sem
// confirmação (apply re-valida no servidor e escreve pelos choke points —
// invariante 25). Duas entradas para o MESMO contrato: chat interno (exige IA
// configurada) e fluxo manual copiar-prompt → colar-JSON de IA externa
// (funciona SEM IA configurada — padrão do ImportDashboardSheet). Conversa
// 100% client-state; a resposta de um turno SUBSTITUI a proposta inteira.
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCopy, Sparkles } from "lucide-react";

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AiChatLog, type AiChatEntry } from "@/components/dashboards/ai-chat-log";
import type { ParsedOperationAction } from "@/lib/import/operations/types";
import { serializeOperationsEdit } from "@/lib/import/operations/validate";
import type {
  ApplyOperationsState,
  GenerateOperationsState,
} from "@/lib/ai/manage-operations";
import {
  applyGeneratedOperations,
  buildOperationsPrompt,
  generateOperationsWithAi,
  previewOperationsJson,
} from "@/app/(app)/configuracoes/operacoes/ai-operations-actions";

const ACTION_LABELS: Record<ParsedOperationAction["acao"], string> = {
  criar: "Criar",
  editar: "Editar",
  vincular: "Vincular",
  desvincular: "Desvincular",
};

function targetOf(a: ParsedOperationAction): string {
  if (a.acao === "criar") return a.nome;
  if (a.acao === "editar") return a.alvo.nome;
  return `${a.responsavel.nome} → ${a.operacao.nome}`;
}

// Detalhe de EXIBIÇÃO da prévia (o contrato/validação vivem no servidor).
function detailOf(a: ParsedOperationAction): string {
  if (a.acao === "criar") {
    const parts: string[] = [a.pai ? `pai: ${a.pai.nome}` : "raiz"];
    if (a.perfil) parts.push(`perfil: ${a.perfil.length} condição(ões)`);
    return parts.join(" · ");
  }
  if (a.acao === "editar") {
    const parts: string[] = [];
    if (a.novoNome !== undefined) parts.push(`renomear p/ "${a.novoNome}"`);
    if (a.novoPai !== undefined)
      parts.push(a.novoPai === null ? "vira raiz" : `mover p/ ${a.novoPai.nome}`);
    if (a.ativa !== undefined) parts.push(a.ativa ? "ativar" : "desativar");
    if (a.perfil !== undefined)
      parts.push(
        a.perfil === null
          ? "limpar perfil"
          : `perfil: ${a.perfil.length} condição(ões)`
      );
    return parts.join(" · ") || "—";
  }
  if (a.acao === "vincular") return `prioridade ${a.prioridade}`;
  return "desfaz o vínculo";
}

export function OperationsAiSheet({
  ai,
}: {
  ai: { provider: string; model: string; hasKey: boolean } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState<AiChatEntry[]>([]);
  const [turns, setTurns] = useState<string[]>([]);
  const [pending, setPending] = useState<ParsedOperationAction[]>([]);
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

  const pushResult = (res: GenerateOperationsState) => {
    if (res.ok) {
      setPending(res.actions ?? []);
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
      const res = await generateOperationsWithAi({
        description: text,
        priorTurns: turns,
        pendingJson:
          pending.length > 0 ? serializeOperationsEdit(pending) : undefined,
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
      const res = await previewOperationsJson(raw);
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
      const res = await buildOperationsPrompt();
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
      const res: ApplyOperationsState = await applyGeneratedOperations(
        serializeOperationsEdit(pending)
      );
      const applied = res.appliedCount ?? 0;
      const failLines = (res.results ?? [])
        .filter((r) => r && !r.ok)
        .map((r) => `${r.index + 1}. ${r.titulo}: ${r.message ?? "falha"}`);
      if (applied > 0) {
        // Parcial também limpa: re-aplicar re-executaria os itens que já
        // passaram (criação duplicada colidiria por nome).
        setPending([]);
        router.refresh();
      }
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
          text: "Falha de comunicação ao aplicar — confira as operações antes de tentar de novo.",
        },
      ]);
    } finally {
      setApplying(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Sparkles className="size-4" />
        Gerir com IA
      </Button>
      <SheetContent className="flex flex-col overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Gerir operações com IA</SheetTitle>
          <SheetDescription>
            Descreva mudanças (criar operações, mover na árvore, vincular
            responsáveis, definir perfis) e revise a prévia. Nada é aplicado
            sem a sua confirmação; exclusão fica na tela.
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

          {pending.length > 0 ? (
            <div className="rounded-md border border-amber-300/60 bg-amber-50/60 p-3 dark:border-amber-400/30 dark:bg-amber-950/20">
              <p className="mb-2 text-sm font-medium">
                Prévia — {pending.length} ação(ões). Para ajustar, peça pelo
                chat ou cole outro JSON (a resposta substitui a proposta
                inteira).
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">Nº</TableHead>
                      <TableHead>Ação</TableHead>
                      <TableHead>Alvo</TableHead>
                      <TableHead>Detalhes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.map((a, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-muted-foreground">
                          {i + 1}
                        </TableCell>
                        <TableCell className="font-medium">
                          {ACTION_LABELS[a.acao]}
                        </TableCell>
                        <TableCell>{targetOf(a)}</TableCell>
                        <TableCell className="text-muted-foreground max-w-72 text-xs">
                          {detailOf(a)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" onClick={applyPending} disabled={applying || busy}>
                  {applying ? "Aplicando…" : `Aplicar ${pending.length} ação(ões)`}
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
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  pending.length > 0
                    ? "Peça ajustes na proposta (a resposta substitui a prévia inteira)…"
                    : 'Ex.: crie a operação "Expansão Sul" dentro de Comercial e vincule a Maria como prioridade 1'
                }
                rows={3}
                disabled={busy || applying}
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-muted-foreground text-xs">
                  Usa {ai.provider} · {ai.model}. Nada é aplicado sem a sua
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
                O prompt inclui o formato e o catálogo atual de
                operações/responsáveis.
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
