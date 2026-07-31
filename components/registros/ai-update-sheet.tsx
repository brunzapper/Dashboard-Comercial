// Versão: 1.0 | Data: 31/07/2026
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
import { Checkbox } from "@/components/ui/checkbox";
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
import type {
  ApplyRecordsUpdateState,
  GenerateRecordsUpdateState,
  RecordsUpdatePreview,
} from "@/lib/ai/update-records";
import {
  applyRecordsUpdate,
  buildRecordsUpdatePrompt,
  generateRecordsUpdateWithAi,
  previewRecordsUpdateJson,
} from "@/app/(app)/registros/ai-update-actions";

export function RecordsAiUpdateSheet({
  source,
  ai,
}: {
  source: { key: string; label: string };
  ai: { provider: string; model: string; hasKey: boolean } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
      const res = await generateRecordsUpdateWithAi({
        sourceKey: source.key,
        description: text,
        priorTurns: turns,
        pendingJson: pendingJson ?? undefined,
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
      const res = await previewRecordsUpdateJson(raw, source.key);
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
      const res = await buildRecordsUpdatePrompt(source.key);
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
      const res: ApplyRecordsUpdateState = await applyRecordsUpdate(
        pendingJson,
        source.key
      );
      if ((res.changedCount ?? 0) > 0) {
        clearPending();
        router.refresh();
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

  const applyBlocked =
    !preview || preview.overCap || preview.total === 0 || !confirmed;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Wand2 className="size-4" />
        Atualizar com IA
      </Button>
      <SheetContent className="flex flex-col overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Atualizar registros com IA — {source.label}</SheetTitle>
          <SheetDescription>
            Descreva uma correção em massa (ex.: &quot;todos com fonte X ficam
            com SDR Fulano&quot;). O servidor mostra quantos registros casam e
            uma amostra antes de você confirmar — nada é gravado sem isso.
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
            <div className="rounded-md border border-amber-300/60 bg-amber-50/60 p-3 dark:border-amber-400/30 dark:bg-amber-950/20">
              <p className="mb-1 text-sm font-medium">
                Prévia — {preview.total} registro(s) casam os filtros
                {preview.mockCount > 0
                  ? ` (${preview.mockCount} de demonstração serão pulados)`
                  : ""}
                .
              </p>
              <div className="text-muted-foreground mb-2 flex flex-wrap gap-1 text-xs">
                {preview.filterLabels.map((f, i) => (
                  <span key={i} className="bg-muted rounded px-1.5 py-0.5">
                    {f}
                  </span>
                ))}
              </div>
              <ul className="mb-2 text-sm">
                {preview.changeLabels.map((ch) => (
                  <li key={ch.key}>
                    <span className="font-medium">{ch.label}</span> → {ch.value}
                    {ch.sync ? (
                      <span className="text-muted-foreground text-xs">
                        {" "}
                        (campo de Sync — escrita local)
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {preview.sample.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Registro</TableHead>
                        {preview.changeLabels.map((ch) => (
                          <TableHead key={ch.key}>{ch.label}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.sample.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="max-w-48 truncate font-medium">
                            {row.title}
                          </TableCell>
                          {row.cells.map((cell) => (
                            <TableCell
                              key={cell.key}
                              className="text-muted-foreground text-xs"
                            >
                              {cell.from} → {cell.to}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {preview.total > preview.sample.length ? (
                    <p className="text-muted-foreground mt-1 text-xs">
                      Amostra de {preview.sample.length} — a alteração vale para
                      os {preview.total} registro(s) do recorte.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {preview.overCap ? (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                  Recorte acima do teto — peça filtros mais específicos pelo
                  chat antes de aplicar.
                </p>
              ) : preview.total > 0 ? (
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={confirmed}
                    onCheckedChange={(v) => setConfirmed(v === true)}
                    disabled={applying}
                  />
                  Confirmo a alteração de {preview.total - preview.mockCount}{" "}
                  registro(s)
                </label>
              ) : null}
              <div className="mt-3 flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={applyPending}
                  disabled={applying || busy || applyBlocked}
                >
                  {applying ? "Aplicando…" : "Aplicar alteração"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={clearPending}
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
