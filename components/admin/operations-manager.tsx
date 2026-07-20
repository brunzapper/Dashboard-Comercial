// Versão: 2.0 | Data: 20/07/2026
// Gerência de Operações (admin): criar (com pai), RENOMEAR inline, trocar pai,
// ativar/desativar, excluir e editar o FILTRO DE PERFIL (operations.filter,
// 0083 — condições field/op/value com fonte-alvo opcional, no modelo do editor
// de sub-fontes). O filtro de Operação dos dashboards aplica responsáveis
// vinculados + este perfil (lib/config/operation-scope.ts).
// v2.0 (20/07/2026): rename inline + editor de perfil (antes: nome fixo).
"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import { Filter, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { WidgetFilter } from "@/lib/widgets/types";
import {
  createOperation,
  deleteOperation,
  updateOperation,
  updateOperationFilter,
  type OpState,
} from "@/app/(app)/configuracoes/operacoes/actions";

export interface OperationRow {
  id: string;
  name: string;
  active: boolean;
  parent_operation_id: string | null;
  filter: WidgetFilter[];
}

const initial: OpState = {};

// Operadores do editor de perfil. "não está em" é um pseudo-op de EDIÇÃO:
// serializa como um `neq_ci` POR VALOR (lista de exclusão; null segue
// contando) — ao reabrir, cada valor aparece como uma condição "diferente de".
const OP_OPTIONS: ComboboxOption[] = [
  { value: "eq", label: "igual a" },
  { value: "neq_ci", label: "diferente de (nulo conta)" },
  { value: "in", label: "está em (lista, vírgulas)" },
  { value: "not_in", label: "NÃO está em (lista, vírgulas)" },
  { value: "ilike", label: "contém" },
  { value: "gt", label: "maior que" },
  { value: "gte", label: "maior ou igual a" },
  { value: "lt", label: "menor que" },
  { value: "lte", label: "menor ou igual a" },
  { value: "is_null", label: "vazio" },
  { value: "not_null", label: "não vazio" },
];
const NO_VALUE_OPS = new Set(["is_null", "not_null"]);

interface Cond {
  field: string;
  op: string;
  value: string;
  source: string; // fonte-alvo opcional ("" = todas)
}

function toConds(filter: WidgetFilter[]): Cond[] {
  return filter.map((f) => ({
    field: f.field,
    op: f.op,
    value:
      f.value == null
        ? ""
        : Array.isArray(f.value)
          ? f.value.join(", ")
          : String(f.value),
    source: (f.sources?.[0] as string) ?? "",
  }));
}

// Serializa condições → WidgetFilter[]. `in`/`not_in` dividem por vírgula;
// `not_in` expande num `neq_ci` por valor.
function toFilter(conds: Cond[]): WidgetFilter[] {
  const out: WidgetFilter[] = [];
  for (const c of conds) {
    if (!c.field || !c.op) continue;
    const sources = c.source
      ? ({ sources: [c.source] } as Pick<WidgetFilter, "sources">)
      : {};
    if (NO_VALUE_OPS.has(c.op)) {
      out.push({ field: c.field, op: c.op as WidgetFilter["op"], ...sources });
      continue;
    }
    const lista = c.value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (c.op === "not_in") {
      for (const v of lista) {
        out.push({ field: c.field, op: "neq_ci", value: v, ...sources });
      }
      continue;
    }
    if (c.op === "in") {
      if (lista.length > 0) {
        out.push({ field: c.field, op: "in", value: lista, ...sources });
      }
      continue;
    }
    out.push({
      field: c.field,
      op: c.op as WidgetFilter["op"],
      value: c.value,
      ...sources,
    });
  }
  return out;
}

