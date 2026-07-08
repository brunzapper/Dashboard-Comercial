// Versão: 1.0 | Data: 05/07/2026
// Gerência de Operações (admin): criar (com pai), trocar pai, ativar/desativar,
// excluir. Aninhamento = parent_operation_id.
"use client";

import { useActionState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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

const selectClass =
  "border-input h-9 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";
const initial: OpState = {};

export function OperationsManager({ operations }: { operations: OperationRow[] }) {
  const [state, formAction, pending] = useActionState(createOperation, initial);
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
          <select id="parent" name="parent_operation_id" className={selectClass}>
            <option value="">— nenhuma (top-level) —</option>
            {operations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
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
                    <select
                      className={selectClass}
                      defaultValue={o.parent_operation_id ?? ""}
                      onChange={(e) =>
                        startTransition(async () => {
                          await updateOperation(o.id, {
                            parent_operation_id: e.target.value || null,
                          });
                        })
                      }
                    >
                      <option value="">— nenhuma —</option>
                      {operations
                        .filter((p) => p.id !== o.id)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
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
