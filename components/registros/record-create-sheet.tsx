// Versão: 1.2 | Data: 12/08/2026
// Painel lateral de CRIAÇÃO manual de registro (fontes com manual_entry, 0061).
// Espelha record-edit-sheet: núcleo (nome obrigatório + colunas editáveis) +
// responsável/operação + campos personalizados editáveis pelo papel. O server
// (createRecord) revalida permissão, fonte e força o vendedor ao próprio
// responsável. `defaultValues` pré-preenche campos (quick-create do kanban:
// valor da coluna); `onCreated` avisa o chamador (client) com o id criado.
// v1.2 (12/08/2026): campos OCULTÁVEIS — "x" ao lado de cada campo opcional
//   (núcleo + Responsável/Operação + custom; o Nome obrigatório nunca) o
//   remove dos PRÓXIMOS registros (useHiddenCreateFields — localStorage por
//   base, vale em /registros, no botão "+" do widget e no kanban). Campo
//   oculto com valor (prefill/seleção) vira <input type="hidden"> — o
//   quick-create do kanban não perde a coluna. No fim do form, "Campos
//   ocultos (N)" reativa cada um por toggle.
// v1.1 (16/07/2026): fontes Bitrix (lead/negocio) ganham o checkbox "Criar
//   também no Bitrix" (crm.lead.add/crm.deal.add via createRecord, 0065).
"use client";

import { useActionState, useEffect, useState } from "react";
import { ChevronRight, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ResizableSheetContent } from "@/components/ui/resizable-sheet-content";
import type { FieldDefinition, OptionItem } from "@/lib/records/types";
import { createRecord, type CreateRecordState } from "@/lib/records/actions";
import { emitDataChanged } from "@/lib/tasks/events";
import { CURRENCY_OPTIONS } from "@/lib/widgets/currency";
import { cn } from "@/lib/utils";
import { useHiddenCreateFields } from "./use-hidden-create-fields";

const initial: CreateRecordState = {};

// Rótulos (na ordem do form) do bloco fixo do núcleo — usados pelo "x" e pela
// lista de reativação. `core__title` fica fora de propósito (obrigatório).
const CORE_CREATE_FIELDS: { key: string; label: string }[] = [
  { key: "core__stage", label: "Etapa" },
  { key: "core__channel", label: "Canal" },
  { key: "core__value", label: "Valor" },
  { key: "core__mrr", label: "MRR" },
  { key: "core__currency", label: "Moeda" },
  { key: "core__sale_type", label: "Tipo de venda" },
  { key: "core__opened_at", label: "Abertura" },
  { key: "core__closed_at", label: "Fechamento" },
];

