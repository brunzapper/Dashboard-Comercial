// Versão: 1.0 | Data: 07/08/2026
// Tabela da Lixeira de registros (0121): Restaurar e Excluir definitivamente
// por linha, sobre as actions de lib/records/trash-actions (contrato por
// item). Restaurar não pede confirmação (é a operação "segura"); excluir
// definitivamente confirma via ConfirmDialog. Pós-sucesso: emitDataChanged +
// router.refresh() (a página é RSC — a linha some/renasce no re-render).
// Pending por LINHA (busyId), nunca por tela.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArchiveRestore, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  purgeRecordsPermanently,
  restoreRecordsBulk,
} from "@/lib/records/trash-actions";
import type { BulkActionState } from "@/lib/kanban/bulk-helpers";
import { emitDataChanged } from "@/lib/tasks/events";

export interface TrashItem {
  id: string;
  title: string;
  baseLabel: string;
  responsibleName: string;
  deletedAt: string;
  expiryLabel: string;
}

function deletedAtLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function TrashTable({ items }: { items: TrashItem[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmPurge, setConfirmPurge] = useState<TrashItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border p-8 text-center text-sm">
        A Lixeira está vazia.
      </div>
    );
  }

  const run = async (
    item: TrashItem,
    action: (ids: string[]) => Promise<BulkActionState>
  ) => {
    setBusyId(item.id);
    setError(null);
    try {
      const res = await action([item.id]);
      const itemError = res.ok
        ? res.results?.find((r) => !r.ok)?.message ?? null
        : res.message ?? "Falha na operação.";
      if (itemError) {
        setError(`${item.title}: ${itemError}`);
        return;
      }
      emitDataChanged({ kind: "record", recordId: item.id });
      startTransition(() => router.refresh());
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p className="text-destructive text-sm" role="status">
          {error}
        </p>
      ) : null}
      <div className="rounded-lg border overflow-x-auto">
        <Table containerClassName="overflow-x-visible">
          <TableHeader>
            <TableRow>
              <TableHead>Registro</TableHead>
              <TableHead>Base</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Excluído em</TableHead>
              <TableHead>Expira</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="max-w-[280px] truncate font-medium">
                  {item.title}
                </TableCell>
                <TableCell>{item.baseLabel}</TableCell>
                <TableCell>{item.responsibleName}</TableCell>
                <TableCell>{deletedAtLabel(item.deletedAt)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {item.expiryLabel}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1"
                      disabled={busyId === item.id}
                      onClick={() => run(item, restoreRecordsBulk)}
                    >
                      <ArchiveRestore className="size-3.5" />
                      Restaurar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive h-7 gap-1"
                      disabled={busyId === item.id}
                      onClick={() => setConfirmPurge(item)}
                    >
                      <Trash2 className="size-3.5" />
                      Excluir definitivamente
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ConfirmDialog
        open={confirmPurge != null}
        onOpenChange={(v) => {
          if (!v) setConfirmPurge(null);
        }}
        title={`Excluir definitivamente "${confirmPurge?.title ?? ""}"?`}
        description="Esta ação não pode ser desfeita. Tarefas, comentários, conexões e posicionamentos vinculados também serão excluídos."
        actionLabel="Excluir definitivamente"
        pending={busyId != null}
        onConfirm={() => {
          const item = confirmPurge;
          setConfirmPurge(null);
          if (item) void run(item, purgeRecordsPermanently);
        }}
      />
    </div>
  );
}
