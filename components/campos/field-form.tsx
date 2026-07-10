// Versão: 1.1 | Data: 09/07/2026
// Formulário de criação/edição de um campo personalizado (field_definition).
// v1.1 (09/07/2026): Fase 7 — tipo "Calculado" abre o construtor de fórmula e o
//   toggle "Exibir nos seletores" (show_in_builder).
"use client";

import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ROLE_LABELS, type RoleKey } from "@/lib/auth/roles";
import {
  DATA_TYPE_LABELS,
  type DataType,
  type FieldDefinition,
} from "@/lib/records/types";
import {
  createField,
  updateField,
  type FieldActionState,
} from "@/app/(app)/campos/actions";
import { FormulaBuilder, type RefOption } from "./formula-builder";

const ROLE_KEYS = Object.keys(ROLE_LABELS) as RoleKey[];
const DATA_TYPE_OPTIONS: ComboboxOption[] = (
  Object.keys(DATA_TYPE_LABELS) as DataType[]
).map((t) => ({ value: t, label: DATA_TYPE_LABELS[t] }));
const initial: FieldActionState = {};

function RoleChecks({
  name,
  selected,
}: {
  name: string;
  selected: string[];
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {ROLE_KEYS.map((role) => (
        <label key={role} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name={name}
            value={role}
            defaultChecked={selected.includes(role)}
            className="size-4 accent-primary"
          />
          {ROLE_LABELS[role]}
        </label>
      ))}
    </div>
  );
}

export function FieldForm({
  field,
  numericRefs,
  onDone,
}: {
  field?: FieldDefinition;
  numericRefs: RefOption[];
  onDone?: () => void;
}) {
  const isEdit = Boolean(field);
  const action = isEdit ? updateField : createField;
  const [state, formAction, pending] = useActionState(action, initial);
  const [dataType, setDataType] = useState<DataType>(
    field?.data_type ?? "texto"
  );

  // Ao editar um campo calculado, ele não pode ser operando de si mesmo.
  const operandRefs = numericRefs.filter(
    (r) => r.ref !== `custom:${field?.field_key}`
  );

  useEffect(() => {
    if (state.ok && onDone) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {isEdit ? <input type="hidden" name="id" value={field!.id} /> : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="label">Rótulo</Label>
        <Input
          id="label"
          name="label"
          defaultValue={field?.label ?? ""}
          placeholder="Ex.: Forecast, Temperatura, Observações"
          required
        />
        {isEdit ? (
          <p className="text-muted-foreground text-xs">
            Chave: <code>{field!.field_key}</code> (não muda após criado)
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Tipo</Label>
        <Combobox
          name="data_type"
          options={DATA_TYPE_OPTIONS}
          value={dataType}
          onValueChange={(v) => setDataType(v as DataType)}
          searchable={false}
          className="w-full"
          aria-label="Tipo"
        />
      </div>

      {dataType === "selecao" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="options">Opções (uma por linha)</Label>
          <Textarea
            id="options"
            name="options"
            defaultValue={(field?.options ?? []).join("\n")}
            placeholder={"Quente\nMorno\nFrio"}
            rows={4}
          />
        </div>
      ) : null}

      {dataType === "calculado" ? (
        <div className="flex flex-col gap-1.5">
          <Label>Fórmula</Label>
          <FormulaBuilder refs={operandRefs} initial={field?.formula ?? null} />
          <p className="text-muted-foreground text-xs">
            Opere entre colunas numéricas (+ − × ÷) e constantes. O resultado é
            calculado por registro a cada sincronização/edição.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label>Visível para os papéis</Label>
        <RoleChecks name="visible_to_roles" selected={field?.visible_to_roles ?? []} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Editável pelos papéis</Label>
        <RoleChecks name="editable_by_roles" selected={field?.editable_by_roles ?? []} />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="show_in_builder"
          defaultChecked={field?.show_in_builder ?? true}
          className="size-4 accent-primary"
        />
        Exibir nos seletores (dropdowns do construtor e colunas de Registros)
      </label>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="is_local"
            defaultChecked={field?.is_local ?? false}
            className="size-4 accent-primary"
          />
          Campo só do app (nunca vem de sync)
        </label>
        <div className="flex items-center gap-2">
          <Label htmlFor="sort_order" className="text-sm">
            Ordem
          </Label>
          <Input
            id="sort_order"
            name="sort_order"
            type="number"
            defaultValue={field?.sort_order ?? 0}
            className="w-20"
          />
        </div>
      </div>

      {state.message ? (
        <p
          className={state.ok ? "text-muted-foreground text-sm" : "text-destructive text-sm"}
          role="status"
        >
          {state.message}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Salvando..." : isEdit ? "Salvar alterações" : "Criar campo"}
      </Button>
    </form>
  );
}
