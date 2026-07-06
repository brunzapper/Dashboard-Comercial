// Versão: 1.0 | Data: 05/07/2026
// Formulário de criação/edição de um campo personalizado (field_definition).
"use client";

import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

const ROLE_KEYS = Object.keys(ROLE_LABELS) as RoleKey[];
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
  onDone,
}: {
  field?: FieldDefinition;
  onDone?: () => void;
}) {
  const isEdit = Boolean(field);
  const action = isEdit ? updateField : createField;
  const [state, formAction, pending] = useActionState(action, initial);
  const [dataType, setDataType] = useState<DataType>(
    field?.data_type ?? "texto"
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
        {/* Select controla a UI; input hidden envia o valor no form */}
        <Select value={dataType} onValueChange={(v) => setDataType(v as DataType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(DATA_TYPE_LABELS) as DataType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {DATA_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input type="hidden" name="data_type" value={dataType} />
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

      <div className="flex flex-col gap-1.5">
        <Label>Visível para os papéis</Label>
        <RoleChecks name="visible_to_roles" selected={field?.visible_to_roles ?? []} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Editável pelos papéis</Label>
        <RoleChecks name="editable_by_roles" selected={field?.editable_by_roles ?? []} />
      </div>

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
