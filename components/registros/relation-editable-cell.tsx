// Versão: 1.0 | Data: 11/07/2026
// Célula editável inline para COLUNAS DE RELAÇÃO de records (hoje: responsible_id)
// nas tabelas de "registros individuais". Renderiza um SELECT das entidades
// elegíveis (ex.: responsáveis ativos) em vez de texto livre, e grava a FK via
// updateRecordField(kind:"relation"). Relações ficam locais (sem write-back).
"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { Combobox } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import { updateRecordField } from "@/lib/records/actions";

export function RelationEditableCell({
  recordId,
  field,
  value: serverValue,
  options,
  onSaved,
}: {
  recordId: string;
  field: string; // coluna FK do núcleo (ex.: "responsible_id")
  value: string; // id atual (ou "")
  options: { value: string; label: string }[];
  onSaved?: () => void;
}) {
  const [value, setValue] = useState(serverValue);
  const savedRef = useRef(serverValue);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(serverValue);
    savedRef.current = serverValue;
  }, [serverValue]);

  function commit(raw: string) {
    if (raw === savedRef.current) return;
    setValue(raw);
    setError(false);
    startTransition(async () => {
      const res = await updateRecordField(recordId, field, raw, {
        kind: "relation",
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

  return (
    <Combobox
      options={[{ value: "", label: "—" }, ...options]}
      value={value}
      onValueChange={commit}
      placeholder="—"
      disabled={pending}
      className={cn("w-full", error && "border-destructive")}
      aria-label={field}
    />
  );
}
