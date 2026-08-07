// Versão: 2.0 | Data: 07/08/2026
// v2.0 (07/08/2026): 100% dos campos consultáveis no detalhe.
//   - Seção núcleo COMPLETA: grade read-only gerada de coreDetailRows
//     (CORE_FIELDS + rótulo/ordem das linhas core do /campos) — pipeline,
//     situação, tipo de venda, fechado, data de fechamento/abertura etc.,
//     que o bloco hardcoded antigo nunca exibia. O guard `ref in record` pula
//     colunas que o select da superfície não trouxe.
//   - Catálogo do detalhe ≠ colunas da tabela: `detailFields` (campos da base,
//     olho irrelevante) + `offBaseDefs` (campos de outras bases — só entram
//     quando o registro tem valor). Partição editável/read-only inalterada
//     (o servidor re-gateia por editable_by_roles em updateRecord).
//   - Seção "Outros dados": chaves de custom_fields SEM definição alguma
//     (knownFieldKeys vem PRÉ-ACL — valor de campo restrito nunca vaza aqui).
//   Props novas são opcionais: call sites legados seguem funcionando.
// v1.3 (17/07/2026): formulário extraído em RecordEditForm (exportado) — a aba
//   "Dados" do CardDetailSheet (feed dos cards do kanban) embute o mesmo form;
//   este Sheet segue funcionando igual para os call sites existentes. Sucesso
//   emite emitDataChanged({kind:"record"}) p/ widgets recarregarem (W1).
// v1.2 (16/07/2026): seção "Tarefas" — tarefas vinculadas ao registro
//   (listar/criar/concluir), carregadas sob demanda.
// v1.1 (15/07/2026): campos read-only formatados (moeda/percentual/data) em vez
//   do valor cru.
// Painel lateral de edição de um registro: núcleo (editável por permissão +
// grade read-only completa) + relações (responsável/operação/lead) + campos
// personalizados editáveis pelo papel.
"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import {
  RECORD_TYPE_LABELS,
  isPercentField,
  type FieldDefinition,
  type OptionItem,
  type RecordRow,
} from "@/lib/records/types";
import { updateRecord, type EditActionState } from "@/lib/records/actions";
import {
  coreCellValue,
  coreDetailRows,
  DETAIL_EDITABLE_CORE_REFS,
  DETAIL_HEADER_REFS,
  orphanCustomKeys,
  type CoreDetailRow,
} from "@/lib/records/detail-fields";
import type { RecordLabels } from "@/lib/export/record-cells";
import { emitDataChanged } from "@/lib/tasks/events";
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
import { RecordTasksSection } from "@/components/tarefas/record-tasks-section";

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

// Props compartilhadas do formulário/painel de edição de registro.
export interface RecordEditFormProps {
  record: RecordRow;
  fields: FieldDefinition[];
  // Catálogo COMPLETO do detalhe (07/08/2026) — opcionais: call site legado
  // (sem eles) degrada para `fields` e pula as seções extras.
  detailFields?: FieldDefinition[]; // campos da base (olho irrelevante)
  offBaseDefs?: FieldDefinition[]; // campos de outras bases — só com valor
  coreDefs?: FieldDefinition[]; // linhas core do /campos (rótulo/ordem)
  knownFieldKeys?: string[]; // TODAS as keys com definição (pré-ACL)
  responsibles: OptionItem[];
  operations: OptionItem[];
  relatedLeadLabel: string | null;
  userRoles: string[];
  canEditValues: boolean;
  canManageFields: boolean;
}

