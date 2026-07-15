// Versão: 1.0 | Data: 05/07/2026
// Painel lateral de edição de um registro: núcleo (read-only) + relações
// (responsável/operação/lead) + campos personalizados editáveis pelo papel.
"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import {
  RECORD_TYPE_LABELS,
  isPercentField,
  type FieldDefinition,
  type OptionItem,
  type RecordRow,
} from "@/lib/records/types";
import { updateRecord, type EditActionState } from "@/lib/records/actions";
import {
  CURRENCY_OPTIONS,
  formatMoney,
  resolveFieldMoneyFromRecord,
} from "@/lib/widgets/currency";
import {
  DEFAULT_DATE_FORMAT,
  formatDateValue,
  formatPercent,
} from "@/lib/widgets/format";
import { LeadCombobox } from "./lead-combobox";
import { RecordMatchConnect } from "./record-match-connect";

const initial: EditActionState = {};

function customValue(record: RecordRow, key: string): string {
  const v = record.custom_fields?.[key];
  if (v == null) return "";
  return String(v);
}

function CustomFieldInput({
  field,
  record,
}: {
  field: FieldDefinition;
  record: RecordRow;
}) {
  const name = `custom__${field.field_key}`;
  const value = customValue(record, field.field_key);
  const [selValue, setSelValue] = useState(value);

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
      <Input type="date" name={name} defaultValue={value.slice(0, 10)} />
    );
  }
  if (field.data_type === "numero" || field.data_type === "moeda") {
    return (
      <Input
        type="number"
        step={field.data_type === "moeda" ? "0.01" : "any"}
        name={name}
        defaultValue={value}
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
  return <Input name={name} defaultValue={value} />;
}

export function RecordEditSheet({
  record,
  fields,
  responsibles,
  operations,
  relatedLeadLabel,
  userRoles,
  canEditValues,
  canManageFields,
}: {
  record: RecordRow;
  fields: FieldDefinition[];
  responsibles: OptionItem[];
  operations: OptionItem[];
  relatedLeadLabel: string | null;
  userRoles: string[];
  canEditValues: boolean;
  canManageFields: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(updateRecord, initial);
  const [responsibleId, setResponsibleId] = useState(record.responsible_id ?? "");
  const [operationId, setOperationId] = useState(record.operation_id ?? "");
  const [currencyCode, setCurrencyCode] = useState(record.currency ?? "");

  useEffect(() => {
    // Fecha o painel quando a Server Action conclui com sucesso.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (state.ok) setOpen(false);
  }, [state.ok]);

  // Campos de Sync (vindos do Bitrix): nos Registros ficam SEMPRE editáveis para
  // quem tem permissão (canEditValues), independentemente de editable_by_roles.
  const isBitrixSync = (f: FieldDefinition) =>
    f.source_system === "bitrix" && Boolean(f.source_field_id);
  // Campos calculados nunca são editáveis (o valor é derivado da fórmula).
  const editableFields = fields.filter(
    (f) =>
      f.data_type !== "calculado" &&
      (f.editable_by_roles.some((r) => userRoles.includes(r)) ||
        (canEditValues && isBitrixSync(f)))
  );
  const readOnlyFields = fields.filter((f) => !editableFields.includes(f));

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Editar registro"
        onClick={() => setOpen(true)}
      >
        <Pencil className="size-4" />
      </Button>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{record.title ?? "(sem título)"}</SheetTitle>
          <SheetDescription>
            {RECORD_TYPE_LABELS[record.record_type]} · {record.source_system}
          </SheetDescription>
        </SheetHeader>

        <form action={formAction} className="flex flex-col gap-5 px-4 pb-6">
          <input type="hidden" name="record_id" value={record.id} />
          {/* Edições dos Registros gravam sempre no Bitrix (campos de Sync). */}
          <input type="hidden" name="force_sync_write_back" value="1" />

          {/* Núcleo (campos de Sync): editáveis p/ quem tem permissão — as
              alterações gravam sempre de volta no Bitrix (force_sync_write_back). */}
          {canEditValues ? (
            <div className="grid grid-cols-2 gap-3 rounded-md border p-3">
              <div className="flex flex-col gap-1.5">
                <Label>Etapa</Label>
                <Input name="core__stage" defaultValue={record.stage ?? ""} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Canal</Label>
                <Input name="core__channel" defaultValue={record.channel ?? ""} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Valor</Label>
                <Input
                  type="number"
                  step="0.01"
                  name="core__value"
                  defaultValue={record.value ?? ""}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>MRR</Label>
                <Input
                  type="number"
                  step="0.01"
                  name="core__mrr"
                  defaultValue={record.mrr ?? ""}
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
              <div className="text-muted-foreground col-span-2 text-xs">
                Lead time (dias): {record.lead_time_days ?? "—"}
              </div>
            </div>
          ) : (
            <div className="bg-muted/40 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md p-3 text-sm">
              <span className="text-muted-foreground">Etapa</span>
              <span>{record.stage ?? "—"}</span>
              <span className="text-muted-foreground">MRR</span>
              <span>{formatMoney(record.mrr, record.currency)}</span>
              <span className="text-muted-foreground">Valor</span>
              <span>{formatMoney(record.value, record.currency)}</span>
              <span className="text-muted-foreground">Moeda</span>
              <span>{record.currency ?? "—"}</span>
              <span className="text-muted-foreground">Canal</span>
              <span>{record.channel ?? "—"}</span>
              <span className="text-muted-foreground">Lead time (dias)</span>
              <span>{record.lead_time_days ?? "—"}</span>
            </div>
          )}

          {canEditValues ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Responsável</Label>
                <Combobox
                  name="responsible_id"
                  options={[
                    { value: "", label: "— nenhum —" },
                    // Este dropdown grava sempre no Bitrix (force_sync_write_back):
                    // só responsáveis com usuário Bitrix. Os criados só no sistema
                    // (sem bitrix_user_id) não têm p/ onde gravar a atribuição.
                    ...responsibles
                      .filter((r) => r.bitrixLinked)
                      .map((r) => ({ value: r.id, label: r.label })),
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
                    { value: "", label: "— nenhuma —" },
                    ...operations.map((o) => ({ value: o.id, label: o.label })),
                  ]}
                  value={operationId}
                  onValueChange={setOperationId}
                  placeholder="— nenhuma —"
                  className="w-full"
                  aria-label="Operação"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Lead relacionado</Label>
                <LeadCombobox
                  name="related_lead_id"
                  defaultId={record.related_lead_id}
                  defaultLabel={relatedLeadLabel}
                />
              </div>
            </div>
          ) : null}

          {canManageFields ? (
            <RecordMatchConnect
              recordId={record.id}
              recordType={record.record_type}
            />
          ) : null}

          {/* Campos personalizados editáveis */}
          {editableFields.length > 0 ? (
            <div className="flex flex-col gap-4 border-t pt-4">
              {editableFields.map((f) => (
                <div key={f.id} className="flex flex-col gap-1.5">
                  <Label>{f.label}</Label>
                  <CustomFieldInput field={f} record={record} />
                </div>
              ))}
            </div>
          ) : null}

          {/* Campos personalizados só de leitura */}
          {readOnlyFields.length > 0 ? (
            <div className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1 border-t pt-4 text-sm">
              {readOnlyFields.map((f) => (
                <span key={f.id} className="contents">
                  <span>{f.label}</span>
                  {/* Traço só para vazio/nulo — zero exibe "0". Formata moeda,
                      percentual (×100 + "%") e data como no restante do app. */}
                  <span>
                    {(() => {
                      const v = customValue(record, f.field_key);
                      if (v == null || v === "") return "—";
                      const money = resolveFieldMoneyFromRecord(f, record);
                      if (money.isMoney) return formatMoney(v, money.code);
                      if (isPercentField(f)) return formatPercent(v, true);
                      if (f.data_type === "data") {
                        return formatDateValue(v, DEFAULT_DATE_FORMAT);
                      }
                      return v;
                    })()}
                  </span>
                </span>
              ))}
            </div>
          ) : null}

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

          {canEditValues || editableFields.length > 0 ? (
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar"}
            </Button>
          ) : (
            <p className="text-muted-foreground text-sm">
              Você não tem permissão para editar este registro.
            </p>
          )}
        </form>
      </SheetContent>
    </Sheet>
  );
}
