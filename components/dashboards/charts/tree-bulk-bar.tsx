// Versão: 1.0 | Data: 10/09/2026
// Barra de AÇÕES EM MASSA da árvore.
//
// A diferença para a barra de tarefas é que aqui a seleção é MISTA: um galho
// pode ter tarefas, anotações e nós livres juntos. Cada tipo vai para a action
// que já é dona dele (`deleteTasksBulk`, `deleteCommentsBulk`,
// `deleteTreeNodesBulk`) — a barra reparte, não decide regra.
//
// "Concluir" só existe para TAREFA: anotação e nó livre não têm o que
// concluir. Com nenhuma tarefa selecionada o botão some, em vez de ficar ali
// desabilitado sem explicação.
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
import { deleteCommentsBulk } from "@/lib/comments/actions";
import { deleteTreeNodesBulk } from "@/app/(app)/dashboards/tree-actions";
import {
  BULK_MAX_ITEMS,
  chunk,
  type BulkActionState,
  type BulkItemResult,
} from "@/lib/kanban/bulk-helpers";
import { emitDataChanged } from "@/lib/tasks/events";
import { selectionSummary } from "@/lib/tree/selection";

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
        ...slice.map((id) => ({ id, ok: false, message: res.message ?? "Falha." }))
      );
      continue;
    }
    out.push(...(res.results ?? []));
  }
  return out;
}

export function TreeBulkBar({
  taskIds,
  commentIds,
  noteIds,
  onClear,
  onDone,
}: {
  taskIds: string[];
  commentIds: string[];
  noteIds: string[];
  onClear: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<"complete" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const total = taskIds.length + commentIds.length + noteIds.length;
  const summary = selectionSummary({ taskIds, commentIds, noteIds });

  async function completeSelected() {
    setBusy("complete");
    setError(null);
    try {
      const results = await runInChunks(taskIds, (ids) =>
        completeTasksBulk({ taskIds: ids })
      );
      const failed = results.filter((r) => !r.ok);
      setError(
        failed.length > 0
          ? `${failed.length} tarefa(s) não: ${failed[0]?.message ?? ""}`
          : null
      );
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
      // Um tipo de cada vez, cada um pela action que é dona dele. Sequencial:
      // o resultado agregado tem de contar as falhas dos três.
      const results = [
        ...(await runInChunks(taskIds, (ids) => deleteTasksBulk(ids))),
        ...(await runInChunks(commentIds, (ids) => deleteCommentsBulk(ids))),
        ...(await runInChunks(noteIds, (ids) => deleteTreeNodesBulk(ids))),
      ];
      const failed = results.filter((r) => !r.ok);
      setError(
        failed.length > 0
          ? `${failed.length} item(ns) não: ${failed[0]?.message ?? ""}`
          : null
      );
      if (taskIds.length > 0) emitDataChanged({ kind: "task" });
      if (commentIds.length > 0) emitDataChanged({ kind: "comment" });
      onDone();
    } finally {
      setBusy(null);
    }
  }

  return (
    <BulkBarShell count={total} onClear={onClear} error={error}>
      <span className="text-muted-foreground text-xs">{summary}</span>

      {taskIds.length > 0 ? (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1"
          onClick={() => void completeSelected()}
          disabled={busy !== null}
        >
          <CheckCheck className="size-3.5" />
          {busy === "complete"
            ? "Concluindo…"
            : `Concluir (${taskIds.length})`}
        </Button>
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
            <AlertDialogTitle>Excluir {summary}?</AlertDialogTitle>
            <AlertDialogDescription>
              A exclusão é definitiva. Item sem permissão é recusado
              individualmente, e a barra diz quantos ficaram. Tarefa espelhada
              some também da timeline do Bitrix.
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
