// Versão: 1.0 | Data: 30/07/2026
// Sheet "Inserir com IA" (/registros, bases com manual_entry): o usuário
// descreve/cola até 10 registros em texto livre; a IA aloca nos campos da base
// (copiando o formato dos dados existentes — amostras no prompt do servidor) e
// a PRÉVIA obrigatória mostra SÓ as colunas preenchidas, com:
//   - edição inline por célula (editor conforme o tipo do campo);
//   - TROCA de coluna no cabeçalho (realoca o dado para outro campo aceito) ou
//     remoção da coluna — helpers puros de lib/import/records/preview.ts;
//   - badge de aviso quando o título já existe na base (não bloqueia).
// Conversa 100% client-state (padrão do ImportDashboardSheet): turnos de
// usuário + prévia pendente reinjetada no próximo turno ("a resposta SUBSTITUI
// a prévia inteira"); edições inline entram nessa reinjeção e no apply. NADA é
// inserido sem confirmação — o apply re-valida no servidor e grava via
// createRecord (choke point manual; RLS é a muralha).
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
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
import { emitDataChanged } from "@/lib/tasks/events";
import type {
  EntryFieldSpec,
  EntryRecord,
} from "@/lib/import/records/types";
import {
  filledColumns,
  remapColumn,
  removeColumn,
  setCell,
  unusedFields,
} from "@/lib/import/records/preview";
import { serializeRecordsInsert } from "@/lib/import/records/validate";
import type {
  ApplyRecordsState,
  GenerateRecordsState,
} from "@/lib/ai/insert-records";
import {
  applyGeneratedRecords,
  generateRecordsWithAi,
} from "@/app/(app)/registros/ai-insert-actions";

const REMOVE_VALUE = "__remove__";

function lower(s: string): string {
  return s.trim().toLocaleLowerCase("pt-BR");
}

// Editor de célula conforme o tipo do campo (espelha os inputs do formulário
// manual, record-create-sheet). Valor vazio remove a chave (coluna some da
// prévia quando esvazia por completo — regra "só colunas preenchidas").
function CellEditor({
  spec,
  value,
  onChange,
}: {
  spec: EntryFieldSpec;
  value: string;
  onChange: (v: string) => void;
}) {
  if (
    spec.dataType === "relacao" ||
    (spec.strictOptions && (spec.options?.length ?? 0) > 0)
  ) {
    return (
      <Combobox
        options={[
          { value: "", label: "—" },
          ...(spec.options ?? []).map((o) => ({ value: o, label: o })),
        ]}
        value={value}
        onValueChange={onChange}
        placeholder="—"
        className="w-full min-w-28"
        aria-label={spec.label}
      />
    );
  }
  if (spec.dataType === "booleano") {
    return (
      <Combobox
        options={[
          { value: "", label: "—" },
          { value: "true", label: "Sim" },
          { value: "false", label: "Não" },
        ]}
        value={value}
        onValueChange={onChange}
        searchable={false}
        placeholder="—"
        className="w-full min-w-24"
        aria-label={spec.label}
      />
    );
  }
  if (spec.dataType === "data") {
    return (
      <Input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-36"
        aria-label={spec.label}
      />
    );
  }
  if (spec.dataType === "numero" || spec.dataType === "moeda") {
    return (
      <Input
        type="number"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-24"
        aria-label={spec.label}
      />
    );
  }
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-32"
      aria-label={spec.label}
    />
  );
}