function ProfileEditor({
  operation,
  fieldOptions,
  sourceOptions,
  onDone,
}: {
  operation: OperationRow;
  fieldOptions: ComboboxOption[];
  sourceOptions: ComboboxOption[];
  onDone: () => void;
}) {
  const [conds, setConds] = useState<Cond[]>(
    operation.filter.length > 0
      ? toConds(operation.filter)
      : [{ field: "", op: "eq", value: "", source: "" }]
  );
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [pending, startTransition] = useTransition();

  const patch = (i: number, p: Partial<Cond>) =>
    setConds((cs) => cs.map((c, j) => (j === i ? { ...c, ...p } : c)));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-xs">
        As condições valem em conjunto (E). Use a fonte-alvo quando o campo só
        existe numa fonte — sem isso, a condição zeraria as demais fontes dos
        widgets. Os responsáveis vinculados à operação continuam valendo junto
        do perfil.
      </p>
      {conds.map((c, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="flex min-w-44 flex-col gap-1">
            <Label className="text-xs">Campo</Label>
            <Combobox
              options={fieldOptions}
              value={c.field}
              onValueChange={(v) => patch(i, { field: v })}
              placeholder="Campo"
              aria-label="Campo"
            />
          </div>
          <div className="flex min-w-40 flex-col gap-1">
            <Label className="text-xs">Condição</Label>
            <Combobox
              options={OP_OPTIONS}
              value={c.op}
              onValueChange={(v) => patch(i, { op: v })}
              searchable={false}
              aria-label="Condição"
            />
          </div>
          {!NO_VALUE_OPS.has(c.op) ? (
            <div className="flex min-w-44 flex-1 flex-col gap-1">
              <Label className="text-xs">Valor</Label>
              <Input
                value={c.value}
                onChange={(e) => patch(i, { value: e.target.value })}
                placeholder={
                  c.op === "in" || c.op === "not_in"
                    ? "valor1, valor2, ..."
                    : "valor"
                }
              />
            </div>
          ) : null}
          <div className="flex min-w-40 flex-col gap-1">
            <Label className="text-xs">Fonte-alvo (opcional)</Label>
            <Combobox
              options={[{ value: "", label: "— todas —" }, ...sourceOptions]}
              value={c.source}
              onValueChange={(v) => patch(i, { source: v })}
              placeholder="— todas —"
              aria-label="Fonte-alvo"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remover condição"
            onClick={() => setConds((cs) => cs.filter((_, j) => j !== i))}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setConds((cs) => [...cs, { field: "", op: "eq", value: "", source: "" }])
          }
        >
          <Plus className="size-4" /> Condição
        </Button>
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await updateOperationFilter(
                operation.id,
                toFilter(conds)
              );
              setMessage(
                res.message ? { ok: Boolean(res.ok), text: res.message } : null
              );
              if (res.ok) onDone();
            })
          }
        >
          Salvar perfil
        </Button>
        {message && !message.ok ? (
          <span className="text-destructive text-sm">{message.text}</span>
        ) : null}
      </div>
    </div>
  );
}

export function OperationsManager({
  operations,
  fieldOptions,
  sourceOptions,
}: {
  operations: OperationRow[];
  fieldOptions: ComboboxOption[];
  sourceOptions: ComboboxOption[];
}) {
  const [state, formAction, pending] = useActionState(createOperation, initial);
  const [parentId, setParentId] = useState("");
  const [editing, setEditing] = useState<OperationRow | null>(null);
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
              <TableHead>Perfil</TableHead>
              <TableHead>Ativa</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {operations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center">
                  Nenhuma operação.
                </TableCell>
              </TableRow>
            ) : (
              operations.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">
                    <Input
                      defaultValue={o.name}
                      aria-label={`Nome de ${o.name}`}
                      className="h-8 max-w-56"
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next && next !== o.name)
                          startTransition(async () => {
                            await updateOperation(o.id, { name: next });
                          });
                      }}
                    />
                  </TableCell>
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
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(o)}
                    >
                      <Filter className="size-4" />
                      {o.filter.length > 0
                        ? `${o.filter.length} condição(ões)`
                        : "Definir"}
                    </Button>
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

      <Sheet open={editing != null} onOpenChange={(v) => !v && setEditing(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Perfil de dados — {editing?.name}</SheetTitle>
            <SheetDescription>
              Filtros que definem o recorte de dados desta operação, aplicados
              junto com os responsáveis vinculados quando o dashboard filtra
              por ela.
            </SheetDescription>
          </SheetHeader>
          <div className="p-4">
            {editing ? (
              <ProfileEditor
                key={editing.id}
                operation={editing}
                fieldOptions={fieldOptions}
                sourceOptions={sourceOptions}
                onDone={() => setEditing(null)}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
