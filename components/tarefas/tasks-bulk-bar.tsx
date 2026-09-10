// Versão: 1.0 | Data: 10/09/2026
// Barra de AÇÕES EM MASSA de tarefas — a aba Tarefas, o painel de linha do
// dashboard e a seção de tarefas do registro usam esta mesma barra.
//
// O servidor já existia: `completeTasksBulk`/`deleteTasksBulk`
// (`lib/kanban/bulk-actions.ts`) foram construídos para a seleção do kanban e
// eram usados só por ela. Aqui não há action nova, só a porta.
//
// DUAS decisões de UX que o código carrega:
//
//  1. **"Concluir" age só nas ABERTAS.** Mandar as já concluídas junto faria a
//     action devolver "sem permissão (ou já concluída)" por item, e a barra
//     acusaria falha num resultado que é o desejado. A contagem de já
//     concluídas é dita, não escondida.
//  2. **O cliente FATIA.** O teto de `BULK_MAX_ITEMS` é por CHAMADA, e a action
//     recusa o lote inteiro acima dele — quem tem 300 tarefas na tela veria um
//     erro em vez da ação. O laço é sequencial de propósito (as actions
//     serializam por cliente; paralelizar só antecipa o rate limit).
"use client";

import { useState } from "react";
import { CheckCheck, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BulkBarShell } from "@/components/ui/bulk-bar-shell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { completeTasksBulk, deleteTasksBulk } from "@/lib/kanban/bulk-actions";
import {
  BULK_MAX_ITEMS,
  chunk,
  type BulkActionState,
  type BulkItemResult,
} from "@/lib/kanban/bulk-helpers";
import { emitDataChanged } from "@/lib/tasks/events";
import type { TaskRow } from "@/lib/tasks/types";

/**
 * Roda a action em fatias de `BULK_MAX_ITEMS` e junta os resultados por item.
 * Uma fatia que falha inteira (erro de query/rede) não impede as seguintes —
 * o usuário vê quantas ficaram para trás em vez de um "falhou" sem número.
 */
async function runInChunks(
  ids: string[],
  exec: (slice: string[]) => Promise<BulkActionState>
): Promise<BulkItemResult[]> {
  const out: BulkItemResult[] = [];
  for (const slice of chunk(ids, BULK_MAX_ITEMS)) {
    let res: BulkActionState;
    try {
      res = await exec(slice);
    } catch {
      res = { ok: false, message: "Falha de comunicação." };
    }
    if (!res.ok) {
      out.push(
        ...slice.map((id) => ({
          id,
          ok: false,
          message: res.message ?? "Falha.",
        }))
      );
      continue;
    }
    out.push(...(res.results ?? []));
  }
  return out;
}

function failureNote(results: BulkItemResult[], noun: string): string | null {
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return null;
  return `${failed.length} ${noun} não ${
    failed.length === 1 ? "foi" : "foram"
  }: ${failed[0]?.message ?? ""}`;
}

export function TasksBulkBar({
  tasks,
  onClear,
  onDone,
}: {
  /** As tarefas SELECIONADAS (não só os ids: a barra conta abertas). */
  tasks: TaskRow[];
  onClear: () => void;
  /** A tela recarrega do jeito dela — cada uma tem o seu (bus, refetch…). */
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<"complete" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const open = tasks.filter((t) => !t.completed_at);
  const alreadyDone = tasks.length - open.length;

  async function completeSelected() {
    setBusy("complete");
    setError(null);
    try {
      const results = await runInChunks(
        open.map((t) => t.id),
        (taskIds) => completeTasksBulk({ taskIds })
      );
      setError(failureNote(results, "tarefa(s)"));
      emitDataChanged({ kind: "task" });
      onDone();
    } finally {
      setBusy(null);
    }
  }

  async function deleteSelected() {
    setBusy("delete");
    setError(null);
    try {
      const results = await runInChunks(
        tasks.map((t) => t.id),
        (ids) => deleteTasksBulk(ids)
      );
      setError(failureNote(results, "tarefa(s)"));
      emitDataChanged({ kind: "task" });
      onDone();
    } finally {
      setBusy(null);
    }
  }

  return (
    <BulkBarShell count={tasks.length} onClear={onClear} error={error}>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1"
        onClick={() => void completeSelected()}
        disabled={busy !== null || open.length === 0}
      >
        <CheckCheck className="size-3.5" />
        {busy === "complete" ? "Concluindo…" : `Concluir (${open.length})`}
      </Button>

      {/* Dito, não escondido: a barra explica por que o botão conta menos. */}
      {alreadyDone > 0 ? (
        <span className="text-muted-foreground text-xs">
          {alreadyDone} já concluída(s)
        </span>
      ) : null}

      <Button
        variant="outline"
        size="sm"
        className="text-destructive h-7 gap-1"
        onClick={() => setConfirmDelete(true)}
        disabled={busy !== null}
      >
        <Trash2 className="size-3.5" />
        {busy === "delete" ? "Excluindo…" : "Excluir"}
      </Button>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir {tasks.length} tarefa(s)?
            </AlertDialogTitle>
            <AlertDialogDescription>
              A exclusão é definitiva — tarefa não tem lixeira. Tarefa travada
              ou de outra pessoa é recusada individualmente, e a barra diz
              quantas ficaram. Com o espelho no Bitrix ligado, a atividade
              correspondente também é removida de lá.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() => {
                setConfirmDelete(false);
                void deleteSelected();
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BulkBarShell>
  );
}
