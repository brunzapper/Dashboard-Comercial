// Versão: 1.0 | Data: 19/07/2026
// SUB-FONTES (0078): CRUD das sub-fontes (fonte derivada de uma pai, recortada
// por um filtro). Tabela + Sheet com formulário: pai (imutável na edição), nome,
// nome curto, campo de período e um editor de CONDIÇÕES (field/op/value) que
// serializa o predicado como JSON (WidgetFilter[]) num input escondido. Os
// campos do filtro dependem da PAI escolhida (fieldOptionsByParent, montado no
// servidor a partir de applies_to). Escrita = manage_field_definitions (admin).
"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

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
import { sourceLabel, type SourceDef } from "@/lib/sources";
import type { WidgetFilter } from "@/lib/widgets/types";
import {
  createSubSource,
  deleteSubSource,
  updateSubSource,
  type SourceActionState,
} from "@/app/(app)/configuracoes/fontes/actions";

const initial: SourceActionState = {};

const PERIOD_FIELD_OPTIONS: ComboboxOption[] = [
  { value: "source_created_at", label: "Data de criação (origem)" },
  { value: "closed_at", label: "Data de fechamento" },
  { value: "opened_at", label: "Data de abertura" },
  { value: "source_modified_at", label: "Data de modificação (origem)" },
  { value: "created_at", label: "Criado no app" },
  { value: "updated_at", label: "Atualizado no app" },
];

// Operadores do editor (espelham SUB_FILTER_OPS na action).
const OP_OPTIONS: ComboboxOption[] = [
  { value: "eq", label: "igual a" },
  { value: "neq", label: "diferente de" },
  { value: "in", label: "está em (lista, vírgulas)" },
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
}

function toConds(filter: WidgetFilter[] | undefined): Cond[] {
  return (filter ?? []).map((f) => ({
    field: f.field,
    op: f.op,
    value:
      f.value == null
        ? ""
        : Array.isArray(f.value)
          ? f.value.join(", ")
          : String(f.value),
  }));
}

// Serializa condições → WidgetFilter[]. `in` divide por vírgula; ops sem valor
// não carregam value.
function toFilter(conds: Cond[]): WidgetFilter[] {
  return conds
    .filter((c) => c.field && c.op)
    .map((c) => {
      if (NO_VALUE_OPS.has(c.op)) {
        return { field: c.field, op: c.op as WidgetFilter["op"] };
      }
      const value =
        c.op === "in"
          ? c.value.split(",").map((v) => v.trim()).filter(Boolean)
          : c.value;
      return { field: c.field, op: c.op as WidgetFilter["op"], value };
    });
}

