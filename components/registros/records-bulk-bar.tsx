// Versão: 1.1 | Data: 10/09/2026
// v1.1 (10/09/2026): a pill sticky saiu para `components/ui/bulk-bar-shell.tsx`.
// As classes e os nomes acessíveis estavam LITERALMENTE duplicados com o
// bulk-action-bar do kanban, e a seleção de tarefas ia criar a 3ª e a 4ª cópia.
// Comportamento e nomes acessíveis inalterados (os testes ancoram neles).
// Barra flutuante de AÇÕES EM MASSA da tabela de registros (espelho do
// bulk-action-bar do kanban): aparece com seleção > 0, pill sticky no rodapé.
// Ações: Editar campos (edição manual — BulkEditSheet), Editar com IA
// (RecordsAiUpdateSheet em modo seleção) e Excluir (→ Lixeira 30 dias via
// trashRecordsBulk, só admin — AlertDialog). Pós-sucesso o DONO da seleção
// (records-table) limpa e dá refresh via onDone. Falhas por item aparecem
// como texto na própria barra (≤50 itens por página — sem fila otimista).
"use client";

import { useState } from "react";
import { Pencil, Trash2, Wand2 } from "lucide-react";

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
import { trashRecordsBulk } from "@/lib/records/trash-actions";
import { BulkEditSheet } from "./bulk-edit-sheet";
import { RecordsAiUpdateSheet } from "./ai-update-sheet";

export function RecordsBulkBar({
  source,
  ai,
  selectedIds,
  canEditValues,
  canDelete,
  onClear,
  onDone,
  onSheetOpenChange,
}: {
  source: { key: string; label: string };
  ai: { provider: string; model: string; hasKey: boolean } | null;
  selectedIds: string[];
  canEditValues: boolean;
  canDelete: boolean;
  /** Limpar a seleção (X / pós-ação). */
  onClear: () => void;
  /** Ação que escreveu algo: limpar seleção + refresh (dono: a tabela). */
  onDone: () => void;
  /** Sheets desta barra abertos/fechados — a tabela pausa o hover-pan. */
  onSheetOpenChange?: (open: boolean) => void;
}) {
  const count = selectedIds.length;
  const [editOpen, setEditOpenRaw] = useState(false);
  const [aiOpen, setAiOpenRaw] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setEditOpen = (v: boolean) => {
    setEditOpenRaw(v);
    onSheetOpenChange?.(v);
  };
  const setAiOpen = (v: boolean) => {
    setAiOpenRaw(v);
    onSheetOpenChange?.(v);
  };

  if (count === 0) return null;

  async function deleteSelected() {
    setDeleting(true);
    setError(null);
    try {
      const res = await trashRecordsBulk(selectedIds);
      if (!res.ok) {
        setError(res.message ?? "Falha ao excluir.");
        return;
      }
      const failures = (res.results ?? []).filter((r) => !r.ok);
      if (failures.length > 0) {
        setError(
          `${failures.length} registro(s) não foram excluídos: ${failures[0]?.message ?? ""}`
        );
      }
      onDone();
    } catch {
      setError("Falha de comunicação ao excluir — tente de novo.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <BulkBarShell count={count} onClear={onClear} error={error}>
      {canEditValues ? (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1"
          onClick={() => setEditOpen(true)}
          disabled={deleting}
        >
          <Pencil className="size-3.5" />
          Editar campos
        </Button>
      ) : null}

      {canEditValues ? (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1"
          onClick={() => setAiOpen(true)}
          disabled={deleting}
        >
          <Wand2 className="size-3.5" />
          Editar com IA
        </Button>
      ) : null}

      {canDelete ? (
        <>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive h-7 gap-1"
            onClick={() => setConfirmDelete(true)}
            disabled={deleting}
          >
            <Trash2 className="size-3.5" />
            {deleting ? "Excluindo…" : "Excluir"}
          </Button>
          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Excluir {count} registro(s)?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Os registros vão para a Lixeira e podem ser restaurados em
                  até 30 dias (Registros → Lixeira). Depois disso são
                  excluídos definitivamente.
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
        </>
      ) : null}

      {canEditValues ? (
        <BulkEditSheet
          source={source}
          selectedIds={selectedIds}
          open={editOpen}
          onOpenChange={setEditOpen}
          onApplied={onDone}
        />
      ) : null}
      {canEditValues ? (
        <RecordsAiUpdateSheet
          source={source}
          ai={ai}
          selection={{ ids: selectedIds }}
          open={aiOpen}
          onOpenChange={setAiOpen}
          hideTrigger
          onApplied={onDone}
        />
      ) : null}
    </BulkBarShell>
  );
}
