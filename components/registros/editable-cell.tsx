// Versão: 1.0 | Data: 10/07/2026
// Célula editável inline na tabela de Registros: renderiza o controle certo por
// data_type (dropdown de seleção, checkbox booleano, texto/número/data editáveis) e
// grava um único campo personalizado na hora, reusando a Server Action
// updateRecordField. Campos calculados e sem permissão caem no texto somente-leitura.
"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import {
  DEFAULT_DATE_FORMAT,
  formatDateValue,
  type DateFormat,
} from "@/lib/widgets/format";
import { updateRecordField } from "@/lib/records/actions";
import { formatMoney } from "@/lib/widgets/currency";

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
  // Chamado após uma gravação bem-sucedida. Em Registros a própria action
  // revalida a página; no dashboard o pai usa isto para router.refresh().
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
  const [value, setValue] = useState(serverValue);
  const savedRef = useRef(serverValue);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  // Data: por padrão mostra o texto formatado; duplo-clique abre o calendário.
  const [editingDate, setEditingDate] = useState(false);

  // Reconcilia com o servidor quando novos dados chegam (após revalidatePath):
  // adota o valor do servidor sem sobrescrever uma edição ainda em andamento
  // (nesse caso serverValue continua igual ao das props antigas).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(serverValue);
    savedRef.current = serverValue;
  }, [serverValue]);

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
    const display =
      field.data_type === "moeda"
        ? formatMoney(serverValue, record.currency)
        : field.data_type === "data"
          ? formatDateValue(serverValue, dateFormat)
          : serverValue;
    return <span className="block truncate">{display || "—"}</span>;
  }

  function commit(raw: string) {
    if (raw === savedRef.current) return;
    setValue(raw);
    setError(false);
    startTransition(async () => {
      const res = await updateRecordField(record.id, field.field_key, raw, {
        kind: "custom",
        writeBack,
        forceSyncWriteBack,
        allowEdit: forceEditable,
      });
      if (res.ok) {
        savedRef.current = raw;
        onSaved?.();
      } else {
        setValue(savedRef.current);
        setError(true);
      }
    });
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
            setValue(savedRef.current);
            setEditingDate(false);
          }
        }}
        disabled={pending}
        aria-label={field.label}
        aria-invalid={error}
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
      className={cn(error && "border-destructive")}
    />
  );
}