// Campo ocultável: rótulo + "x" (remove dos próximos registros) em volta do
// input. Oculto com valor não-vazio (prefill do kanban/seleção já feita) vira
// <input type="hidden"> — nada se perde no submit; sem valor, não submete
// (createRecord só exige core__title).
function HideableField({
  fieldKey,
  label,
  hidden,
  hiddenValue,
  onHide,
  children,
}: {
  fieldKey: string;
  label: string;
  hidden: boolean;
  hiddenValue?: string;
  onHide: () => void;
  children: React.ReactNode;
}) {
  if (hidden) {
    return hiddenValue ? (
      <input type="hidden" name={fieldKey} value={hiddenValue} />
    ) : null;
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-1">
        <Label>{label}</Label>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground size-5 shrink-0"
          onClick={onHide}
          aria-label={`Ocultar campo ${label}`}
          title="Ocultar dos próximos registros"
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {children}
    </div>
  );
}

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
    if (state.ok) {
      emitDataChanged({ kind: "record", recordId: state.id ?? null });
      if (state.id && onCreated) onCreated(state.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.id]);

  // Campos calculados são derivados — nunca criados à mão.
  const editableFields = fields.filter(
    (f) =>
      f.data_type !== "calculado" &&
      f.data_type !== "calculado_agg" &&
      f.editable_by_roles.some((r) => userRoles.includes(r))
  );

  // Campos ocultos (por usuário/base — localStorage). A lista de reativação
  // sai do catálogo VIGENTE na ordem do form: ref órfã no storage (campo
  // excluído/invisível ao papel) não aparece em lugar nenhum — fica dormindo.
  const { isHidden, hideField, showField } = useHiddenCreateFields(source.key);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const hiddenEntries = [
    ...CORE_CREATE_FIELDS,
    { key: "responsible_id", label: "Responsável" },
    { key: "operation_id", label: "Operação" },
    ...editableFields.map((f) => ({
      key: `custom__${f.field_key}`,
      label: f.label,
    })),
  ].filter((e) => isHidden(e.key));
  // Blocos 100% ocultos somem por display:none (os <input type="hidden"> dos
  // prefills seguem no DOM e submetem).
  const coreAllHidden = CORE_CREATE_FIELDS.every((f) => isHidden(f.key));
  const respOpAllHidden =
    isHidden("responsible_id") && isHidden("operation_id");
  const customAllHidden = editableFields.every((f) =>
    isHidden(`custom__${f.field_key}`)
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
      <ResizableSheetContent
        storageKey="panel-w:record-create"
        defaultWidth={512}
        className="overflow-y-auto"
      >
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

          <div
            className={
              coreAllHidden
                ? "hidden"
                : "grid grid-cols-2 gap-3 rounded-md border p-3"
            }
          >
            <HideableField
              fieldKey="core__stage"
              label="Etapa"
              hidden={isHidden("core__stage")}
              // Com "Criar no Bitrix" a etapa é da origem (o input visível fica
              // disabled e não submete) — o hidden não pode ressuscitá-la.
              hiddenValue={
                createInBitrix ? undefined : dv("core__stage") || undefined
              }
              onHide={() => hideField("core__stage")}
            >
              <Input
                name="core__stage"
                defaultValue={dv("core__stage")}
                disabled={createInBitrix}
                placeholder={createInBitrix ? "definida pelo Bitrix" : ""}
              />
            </HideableField>
            <HideableField
              fieldKey="core__channel"
              label="Canal"
              hidden={isHidden("core__channel")}
              hiddenValue={dv("core__channel") || undefined}
              onHide={() => hideField("core__channel")}
            >
              <Input name="core__channel" defaultValue={dv("core__channel")} />
            </HideableField>
            <HideableField
              fieldKey="core__value"
              label="Valor"
              hidden={isHidden("core__value")}
              hiddenValue={dv("core__value") || undefined}
              onHide={() => hideField("core__value")}
            >
              <Input
                type="number"
                step="0.01"
                name="core__value"
                defaultValue={dv("core__value")}
              />
            </HideableField>
            <HideableField
              fieldKey="core__mrr"
              label="MRR"
              hidden={isHidden("core__mrr")}
              hiddenValue={dv("core__mrr") || undefined}
              onHide={() => hideField("core__mrr")}
            >
              <Input
                type="number"
                step="0.01"
                name="core__mrr"
                defaultValue={dv("core__mrr")}
              />
            </HideableField>
            <HideableField
              fieldKey="core__currency"
              label="Moeda"
              hidden={isHidden("core__currency")}
              hiddenValue={currencyCode || undefined}
              onHide={() => hideField("core__currency")}
            >
              <Combobox
                name="core__currency"
                options={[{ value: "", label: "—" }, ...CURRENCY_OPTIONS]}
                value={currencyCode}
                onValueChange={setCurrencyCode}
                placeholder="—"
                className="w-full"
                aria-label="Moeda"
              />
            </HideableField>
            <HideableField
              fieldKey="core__sale_type"
              label="Tipo de venda"
              hidden={isHidden("core__sale_type")}
              hiddenValue={dv("core__sale_type") || undefined}
              onHide={() => hideField("core__sale_type")}
            >
              <Input name="core__sale_type" defaultValue={dv("core__sale_type")} />
            </HideableField>
            <HideableField
              fieldKey="core__opened_at"
              label="Abertura"
              hidden={isHidden("core__opened_at")}
              hiddenValue={dv("core__opened_at") || undefined}
              onHide={() => hideField("core__opened_at")}
            >
              <Input
                type="date"
                name="core__opened_at"
                defaultValue={dv("core__opened_at")}
              />
            </HideableField>
            <HideableField
              fieldKey="core__closed_at"
              label="Fechamento"
              hidden={isHidden("core__closed_at")}
              hiddenValue={dv("core__closed_at") || undefined}
              onHide={() => hideField("core__closed_at")}
            >
              <Input
                type="date"
                name="core__closed_at"
                defaultValue={dv("core__closed_at")}
              />
            </HideableField>
          </div>

          <div className={respOpAllHidden ? "hidden" : "flex flex-col gap-4"}>
            <HideableField
              fieldKey="responsible_id"
              label="Responsável"
              hidden={isHidden("responsible_id")}
              hiddenValue={responsibleId || undefined}
              onHide={() => hideField("responsible_id")}
            >
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
            </HideableField>
            <HideableField
              fieldKey="operation_id"
              label="Operação"
              hidden={isHidden("operation_id")}
              hiddenValue={operationId || undefined}
              onHide={() => hideField("operation_id")}
            >
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
            </HideableField>
          </div>

          {editableFields.length > 0 ? (
            <div
              className={
                customAllHidden ? "hidden" : "flex flex-col gap-4 border-t pt-4"
              }
            >
              {editableFields.map((f) => (
                <HideableField
                  key={f.id}
                  fieldKey={`custom__${f.field_key}`}
                  label={f.label}
                  hidden={isHidden(`custom__${f.field_key}`)}
                  hiddenValue={dv(`custom__${f.field_key}`) || undefined}
                  onHide={() => hideField(`custom__${f.field_key}`)}
                >
                  <NewCustomFieldInput
                    field={f}
                    defaultValue={dv(`custom__${f.field_key}`)}
                  />
                </HideableField>
              ))}
            </div>
          ) : null}

          {/* Reativação dos campos ocultos: lista suspensa no fim do form,
              um toggle por campo (na ordem do formulário). */}
          {hiddenEntries.length > 0 ? (
            <div className="flex flex-col gap-2 border-t pt-3">
              <button
                type="button"
                onClick={() => setHiddenOpen((v) => !v)}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
                aria-expanded={hiddenOpen}
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 transition-transform",
                    hiddenOpen && "rotate-90"
                  )}
                />
                Campos ocultos ({hiddenEntries.length})
              </button>
              {hiddenOpen
                ? hiddenEntries.map((e) => (
                    <label
                      key={e.key}
                      className="flex items-center gap-2 pl-4 text-sm"
                    >
                      <Checkbox
                        checked={false}
                        onCheckedChange={() => showField(e.key)}
                        aria-label={`Reexibir campo ${e.label}`}
                      />
                      {e.label}
                    </label>
                  ))
                : null}
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
      </ResizableSheetContent>
    </Sheet>
  );
}
