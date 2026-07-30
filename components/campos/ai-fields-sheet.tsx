// Versão: 1.0 | Data: 30/07/2026
// Sheet "Criar com IA" (/campos): o usuário descreve os campos que precisa em
// texto livre; a IA propõe até 10 field_definitions (inclusive calculados com
// fórmula em modo texto, validada no servidor pelos MESMOS módulos do editor) e
// a PRÉVIA lista rótulo/chave/tipo/detalhes — ajustes pelo chat (a resposta
// substitui a proposta inteira); NADA é criado sem confirmação. O apply
// re-valida no servidor e cria campo a campo via createField (choke point de
// /campos). Conversa 100% client-state (padrão do ImportDashboardSheet).
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { DATA_TYPE_LABELS } from "@/lib/records/types";
import type { ParsedFieldCreate } from "@/lib/import/fields/types";
import { serializeFieldsCreate } from "@/lib/import/fields/validate";
import type {
  ApplyFieldsState,
  GenerateFieldsState,
} from "@/lib/ai/create-fields";
import {
  applyGeneratedFields,
  generateFieldsWithAi,
} from "@/app/(app)/campos/ai-fields-actions";

function detailCell(f: ParsedFieldCreate): string {
  const parts: string[] = [];
  if (f.opcoes) parts.push(`opções: ${f.opcoes.join(", ")}`);
  if (f.formulaTexto) parts.push(`= ${f.formulaTexto}`);
  if (f.moedaModo) {
    parts.push(
      f.moedaModo === "fixed"
        ? `moeda fixa ${f.moedaCodigo ?? "BRL"}`
        : "moeda do registro"
    );
  }
  if (f.percentual) parts.push("exibe %");
  return parts.join(" · ") || "—";
}

export function FieldsAiCreateSheet({
  ai,
}: {
  ai: { provider: string; model: string; hasKey: boolean } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState<AiChatEntry[]>([]);
  const [turns, setTurns] = useState<string[]>([]);
  const [pending, setPending] = useState<ParsedFieldCreate[]>([]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, busy]);

  if (!ai?.hasKey) return null;

  async function sendTurn() {
    const text = description.trim();
    if (!text || busy || applying) return;
    setChat((c) => [...c, { kind: "user", text }]);
    setDescription("");
    setBusy(true);
    try {
      const res: GenerateFieldsState = await generateFieldsWithAi({
        description: text,
        priorTurns: turns,
        pendingJson:
          pending.length > 0 ? serializeFieldsCreate(pending) : undefined,
      });
      setTurns((t) => [...t, text]);
      if (res.ok) {
        setPending(res.fields ?? []);
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
    } catch {
      setChat((c) => [
        ...c,
        { kind: "error", text: "Falha de comunicação ao gerar — tente de novo." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function applyPending() {
    if (pending.length === 0 || busy || applying) return;
    setApplying(true);
    try {
      const res: ApplyFieldsState = await applyGeneratedFields(
        serializeFieldsCreate(pending)
      );
      const created = res.createdCount ?? 0;
      const failLines = (res.results ?? [])
        .filter((r) => r && !r.ok)
        .map((r) => `${r.index + 1}. ${r.rotulo}: ${r.message ?? "falha"}`);
      if (created > 0) {
        // Parcial também limpa: re-aplicar colidiria com os já criados.
        setPending([]);
        router.refresh();
      }
      setChat((c) => [
        ...c,
        res.ok
          ? { kind: "ok", text: res.message ?? "Campos criados." }
          : {
              kind: "error",
              text: res.message ?? "Falha ao criar.",
              errors: res.errors ?? failLines,
            },
      ]);
    } catch {
      setChat((c) => [
        ...c,
        {
          kind: "error",
          text: "Falha de comunicação ao criar — confira a lista de campos antes de tentar de novo.",
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
        Criar com IA
      </Button>
      <SheetContent className="flex flex-col overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Criar campos com IA</SheetTitle>
          <SheetDescription>
            Descreva os campos que você precisa (inclusive calculados com
            fórmula) e revise a prévia. Nada é criado sem a sua confirmação.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 px-4 pb-6">
          <AiChatLog
            entries={chat}
            busy={busy}
            busyLabel="Gerando proposta…"
            className="max-h-56"
            ref={chatRef}
          />

          {pending.length > 0 ? (
            <div className="rounded-md border border-amber-300/60 bg-amber-50/60 p-3 dark:border-amber-400/30 dark:bg-amber-950/20">
              <p className="mb-2 text-sm font-medium">
                Prévia — {pending.length} campo(s) a criar. Para ajustar, peça
                pelo chat (a resposta substitui a proposta inteira).
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rótulo</TableHead>
                      <TableHead>Chave</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Detalhes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.map((f) => (
                      <TableRow key={f.fieldKey}>
                        <TableCell className="font-medium">{f.rotulo}</TableCell>
                        <TableCell className="text-muted-foreground font-mono text-xs">
                          {f.fieldKey}
                        </TableCell>
                        <TableCell>{DATA_TYPE_LABELS[f.tipo]}</TableCell>
                        <TableCell className="text-muted-foreground max-w-72 text-xs">
                          {detailCell(f)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={applyPending}
                  disabled={applying || busy}
                >
                  {applying ? "Criando…" : `Criar ${pending.length} campo(s)`}
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

          <div className="flex flex-col gap-2">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                pending.length > 0
                  ? "Peça ajustes na proposta (a resposta substitui a prévia inteira)…"
                  : 'Ex.: campo seleção "Status do contrato" (Ativo/Encerrado) e um calculado "Margem" = (Valor - Custo) / Valor em %'
              }
              rows={3}
              disabled={busy || applying}
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs">
                Usa {ai.provider} · {ai.model}. Nada é criado sem a sua
                confirmação.
              </p>
              <Button size="sm" onClick={sendTurn} disabled={busy || applying}>
                {busy ? "Gerando…" : "Enviar"}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
