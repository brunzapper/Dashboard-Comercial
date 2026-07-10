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
import { updateRecordField } from "@/lib/records/actions";

function customValue(record: RecordRow, key: string): string {
  const v = record.custom_fields?.[key];
  if (v == null) return "";
  return String(v);
}

function money(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function EditableCell({
  record,
  field,
  userRoles,
  canEditValues,
  onSaved,
}: {
  record: RecordRow;
  field: FieldDefinition;
  userRoles: string[];
  canEditValues: boolean;
  // Chamado após uma gravação bem-sucedida. Em Registros a própria action
  // revalida a página; no dashboard o pai usa isto para router.refresh().
  onSaved?: () => void;
}) {
  const serverValue = customValue(record, field.field_key);
  const [value, setValue] = useState(serverValue);
  const savedRef = useRef(serverValue);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  // Reconcilia com o servidor quando novos dados chegam (após revalidatePath):
  // adota o valor do servidor sem sobrescrever uma edição ainda em andamento
  // (nesse caso serverValue continua igual ao das props antigas).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(serverValue);
    savedRef.current = serverValue;
  }, [serverValue]);

  const editable =
    canEditValues &&
    field.data_type !== "calculado" &&
    field.editable_by_roles.some((r) => userRoles.includes(r));

  if (!editable) {
    const display = field.data_type === "moeda" ? money(serverValue) : serverValue;
    return <span className="block truncate">{display || "—"}</span>;
  }

  function commit(raw: string) {
    if (raw === savedRef.current) return;
    setValue(raw);
    setError(false);
    startTransition(async () => {
      const res = await updateRecordField(record.id, field.field_key, raw);
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
    return (
      <Input
        type="date"
        value={value.slice(0, 10)}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
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
