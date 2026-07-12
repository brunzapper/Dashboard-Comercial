// Versão: 1.0 | Data: 11/07/2026
// Célula editável inline para COLUNAS DE RELAÇÃO de records (hoje: responsible_id)
// nas tabelas de "registros individuais". Renderiza um SELECT das entidades
// elegíveis (ex.: responsáveis ativos) em vez de texto livre, e grava a FK via
// updateRecordField(kind:"relation"). Quando a coluna está marcada p/ gravar no
// Bitrix (writeBack), o responsável escolhido também vira ASSIGNED_BY_ID do
// deal/lead (traduzido p/ bitrix_user_id no server action).
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
  writeBack,
  onSaved,
}: {
  recordId: string;
  field: string; // coluna FK do núcleo (ex.: "responsible_id")
  value: string; // id atual (ou "")
  options: { value: string; label: string }[];
  writeBack?: boolean; // grava também no Bitrix (ASSIGNED_BY_ID)
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
        writeBack,
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
