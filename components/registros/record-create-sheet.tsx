// Versão: 1.1 | Data: 16/07/2026
// Painel lateral de CRIAÇÃO manual de registro (fontes com manual_entry, 0061).
// Espelha record-edit-sheet: núcleo (nome obrigatório + colunas editáveis) +
// responsável/operação + campos personalizados editáveis pelo papel. O server
// (createRecord) revalida permissão, fonte e força o vendedor ao próprio
// responsável. `defaultValues` pré-preenche campos (quick-create do kanban:
// valor da coluna); `onCreated` avisa o chamador (client) com o id criado.
// v1.1 (16/07/2026): fontes Bitrix (lead/negocio) ganham o checkbox "Criar
//   também no Bitrix" (crm.lead.add/crm.deal.add via createRecord, 0065).
"use client";

import { useActionState, useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { FieldDefinition, OptionItem } from "@/lib/records/types";
import { createRecord, type CreateRecordState } from "@/lib/records/actions";
import { CURRENCY_OPTIONS } from "@/lib/widgets/currency";

const initial: CreateRecordState = {};

function NewCustomFieldInput({
  field,
  defaultValue,
}: {
  field: FieldDefinition;
  defaultValue: string;
}) {
  const name = `custom__${field.field_key}`;
  const [selValue, setSelValue] = useState(defaultValue);

  if (field.data_type === "selecao") {
    return (
      <Combobox
        name={name}
        options={[
          { value: "", label: "—" },
          ...field.options.map((opt) => ({ value: opt, label: opt })),
        ]}
        value={selValue}
        onValueChange={setSelValue}
        placeholder="—"
        className="w-full"
        aria-label={field.label}
      />
    );
  }
  if (field.data_type === "data") {
    return (
      <Input type="date" name={name} defaultValue={defaultValue.slice(0, 10)} />
    );
  }
  if (field.data_type === "numero" || field.data_type === "moeda") {
    return (
      <Input
        type="number"
        step={field.data_type === "moeda" ? "0.01" : "any"}
        name={name}
        defaultValue={defaultValue}
      />
    );
  }
  if (field.data_type === "booleano") {
    return (
      <Combobox
        name={name}
        options={[
          { value: "", label: "—" },
          { value: "true", label: "Sim" },
          { value: "false", label: "Não" },
        ]}
        value={selValue}
        onValueChange={setSelValue}
        searchable={false}
        placeholder="—"
        className="w-full"
        aria-label={field.label}
      />
    );
  }
  return <Input name={name} defaultValue={defaultValue} />;
}

export function RecordCreateSheet({
  source,
  recordType,
  fields,
  responsibles,
  operations,
  userRoles,
  defaultValues,
  onCreated,
  triggerLabel = "Novo registro",
  triggerVariant = "default",
  iconTrigger = false,
}: {
  // Fonte destino (key + label; o server revalida manual_entry).
  source: { key: string; label: string };
  // record_type da fonte: habilita "Criar também no Bitrix" nas fontes Bitrix
  // (lead/negocio). Ausente/outras fontes = sem a opção.
  recordType?: string;
  // Definições já filtradas pela fonte/visibilidade (o chamador — página ou
  // kanban — decide o recorte); aqui filtramos só as editáveis pelo papel.
  fields: FieldDefinition[];
  responsibles: OptionItem[];
  operations: OptionItem[];
  userRoles: string[];
  // Pré-preenchimento ('core__stage', 'custom__<key>', 'responsible_id'...).
  defaultValues?: Record<string, string>;
  onCreated?: (id: string) => void;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "ghost";
  // Gatilho compacto (só o ícone +) — usado nos cabeçalhos de coluna do kanban.
  iconTrigger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createRecord, initial);
  const dv = (key: string): string => defaultValues?.[key] ?? "";
  const [responsibleId, setResponsibleId] = useState(dv("responsible_id"));
  const [operationId, setOperationId] = useState(dv("operation_id"));
  const [currencyCode, setCurrencyCode] = useState(dv("core__currency"));
  const [createInBitrix, setCreateInBitrix] = useState(false);

  const isBitrixEntity = recordType === "lead" || recordType === "negocio";

  useEffect(() => {
    // Fecha o painel quando a Server Action conclui com sucesso.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (state.ok) setOpen(false);
    if (state.ok && state.id && onCreated) onCreated(state.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.id]);

  // Campos calculados são derivados — nunca criados à mão.
  const editableFields = fields.filter(
    (f) =>
      f.data_type !== "calculado" &&
      f.data_type !== "calculado_agg" &&
      f.editable_by_roles.some((r) => userRoles.includes(r))
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {iconTrigger ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={triggerLabel}
          onClick={() => setOpen(true)}
        >
          <Plus className="size-4" />
        </Button>
      ) : (
        <Button variant={triggerVariant} onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          {triggerLabel}
        </Button>
      )}
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Novo registro</SheetTitle>
          <SheetDescription>
            Criação manual em {source.label}.
          </SheetDescription>
        </SheetHeader>

        <form action={formAction} className="flex flex-col gap-5 px-4 pb-6">
          <input type="hidden" name="source" value={source.key} />
          {isBitrixEntity ? (
            <input
              type="hidden"
              name="create_in_bitrix"
              value={createInBitrix ? "1" : "0"}
            />
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-title">Nome *</Label>
            <Input
              id="create-title"
              name="core__title"
              defaultValue={dv("core__title")}
              placeholder="Ex.: Proposta ACME"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
            <div className="flex flex-col gap-1.5">
              <Label>Etapa</Label>
              <Input
                name="core__stage"
                defaultValue={dv("core__stage")}
                disabled={createInBitrix}
                placeholder={createInBitrix ? "definida pelo Bitrix" : ""}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Canal</Label>
              <Input name="core__channel" defaultValue={dv("core__channel")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Valor</Label>
              <Input
                type="number"
                step="0.01"
                name="core__value"
                defaultValue={dv("core__value")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>MRR</Label>
              <Input
                type="number"
                step="0.01"
                name="core__mrr"
                defaultValue={dv("core__mrr")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Moeda</Label>
              <Combobox
                name="core__currency"
                options={[{ value: "", label: "—" }, ...CURRENCY_OPTIONS]}
                value={currencyCode}
                onValueChange={setCurrencyCode}
                placeholder="—"
                className="w-full"
                aria-label="Moeda"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Tipo de venda</Label>
              <Input name="core__sale_type" defaultValue={dv("core__sale_type")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Abertura</Label>
              <Input
                type="date"
                name="core__opened_at"
                defaultValue={dv("core__opened_at")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Fechamento</Label>
              <Input
                type="date"
                name="core__closed_at"
                defaultValue={dv("core__closed_at")}
              />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Responsável</Label>
              <Combobox
                name="responsible_id"
                options={[
                  { value: "", label: "— nenhum —" },
                  ...responsibles.map((r) => ({ value: r.id, label: r.label })),
                ]}
                value={responsibleId}
                onValueChange={setResponsibleId}
                placeholder="— nenhum —"
                className="w-full"
                aria-label="Responsável"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Operação</Label>
              <Combobox
                name="operation_id"
                options={[
                  { value: "", label: "— automática (do responsável) —" },
                  ...operations.map((o) => ({ value: o.id, label: o.label })),
                ]}
                value={operationId}
                onValueChange={setOperationId}
                placeholder="— automática (do responsável) —"
                className="w-full"
                aria-label="Operação"
              />
            </div>
          </div>

          {editableFields.length > 0 ? (
            <div className="flex flex-col gap-4 border-t pt-4">
              {editableFields.map((f) => (
                <div key={f.id} className="flex flex-col gap-1.5">
                  <Label>{f.label}</Label>
                  <NewCustomFieldInput
                    field={f}
                    defaultValue={dv(`custom__${f.field_key}`)}
                  />
                </div>
              ))}
            </div>
          ) : null}

          {isBitrixEntity ? (
            <label className="flex items-start gap-2 border-t pt-4 text-sm">
              <Checkbox
                checked={createInBitrix}
                onCheckedChange={(v) => setCreateInBitrix(v === true)}
                className="mt-0.5"
              />
              <span>
                Criar também no Bitrix
                <span className="text-muted-foreground block text-xs">
                  Gera o {recordType === "negocio" ? "negócio" : "lead"} no
                  Bitrix e vincula este registro (a etapa inicial fica a cargo do
                  Bitrix).
                </span>
              </span>
            </label>
          ) : null}

          {state.message && !state.ok ? (
            <p className="text-destructive text-sm" role="status">
              {state.message}
            </p>
          ) : null}

          <Button type="submit" disabled={pending}>
            {pending ? "Criando..." : "Criar registro"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
