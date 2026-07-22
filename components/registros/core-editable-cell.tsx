// Versão: 1.1 | Data: 18/07/2026
// v1.1 (18/07/2026): commit otimista extraído p/ useCellCommit; erro expõe a
//   mensagem da action no title.
// Célula editável inline para COLUNAS DO NÚCLEO de records (title, stage, value,
// mrr, closed, closed_at, ...). Espelha a EditableCell (campos personalizados),
// mas grava numa coluna própria via updateRecordField(kind:"core"). O tipo vem de
// EDITABLE_CORE_COLUMNS. Usada só no widget de "registros individuais" quando a
// coluna é marcada como Editável (dono/admin do dashboard).
"use client";

import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { DataType } from "@/lib/records/types";
import {
  DEFAULT_DATE_FORMAT,
  formatDateValue,
  type DateFormat,
} from "@/lib/widgets/format";
import { CURRENCY_OPTIONS, formatMoney } from "@/lib/widgets/currency";
import { updateRecordField } from "@/lib/records/actions";
import { useCellCommit } from "@/components/registros/use-cell-commit";

export function CoreEditableCell({
  recordId,
  field,
  dataType,
  options,
  value: serverValue,
  currency,
  writeBack = false,
  dateFormat = DEFAULT_DATE_FORMAT,
  onSaved,
}: {
  recordId: string;
  field: string; // nome da coluna do núcleo
  dataType: DataType;
  // Options de uma coluna núcleo virada 'selecao' no /campos (0086 — ex.:
  // pipeline). Presentes + dataType 'selecao' → dropdown em vez de texto livre.
  options?: string[];
  value: string; // valor atual (string)
  currency?: string | null; // moeda do registro (formata value/mrr)
  writeBack?: boolean;
  dateFormat?: DateFormat;
  onSaved?: () => void;
}) {
  // Commit otimista + reconcile com o servidor: ver use-cell-commit.ts.
  const { value, setValue, commit, revert, pending, error, errorMessage } =
    useCellCommit(
      serverValue,
      (raw) => updateRecordField(recordId, field, raw, { kind: "core", writeBack }),
      onSaved
    );
  const [editingDate, setEditingDate] = useState(false);

  // Moeda (coluna `currency`): select de códigos ISO em vez de texto livre, para
  // corrigir a moeda do valor rapidamente. O write-back envia CURRENCY_ID ao Bitrix.
  if (field === "currency") {
    return (
      <Combobox
        options={[{ value: "", label: "—" }, ...CURRENCY_OPTIONS]}
        value={value}
        onValueChange={commit}
        placeholder="—"
        disabled={pending}
        className={cn("w-full", error && "border-destructive")}
        aria-label="Moeda"
      />
    );
  }

  if (dataType === "booleano") {
    return (
      <Checkbox
        checked={value === "true"}
        onCheckedChange={(c) => commit(c === true ? "true" : "false")}
        disabled={pending}
        aria-label={field}
        aria-invalid={error}
      />
    );
  }

  if (dataType === "data") {
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
          aria-label={field}
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
        aria-label={field}
        aria-invalid={error}
        title={error ? errorMessage ?? undefined : undefined}
        className={cn(error && "border-destructive")}
      />
    );
  }

  if (dataType === "numero" || dataType === "moeda") {
    return (
      <Input
        type="number"
        step={dataType === "moeda" ? "0.01" : "any"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        disabled={pending}
        aria-label={field}
        aria-invalid={error}
        title={
          error
            ? errorMessage ?? undefined
            : dataType === "moeda"
              ? formatMoney(value, currency)
              : undefined
        }
        className={cn("text-right", error && "border-destructive")}
      />
    );
  }

  // Coluna núcleo 'selecao' (0086): dropdown com as options do /campos —
  // mesma receita da EditableCell dos campos personalizados.
  if (dataType === "selecao" && options && options.length > 0) {
    return (
      <Combobox
        options={[
          { value: "", label: "—" },
          ...options.map((o) => ({ value: o, label: o })),
        ]}
        value={value}
        onValueChange={commit}
        placeholder="—"
        disabled={pending}
        className={cn("w-full", error && "border-destructive")}
        aria-label={field}
      />
    );
  }

  // texto (title, stage, currency, channel, sale_type, pipeline, ...)
  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      disabled={pending}
      aria-label={field}
      aria-invalid={error}
      title={error ? errorMessage ?? undefined : undefined}
      className={cn(error && "border-destructive")}
    />
  );
}
