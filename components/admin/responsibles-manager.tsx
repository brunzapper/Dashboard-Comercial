// Versão: 1.1 | Data: 13/07/2026
// Gerência de Responsáveis (admin): criar, ativar/desativar e mapear operações
// com prioridade. Responsáveis vêm do sync OU são criados aqui (só no sistema,
// sem Bitrix). O admin cura a lista.
"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { OptionItem } from "@/lib/records/types";
import {
  addResponsibleOperation,
  createResponsible,
  removeResponsibleOperation,
  setResponsibleActive,
  type ResponsibleState,
} from "@/app/(app)/configuracoes/responsaveis/actions";

export interface ResponsibleOp {
  operation_id: string;
  operation_name: string;
  priority: number;
}
export interface ResponsibleRow {
  id: string;
  display_name: string;
  bitrix_user_id: string | null;
  active: boolean;
  ops: ResponsibleOp[];
}

export function ResponsiblesManager({
  responsibles,
  operations,
}: {
  responsibles: ResponsibleRow[];
  operations: OptionItem[];
}) {
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<ResponsibleRow | null>(null);
  const [opId, setOpId] = useState("");
  const [priority, setPriority] = useState(1);
  const [createState, createAction, creating] = useActionState<
    ResponsibleState,
    FormData
  >(createResponsible, {});

  return (
    <div className="flex flex-col gap-4">
      <form
        action={createAction}
        className="flex flex-wrap items-end gap-3 rounded-lg border p-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="display_name">Novo responsável (só no sistema)</Label>
          <Input
            id="display_name"
            name="display_name"
            placeholder="Ex.: Maria Silva"
            className="min-w-56"
            required
          />
        </div>
        <Button type="submit" disabled={creating}>
          <Plus className="size-4" /> Criar
        </Button>
        {createState.message ? (
          <span
            className={
              createState.ok
                ? "text-muted-foreground text-sm"
                : "text-destructive text-sm"
            }
          >
            {createState.message}
          </span>
        ) : null}
      </form>

      <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Responsável</TableHead>
            <TableHead>Bitrix ID</TableHead>
            <TableHead>Ativo</TableHead>
            <TableHead>Operações</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {responsibles.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground text-center">
                Nenhum responsável ainda (são criados pelo sync do Bitrix/planilha ou aqui em cima).
              </TableCell>
            </TableRow>
          ) : (
            responsibles.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.display_name}</TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {r.bitrix_user_id ?? "—"}
                </TableCell>
                <TableCell>
                  <input
                    type="checkbox"
                    defaultChecked={r.active}
                    className="size-4 accent-primary"
                    onChange={(e) =>
                      startTransition(async () => {
                        await setResponsibleActive(r.id, e.target.checked);
                      })
                    }
                  />
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {r.ops.length === 0 ? (
                      <span className="text-muted-foreground text-xs">—</span>
                    ) : (
                      r.ops
                        .sort((a, b) => a.priority - b.priority)
                        .map((o) => (
                          <Badge key={o.operation_id} variant="secondary">
                            {o.priority}. {o.operation_name}
                          </Badge>
                        ))
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditing(r);
                      setOpId("");
                      setPriority((r.ops.length || 0) + 1);
                    }}
                  >
                    Operações
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Operações de {editing?.display_name}</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-4">
            <div className="flex flex-col gap-2">
              {editing?.ops
                .sort((a, b) => a.priority - b.priority)
                .map((o) => (
                  <div key={o.operation_id} className="flex items-center gap-2 text-sm">
                    <Badge variant="secondary">{o.priority}</Badge>
                    <span className="flex-1">{o.operation_name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remover"
                      onClick={() =>
                        startTransition(async () => {
                          await removeResponsibleOperation(editing.id, o.operation_id);
                          setEditing(null);
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
            </div>

            <div className="flex items-end gap-2 border-t pt-4">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label>Operação</Label>
                <Combobox
                  options={[
                    { value: "", label: "— selecionar —" },
                    ...operations.map((o) => ({ value: o.id, label: o.label })),
                  ]}
                  value={opId}
                  onValueChange={setOpId}
                  placeholder="— selecionar —"
                  className="w-full"
                  aria-label="Operação"
                />
              </div>
              <div className="flex w-20 flex-col gap-1.5">
                <Label>Prioridade</Label>
                <Input
                  type="number"
                  min={1}
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value) || 1)}
                />
              </div>
              <Button
                onClick={() => {
                  if (!editing || !opId) return;
                  startTransition(async () => {
                    await addResponsibleOperation(editing.id, opId, priority);
                    setEditing(null);
                  });
                }}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
      </div>
    </div>
  );
}