function SubSourceForm({
  sub,
  roots,
  fieldOptionsByParent,
  onDone,
}: {
  sub?: SourceDef;
  roots: SourceDef[];
  fieldOptionsByParent: Record<string, ComboboxOption[]>;
  onDone?: () => void;
}) {
  const isEdit = Boolean(sub);
  const action = isEdit ? updateSubSource : createSubSource;
  const [state, formAction, pending] = useActionState(action, initial);
  const [parentKey, setParentKey] = useState(
    sub?.parentKey ?? roots[0]?.key ?? ""
  );
  const [periodField, setPeriodField] = useState(
    sub?.defaultPeriodField ?? "source_created_at"
  );
  const [conds, setConds] = useState<Cond[]>(
    sub?.filter && sub.filter.length > 0
      ? toConds(sub.filter)
      : [{ field: "", op: "eq", value: "" }]
  );

  useEffect(() => {
    if (state.ok && onDone) onDone();
  }, [state.ok, onDone]);

  const fieldOptions = fieldOptionsByParent[parentKey] ?? [];
  const filterJson = useMemo(() => JSON.stringify(toFilter(conds)), [conds]);

  const setCond = (i: number, patch: Partial<Cond>) =>
    setConds((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const addCond = () =>
    setConds((prev) => [...prev, { field: "", op: "eq", value: "" }]);
  const removeCond = (i: number) =>
    setConds((prev) => prev.filter((_, j) => j !== i));

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {isEdit ? <input type="hidden" name="key" value={sub!.key} /> : null}
      <input type="hidden" name="parent_key" value={parentKey} />
      <input type="hidden" name="default_period_field" value={periodField} />
      <input type="hidden" name="filter" value={filterJson} />

      <div className="flex flex-col gap-1.5">
        <Label>Fonte pai</Label>
        <Combobox
          options={roots.map((r) => ({ value: r.key, label: r.label }))}
          value={parentKey}
          onValueChange={setParentKey}
          searchable={false}
          disabled={isEdit}
          aria-label="Fonte pai"
        />
        <p className="text-muted-foreground text-xs">
          As linhas da sub-fonte são as da pai que satisfazem o filtro abaixo. A
          pai não muda depois de criada.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sub-label">Nome da sub-fonte</Label>
        <Input
          id="sub-label"
          name="label"
          defaultValue={sub?.label ?? ""}
          placeholder="Ex.: Leads / Clientes Lite"
          maxLength={60}
          required
        />
        {isEdit ? (
          <p className="text-muted-foreground text-xs">
            Chave: <code>{sub!.key}</code>
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sub-short-label">Nome curto</Label>
        <Input
          id="sub-short-label"
          name="short_label"
          defaultValue={sub?.shortLabel ?? ""}
          placeholder="Ex.: Clientes Lite"
          maxLength={40}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Campo de data do filtro de período</Label>
        <Combobox
          options={PERIOD_FIELD_OPTIONS}
          value={periodField}
          onValueChange={setPeriodField}
          searchable={false}
          aria-label="Campo de data do filtro de período"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Filtro (todas as condições, em E)</Label>
        {conds.map((c, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <div className="flex-1">
              <Combobox
                options={fieldOptions}
                value={c.field}
                onValueChange={(v) => setCond(i, { field: v })}
                placeholder="Campo"
                aria-label="Campo"
              />
            </div>
            <div className="w-40">
              <Combobox
                options={OP_OPTIONS}
                value={c.op}
                onValueChange={(v) => setCond(i, { op: v })}
                searchable={false}
                aria-label="Operador"
              />
            </div>
            {!NO_VALUE_OPS.has(c.op) ? (
              <Input
                value={c.value}
                onChange={(e) => setCond(i, { value: e.target.value })}
                placeholder="Valor"
                className="flex-1"
                aria-label="Valor"
              />
            ) : (
              <div className="flex-1" />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeCond(i)}
              aria-label="Remover condição"
              disabled={conds.length <= 1}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addCond}>
          <Plus className="size-4" />
          Adicionar condição
        </Button>
      </div>

      {state.message ? (
        <p
          className={
            state.ok ? "text-muted-foreground text-sm" : "text-destructive text-sm"
          }
          role="status"
        >
          {state.message}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Salvando..." : isEdit ? "Salvar alterações" : "Criar sub-fonte"}
      </Button>
    </form>
  );
}

function DeleteSubButton({ subKey }: { subKey: string }) {
  const [state, formAction, pending] = useActionState(deleteSubSource, initial);
  return (
    <form action={formAction} className="flex items-center gap-1">
      <input type="hidden" name="key" value={subKey} />
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        disabled={pending}
        aria-label="Excluir sub-fonte"
      >
        <Trash2 className="size-4" />
      </Button>
      {state.message && !state.ok ? (
        <span className="text-destructive text-xs" role="status">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

export function SubSourcesManager({
  sources,
  fieldOptionsByParent,
}: {
  sources: SourceDef[];
  fieldOptionsByParent: Record<string, ComboboxOption[]>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SourceDef | undefined>(undefined);
  const roots = sources.filter((s) => !s.parentKey);
  const subs = sources.filter((s) => s.parentKey);

  function openCreate() {
    setEditing(undefined);
    setOpen(true);
  }
  function openEdit(s: SourceDef) {
    setEditing(s);
    setOpen(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Sub-fontes</h2>
          <p className="text-muted-foreground text-sm">
            Uma sub-fonte é a fonte pai recortada por um filtro (ex.: Leads só da
            etapa &quot;Clientes Lite&quot;), com campo de data próprio. Aparece
            como fonte no construtor de widgets e nos campos unificados. Quando a
            pai também está no widget, a sub é absorvida (sem duplicar) — salvo se
            você marcar &quot;conviver&quot; no widget.
          </p>
        </div>
        <Button onClick={openCreate} disabled={roots.length === 0}>
          <Plus className="size-4" />
          Nova sub-fonte
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Chave</TableHead>
              <TableHead>Pai</TableHead>
              <TableHead>Condições</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center">
                  Nenhuma sub-fonte ainda.
                </TableCell>
              </TableRow>
            ) : (
              subs.map((s) => (
                <TableRow key={s.key}>
                  <TableCell className="font-medium">{s.label}</TableCell>
                  <TableCell>
                    <code className="text-xs">{s.key}</code>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {sourceLabel(s.parentKey ?? "", sources)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {(s.filter ?? []).length}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(s)}
                        aria-label="Editar sub-fonte"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <DeleteSubButton subKey={s.key} />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {editing ? "Editar sub-fonte" : "Nova sub-fonte"}
            </SheetTitle>
            <SheetDescription>
              As linhas são as da fonte pai que satisfazem o filtro.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <SubSourceForm
              key={editing?.key ?? "new"}
              sub={editing}
              roots={roots}
              fieldOptionsByParent={fieldOptionsByParent}
              onDone={() => setOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
