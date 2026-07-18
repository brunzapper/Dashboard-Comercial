// Versão: 1.2 | Data: 18/07/2026
// v1.2 (18/07/2026): commit otimista extraído p/ useCellCommit (compartilhado
//   com Core/RelationEditableCell); erro expõe a mensagem da action no title.
// v1.1 (15/07/2026): leitura de campo percentual exibe ×100 + "%" (edição
//   continua com o valor cru).
// Célula editável inline na tabela de Registros: renderiza o controle certo por
// data_type (dropdown de seleção, checkbox booleano, texto/número/data editáveis) e
// grava um único campo personalizado na hora, reusando a Server Action
// updateRecordField. Campos calculados e sem permissão caem no texto somente-leitura.
"use client";

import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  isPercentField,
  type FieldDefinition,
  type RecordRow,
} from "@/lib/records/types";
import {
  DEFAULT_DATE_FORMAT,
  formatDateValue,
  formatPercent,
  type DateFormat,
} from "@/lib/widgets/format";
import { updateRecordField } from "@/lib/records/actions";
import { useCellCommit } from "@/components/registros/use-cell-commit";
import { formatMoney, resolveFieldMoneyFromRecord } from "@/lib/widgets/currency";

function customValue(record: RecordRow, key: string): string {
  const v = record.custom_fields?.[key];
  if (v == null) return "";
  return String(v);
}

export function EditableCell({
  record,
  field,
  userRoles,
  canEditValues,
  dateFormat = DEFAULT_DATE_FORMAT,
  onSaved,
  writeBack = false,
  forceSyncWriteBack = false,
  forceEditable = false,
}: {
  record: RecordRow;
  field: FieldDefinition;
  userRoles: string[];
  canEditValues: boolean;
  // Formato de exibição das datas (só afeta a leitura; a edição usa o calendário
  // nativo em ISO). Default = dd/mm/aaaa.
  dateFormat?: DateFormat;
  // Chamado após uma gravação bem-sucedida. A action inline NÃO revalida no
  // servidor (no_revalidate): o pai passa aqui o refresh debounced que
  // reconcilia a página (Registros e dashboards), junto com o realtime.
  onSaved?: () => void;
  // Dashboard: esta coluna grava de volta no Bitrix ao editar.
  writeBack?: boolean;
  // Registros: campos de Sync sempre editáveis + gravam no Bitrix.
  forceSyncWriteBack?: boolean;
  // Dashboard: coluna marcada como editável — libera edição p/ quem tem permissão
  // mesmo sem editable_by_roles.
  forceEditable?: boolean;
}) {
  const serverValue = customValue(record, field.field_key);
  // Commit otimista + reconcile com o servidor (refresh debounced/realtime):
  // ver use-cell-commit.ts.
  const { value, setValue, commit, revert, pending, error, errorMessage } =
    useCellCommit(
      serverValue,
      (raw) =>
        updateRecordField(record.id, field.field_key, raw, {
          kind: "custom",
          writeBack,
          forceSyncWriteBack,
          allowEdit: forceEditable,
        }),
      onSaved
    );
  // Data: por padrão mostra o texto formatado; duplo-clique abre o calendário.
  const [editingDate, setEditingDate] = useState(false);

  // Campos de Sync (Bitrix): nos Registros (forceSyncWriteBack) ficam sempre
  // editáveis para quem tem permissão, independentemente de editable_by_roles.
  const isBitrixSync =
    field.source_system === "bitrix" && Boolean(field.source_field_id);
  const editable =
    canEditValues &&
    field.data_type !== "calculado" &&
    (field.editable_by_roles.some((r) => userRoles.includes(r)) ||
      (forceSyncWriteBack && isBitrixSync) ||
      forceEditable);

  if (!editable) {
    // Moeda por campo: 'moeda' usa a moeda fixa do campo; 'calculado'-moeda usa a
    // moeda do resultado (carimbo por valor/automática ou fixa). Ver
    // resolveFieldMoneyFromRecord.
    const money = resolveFieldMoneyFromRecord(field, record);
    const display = money.isMoney
      ? formatMoney(serverValue, money.code)
      : isPercentField(field)
        ? // Percentual: exibe cru ×100 + "%" (0.35 → "35%"; vazio → "—").
          formatPercent(serverValue, true)
        : field.data_type === "data"
          ? formatDateValue(serverValue, dateFormat)
          : serverValue;
    // Traço só para vazio/nulo — zero (0 numérico ou "0") exibe normalmente.
    return (
      <span className="block truncate">
        {display == null || display === "" ? "—" : display}
      </span>
    );
  }

  if (field.data_type === "selecao") {
    return (
      <Combobox
        options={[
          { value: "", label: "—" },
          ...field.options.map((opt) => ({ value: opt, label: opt })),
        ]}
        value={value}
        onValueChange={commit}
        placeholder="—"
        disabled={pending}
        className={cn("w-full", error && "border-destructive")}
        aria-label={field.label}
      />
    );
  }

  if (field.data_type === "booleano") {
    return (
      <Checkbox
        checked={value === "true"}
        onCheckedChange={(c) => commit(c === true ? "true" : "false")}
        disabled={pending}
        aria-label={field.label}
        aria-invalid={error}
      />
    );
  }

  if (field.data_type === "data") {
    // Fora de edição: texto formatado; duplo-clique abre o calendário nativo.
    if (!editingDate) {
      return (
        <button
          type="button"
          onDoubleClick={() => setEditingDate(true)}
          title="Duplo-clique para escolher a data"
          className={cn(
            "block w-full truncate text-left",
            error && "text-destructive"
          )}
          aria-label={field.label}
        >
          {formatDateValue(value, dateFormat) || "—"}
        </button>
      );
    }
    return (
      <Input
        type="date"
        autoFocus
        value={value.slice(0, 10)}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => {
          commit(e.target.value);
          setEditingDate(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            revert();
            setEditingDate(false);
          }
        }}
        disabled={pending}
        aria-label={field.label}
        aria-invalid={error}
        title={error ? errorMessage ?? undefined : undefined}
        className={cn(error && "border-destructive")}
      />
    );
  }

  if (field.data_type === "numero" || field.data_type === "moeda") {
    return (
      <Input
        type="number"
        step={field.data_type === "moeda" ? "0.01" : "any"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        disabled={pending}
        aria-label={field.label}
        aria-invalid={error}
        title={error ? errorMessage ?? undefined : undefined}
        className={cn("text-right", error && "border-destructive")}
      />
    );
  }

  // texto (e qualquer outro tipo textual)
  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      disabled={pending}
      aria-label={field.label}
      aria-invalid={error}
      title={error ? errorMessage ?? undefined : undefined}
      className={cn(error && "border-destructive")}
    />
  );
}