// Grade read-only de colunas do núcleo (rótulo → valor formatado).
function CoreGrid({
  rows,
  record,
  labels,
  title,
}: {
  rows: CoreDetailRow[];
  record: RecordRow;
  labels: RecordLabels;
  title?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {title ? (
        <p className="text-muted-foreground text-xs font-medium">{title}</p>
      ) : null}
      <div className="bg-muted/40 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md p-3 text-sm">
        {rows.map(({ ref, label }) => (
          <span key={ref} className="contents">
            <span className="text-muted-foreground">{label}</span>
            <span>{coreCellValue(record, ref, labels)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Formulário de edição do registro (sem Sheet) — embutível na aba "Dados" do
 * CardDetailSheet ou em qualquer painel. `onSaved` avisa o chamador (fechar
 * painel, recarregar); o evento global de dados é emitido aqui.
 */
export function RecordEditForm({
  record,
  fields,
  detailFields,
  offBaseDefs,
  coreDefs,
  knownFieldKeys,
  responsibles,
  operations,
  relatedLeadLabel,
  userRoles,
  canEditValues,
  canManageFields,
  onSaved,
}: RecordEditFormProps & { onSaved?: () => void }) {
  const [state, formAction, pending] = useActionState(updateRecord, initial);
  const [responsibleId, setResponsibleId] = useState(record.responsible_id ?? "");
  const [operationId, setOperationId] = useState(record.operation_id ?? "");
  const [currencyCode, setCurrencyCode] = useState(record.currency ?? "");

  useEffect(() => {
    if (state.ok) {
      emitDataChanged({ kind: "record", recordId: record.id });
      if (onSaved) onSaved();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  // Rótulos de FK p/ a grade núcleo (formatação única de record-cells).
  const labels: RecordLabels = useMemo(
    () => ({
      responsibles: Object.fromEntries(responsibles.map((r) => [r.id, r.label])),
      operations: Object.fromEntries(operations.map((o) => [o.id, o.label])),
      leads:
        record.related_lead_id && relatedLeadLabel
          ? { [record.related_lead_id]: relatedLeadLabel }
          : {},
    }),
    [responsibles, operations, record.related_lead_id, relatedLeadLabel]
  );

  // Catálogo do detalhe: campos da base (detailFields ?? fields) + campos de
  // OUTRAS bases apenas quando o registro tem valor neles (evita poluir o
  // painel com vazios alheios).
  const catalog = useMemo(() => {
    const base = detailFields ?? fields;
    const extras = (offBaseDefs ?? []).filter(
      (f) => customValue(record, f.field_key) !== ""
    );
    return [...base, ...extras];
  }, [detailFields, fields, offBaseDefs, record]);

  // Campos de Sync (vindos do Bitrix): nos Registros ficam SEMPRE editáveis para
  // quem tem permissão (canEditValues), independentemente de editable_by_roles.
  const isBitrixSync = (f: FieldDefinition) =>
    f.source_system === "bitrix" && Boolean(f.source_field_id);
  // Campos calculados nunca são editáveis (o valor é derivado da fórmula).
  const editableFields = catalog.filter(
    (f) =>
      f.data_type !== "calculado" &&
      (f.editable_by_roles.some((r) => userRoles.includes(r)) ||
        (canEditValues && isBitrixSync(f)))
  );
  const readOnlyFields = catalog.filter((f) => !editableFields.includes(f));

  // Grade núcleo COMPLETA: no modo edição pula o que já tem input próprio; no
  // read-only mostra tudo (fora título/tipo/base, que estão no cabeçalho).
  const coreSkip = useMemo(
    () =>
      canEditValues
        ? new Set([...DETAIL_HEADER_REFS, ...DETAIL_EDITABLE_CORE_REFS])
        : DETAIL_HEADER_REFS,
    [canEditValues]
  );
  const coreRows = coreDetailRows(record, coreDefs, coreSkip);

  // Chaves de custom_fields sem definição alguma → "Outros dados" (read-only).
  const orphanKeys = knownFieldKeys
    ? orphanCustomKeys(record.custom_fields, knownFieldKeys)
    : [];

  return (
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
            </div>
          ) : null}

          {/* Grade núcleo completa (100% dos campos): no modo edição são os
              "demais" (sem input próprio) — pipeline, situação, tipo de venda,
              fechado, datas…; no read-only é o núcleo INTEIRO, relações
              inclusas. */}
          <CoreGrid
            rows={coreRows}
            record={record}
            labels={labels}
            title={canEditValues ? "Demais dados do registro" : undefined}
          />

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

          {/* Chaves de custom_fields sem definição alguma — consulta apenas.
              (knownFieldKeys vem PRÉ-ACL: campo restrito por papel tem
              definição e nunca cai aqui.) */}
          {orphanKeys.length > 0 ? (
            <div className="flex flex-col gap-1.5 border-t pt-4">
              <p className="text-muted-foreground text-xs font-medium">
                Outros dados
              </p>
              <div className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {orphanKeys.map((k) => (
                  <span key={k} className="contents">
                    <span>{k}</span>
                    <span>{customValue(record, k)}</span>
                  </span>
                ))}
              </div>
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
  );
}

/** Painel lateral de edição (gatilho lápis) — wrapper do RecordEditForm. */
export function RecordEditSheet(props: RecordEditFormProps) {
  const { record, responsibles, userRoles } = props;
  const [open, setOpen] = useState(false);

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
      <ResizableSheetContent
        storageKey="panel-w:record-edit"
        defaultWidth={512}
        className="overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>{record.title ?? "(sem título)"}</SheetTitle>
          <SheetDescription>
            {RECORD_TYPE_LABELS[record.record_type]} · {record.source_system}
          </SheetDescription>
        </SheetHeader>

        <RecordEditForm {...props} onSaved={() => setOpen(false)} />

        {/* Tarefas vinculadas — FORA do form (os botões internos da seção não
            podem submeter a edição do registro). Carrega só com o painel aberto. */}
        <div className="px-4 pb-6">
          <RecordTasksSection
            recordId={record.id}
            recordTitle={record.title}
            responsibles={responsibles}
            userRoles={userRoles}
          />
        </div>
      </ResizableSheetContent>
    </Sheet>
  );
}