export function RecordsAiInsertSheet({
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
  const [fields, setFields] = useState<EntryFieldSpec[]>([]);
  const [rows, setRows] = useState<EntryRecord[]>([]);
  const [duplicates, setDuplicates] = useState<Set<string>>(new Set());
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, busy]);

  if (!ai?.hasKey) return null;

  const pending = rows.length > 0;
  const cols = filledColumns(rows, fields);
  const unused = unusedFields(rows, fields);

  async function sendTurn() {
    const text = description.trim();
    if (!text || busy || applying) return;
    setChat((c) => [...c, { kind: "user", text }]);
    setDescription("");
    setBusy(true);
    try {
      const res: GenerateRecordsState = await generateRecordsWithAi({
        sourceKey: source.key,
        description: text,
        priorTurns: turns,
        pendingJson: pending ? serializeRecordsInsert(rows) : undefined,
      });
      setTurns((t) => [...t, text]);
      if (res.ok) {
        setRows(res.records ?? []);
        setFields(res.fields ?? []);
        setDuplicates(new Set((res.duplicateTitles ?? []).map(lower)));
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
        {
          kind: "error",
          text: "Falha de comunicação ao gerar — tente de novo.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function applyRows() {
    if (!pending || busy || applying) return;
    setApplying(true);
    try {
      const res: ApplyRecordsState = await applyGeneratedRecords(
        serializeRecordsInsert(rows),
        { sourceKey: source.key }
      );
      const inserted = res.insertedCount ?? 0;
      const failLines = (res.results ?? [])
        .filter((r) => !r.ok)
        .map((r) => `${r.index + 1}. ${r.title || "(sem nome)"}: ${r.message ?? "falha"}`);
      if (inserted > 0) {
        // Parcial também limpa a prévia: re-aplicar duplicaria os inseridos.
        setRows([]);
        setDuplicates(new Set());
        emitDataChanged({ kind: "record" });
        router.refresh();
      }
      setChat((c) => [
        ...c,
        res.ok
          ? { kind: "ok", text: res.message ?? "Registros inseridos." }
          : {
              kind: "error",
              text: res.message ?? "Falha ao inserir.",
              errors: res.errors ?? failLines,
            },
      ]);
    } catch {
      setChat((c) => [
        ...c,
        {
          kind: "error",
          text: "Falha de comunicação ao inserir — confira a lista antes de tentar de novo (a inserção pode ter concluído no servidor).",
        },
      ]);
    } finally {
      setApplying(false);
    }
  }

  function discard() {
    setRows([]);
    setDuplicates(new Set());
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Sparkles className="size-4" />
        Inserir com IA
      </Button>
      <SheetContent className="flex flex-col overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Inserir registros com IA</SheetTitle>
          <SheetDescription>
            Descreva ou cole até 10 registros para {source.label}; a IA aloca os
            dados nos campos copiando o formato dos registros existentes. Nada é
            inserido sem a sua confirmação.
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

          {pending ? (
            <div className="rounded-md border border-amber-300/60 bg-amber-50/60 p-3 dark:border-amber-400/30 dark:bg-amber-950/20">
              <p className="mb-2 text-sm font-medium">
                Prévia — {rows.length} registro(s), só colunas preenchidas.
                Edite as células ou troque a coluna de um dado pelo cabeçalho.
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {cols.map((col) =>
                        col.key === "title" ? (
                          <TableHead key={col.key} className="min-w-40">
                            {col.label} *
                          </TableHead>
                        ) : (
                          <TableHead key={col.key} className="min-w-32">
                            <Combobox
                              options={[
                                { value: col.key, label: col.label },
                                ...unused.map((f) => ({
                                  value: f.key,
                                  label: `→ ${f.label}`,
                                })),
                                {
                                  value: REMOVE_VALUE,
                                  label: "— remover coluna —",
                                },
                              ]}
                              value={col.key}
                              onValueChange={(v) => {
                                if (v === REMOVE_VALUE) {
                                  setRows(removeColumn(rows, col.key));
                                } else if (v && v !== col.key) {
                                  setRows(remapColumn(rows, col.key, v));
                                }
                              }}
                              className="w-full font-normal"
                              aria-label={`Coluna ${col.label}`}
                            />
                          </TableHead>
                        )
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, i) => (
                      <TableRow key={i}>
                        {cols.map((col) => (
                          <TableCell key={col.key} className="align-top">
                            <CellEditor
                              spec={col}
                              value={String(row[col.key] ?? "")}
                              onChange={(v) => setRows(setCell(rows, i, col.key, v))}
                            />
                            {col.key === "title" &&
                            duplicates.has(lower(String(row.title ?? ""))) ? (
                              <p className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-500">
                                <TriangleAlert className="size-3" />
                                já existe registro com este título
                              </p>
                            ) : null}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" onClick={applyRows} disabled={applying || busy}>
                  {applying
                    ? "Inserindo…"
                    : `Inserir ${rows.length} registro(s)`}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={discard}
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
                pending
                  ? "Peça ajustes na proposta (a resposta substitui a prévia inteira)…"
                  : "Ex.: 3 leads de ontem da feira: ACME (Maria, R$ 1.250,50), Beta…"
              }
              rows={3}
              disabled={busy || applying}
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs">
                Usa {ai.provider} · {ai.model}. Nada é inserido sem a sua
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
