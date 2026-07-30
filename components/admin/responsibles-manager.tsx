// Versão: 1.2 | Data: 26/07/2026
// Gerência de Responsáveis (admin): criar, ativar/desativar e mapear operações
// com prioridade. Responsáveis vêm do sync OU são criados aqui (só no sistema,
// sem Bitrix). O admin cura a lista.
// v1.2 (26/07/2026): coluna "Nome usado" (agrupamento de exibição, 0101) —
// unifica um responsável duplicado sob o principal escolhido; reversível
// ("— próprio nome —"); badge "N unificados" no principal.
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
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ResizableSheetContent } from "@/components/ui/resizable-sheet-content";
import { notifyOnError } from "@/lib/feedback/notify";
import type { OptionItem } from "@/lib/records/types";
import {
  addResponsibleOperation,
  createResponsible,
  removeResponsibleOperation,
  setResponsibleActive,
  setResponsibleCanonical,
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
  // Agrupamento de exibição (0101): id do principal quando esta linha é apelido.
  canonical_id: string | null;
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
  // Quantos apelidos apontam para cada principal (badge "N unificados").
  const aliasCountById = new Map<string, number>();
  for (const r of responsibles) {
    if (r.canonical_id) {
      aliasCountById.set(
        r.canonical_id,
        (aliasCountById.get(r.canonical_id) ?? 0) + 1
      );
    }
  }

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
            <TableHead>Nome usado</TableHead>
            <TableHead>Operações</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {responsibles.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground text-center">
                Nenhum responsável ainda (são criados pelo sync do Bitrix/planilha ou aqui em cima).
              </TableCell>
            </TableRow>
          ) : (
            responsibles.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {r.display_name}
                    {aliasCountById.get(r.id) ? (
                      <Badge variant="outline">
                        {aliasCountById.get(r.id)} unificado
                        {aliasCountById.get(r.id)! > 1 ? "s" : ""}
                      </Badge>
                    ) : null}
                  </span>
                </TableCell>
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
                        await notifyOnError(
                          setResponsibleActive(r.id, e.target.checked),
                          "Não foi possível alterar o responsável"
                        );
                      })
                    }
                  />
                </TableCell>
                <TableCell>
                  {/* Unificar com…: esta linha vira apelido do escolhido (some
                      dos dropdowns; widgets/filtros tratam o grupo como um).
                      "— próprio nome —" desfaz. */}
                  <Combobox
                    options={[
                      { value: "", label: "— próprio nome —" },
                      ...responsibles
                        .filter((o) => o.id !== r.id)
                        .map((o) => ({ value: o.id, label: o.display_name })),
                    ]}
                    value={r.canonical_id ?? ""}
                    onValueChange={(v) =>
                      startTransition(async () => {
                        await notifyOnError(
                          setResponsibleCanonical(r.id, v || null),
                          "Não foi possível unificar o responsável"
                        );
                      })
                    }
                    placeholder="— próprio nome —"
                    className="w-44"
                    aria-label={`Nome usado para ${r.display_name}`}
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
        <ResizableSheetContent
          storageKey="panel-w:responsible-ops"
          defaultWidth={448}
        >
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
                          await notifyOnError(
                            removeResponsibleOperation(editing.id, o.operation_id),
                            "Não foi possível remover a operação"
                          );
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
                    await notifyOnError(
                      addResponsibleOperation(editing.id, opId, priority),
                      "Não foi possível vincular a operação"
                    );
                    setEditing(null);
                  });
                }}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>
        </ResizableSheetContent>
      </Sheet>
      </div>
    </div>
  );
}
