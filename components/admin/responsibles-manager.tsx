// Versão: 1.3 | Data: 01/08/2026
// Gerência de Responsáveis (admin): criar, ativar/desativar e mapear operações
// com prioridade. Responsáveis vêm do sync OU são criados aqui (só no sistema,
// sem Bitrix). O admin cura a lista.
// v1.2 (26/07/2026): coluna "Nome usado" (agrupamento de exibição, 0101) —
// unifica um responsável duplicado sob o principal escolhido; reversível
// ("— próprio nome —"); badge "N unificados" no principal.
// v1.3 (01/08/2026): apelidos ficam RECOLHIDOS sob o principal (o badge vira
// expansor); alvo do "Nome usado" só oferece principais (a action já achata
// para a raiz — evita entradas homônimas duplicadas no dropdown).
"use client";

import { Fragment, useActionState, useState, useTransition } from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";

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
  // Agrupamento (0101): apelidos ficam RECOLHIDOS sob o principal (expansor no
  // badge). Apelido órfão (principal fora da lista — defensivo) segue como
  // linha de topo.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const idsPresent = new Set(responsibles.map((r) => r.id));
  const topLevel = responsibles.filter(
    (r) => !r.canonical_id || !idsPresent.has(r.canonical_id)
  );
  const aliasesByCanonical = new Map<string, ResponsibleRow[]>();
  for (const r of responsibles) {
    if (r.canonical_id && idsPresent.has(r.canonical_id)) {
      const arr = aliasesByCanonical.get(r.canonical_id) ?? [];
      arr.push(r);
      aliasesByCanonical.set(r.canonical_id, arr);
    }
  }
  // Alvos do "Nome usado": só principais — a action achata para a raiz de
  // qualquer forma, e oferecer apelidos duplicaria entradas homônimas.
  const canonicalRows = responsibles.filter((r) => !r.canonical_id);
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderRow = (r: ResponsibleRow, alias: boolean) => {
    const aliases = aliasesByCanonical.get(r.id) ?? [];
    const open = expanded.has(r.id);
    return (
      <TableRow key={r.id} className={alias ? "bg-muted/30" : undefined}>
        <TableCell className="font-medium">
          <span
            className={cn(
              "inline-flex items-center gap-1.5",
              alias && "text-muted-foreground pl-4 font-normal"
            )}
          >
            {alias ? <span aria-hidden="true">↳</span> : null}
            <span>{r.display_name}</span>
            {aliases.length > 0 ? (
              <button
                type="button"
                aria-expanded={open}
                aria-label={`${open ? "Recolher" : "Mostrar"} unificados de ${r.display_name}`}
                onClick={() => toggleExpanded(r.id)}
              >
                <Badge variant="outline" className="cursor-pointer gap-1">
                  <ChevronRight
                    className={cn(
                      "size-3 transition-transform",
                      open && "rotate-90"
                    )}
                  />
                  {aliases.length} unificado{aliases.length > 1 ? "s" : ""}
                </Badge>
              </button>
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
              ...canonicalRows
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
    );
  };

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
            topLevel.map((r) => (
              <Fragment key={r.id}>
                {renderRow(r, false)}
                {expanded.has(r.id)
                  ? (aliasesByCanonical.get(r.id) ?? []).map((a) =>
                      renderRow(a, true)
                    )
                  : null}
              </Fragment>
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
