// Versão: 1.0 | Data: 05/07/2026
// Gerência de Operações (admin): criar (com pai), trocar pai, ativar/desativar,
// excluir. Aninhamento = parent_operation_id.
"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createOperation,
  deleteOperation,
  updateOperation,
  type OpState,
} from "@/app/(app)/admin/operacoes/actions";

export interface OperationRow {
  id: string;
  name: string;
  active: boolean;
  parent_operation_id: string | null;
}

const initial: OpState = {};

export function OperationsManager({ operations }: { operations: OperationRow[] }) {
  const [state, formAction, pending] = useActionState(createOperation, initial);
  const [parentId, setParentId] = useState("");
  const [, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4">
      <form
        action={formAction}
        className="flex flex-wrap items-end gap-3 rounded-lg border p-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Nova operação</Label>
          <Input id="name" name="name" placeholder="Ex.: High Touch" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="parent">Operação-pai (opcional)</Label>
          <Combobox
            id="parent"
            name="parent_operation_id"
            options={[
              { value: "", label: "— nenhuma (top-level) —" },
              ...operations.map((o) => ({ value: o.id, label: o.name })),
            ]}
            value={parentId}
            onValueChange={setParentId}
            placeholder="— nenhuma (top-level) —"
            className="min-w-56"
            aria-label="Operação-pai"
          />
        </div>
        <Button type="submit" disabled={pending}>
          <Plus className="size-4" /> Criar
        </Button>
        {state.message ? (
          <span
            className={state.ok ? "text-muted-foreground text-sm" : "text-destructive text-sm"}
          >
            {state.message}
          </span>
        ) : null}
      </form>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Operação</TableHead>
              <TableHead>Pai</TableHead>
              <TableHead>Ativa</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {operations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground text-center">
                  Nenhuma operação.
                </TableCell>
              </TableRow>
            ) : (
              operations.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.name}</TableCell>
                  <TableCell>
                    <Combobox
                      options={[
                        { value: "", label: "— nenhuma —" },
                        ...operations
                          .filter((p) => p.id !== o.id)
                          .map((p) => ({ value: p.id, label: p.name })),
                      ]}
                      value={o.parent_operation_id ?? ""}
                      onValueChange={(v) =>
                        startTransition(async () => {
                          await updateOperation(o.id, {
                            parent_operation_id: v || null,
                          });
                        })
                      }
                      placeholder="— nenhuma —"
                      className="min-w-48"
                      aria-label="Operação-pai"
                    />
                  </TableCell>
                  <TableCell>
                    <input
                      type="checkbox"
                      defaultChecked={o.active}
                      className="size-4 accent-primary"
                      onChange={(e) =>
                        startTransition(async () => {
                          await updateOperation(o.id, { active: e.target.checked });
                        })
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Excluir"
                      onClick={() =>
                        startTransition(async () => {
                          await deleteOperation(o.id);
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
