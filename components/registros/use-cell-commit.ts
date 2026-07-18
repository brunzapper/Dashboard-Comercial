// Versão: 1.0 | Data: 18/07/2026
// Hook do commit OTIMISTA das células editáveis inline (EditableCell,
// CoreEditableCell, RelationEditableCell — o LeadEditableCell mantém o padrão
// próprio de remount por key). Extrai o bloco repetido: estado local + valor
// confirmado (savedRef) + useTransition + revert em erro. A célula mostra o
// valor novo na hora; a action roda na transition; erro reverte ao confirmado e
// guarda a mensagem (errorMessage → title da célula). Reconcilia com o servidor
// quando novas props chegam (refresh debounced/realtime) sem sobrescrever uma
// edição em andamento — nesse caso serverValue continua igual ao anterior.
// NÃO usa useOptimistic de propósito: ele reverteria ao valor base ao fim da
// transition e, sem o revalidatePath por célula, o valor antigo "piscaria" até
// o refresh debounced chegar.
"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import type { EditActionState } from "@/lib/records/actions";

export function useCellCommit(
  serverValue: string,
  save: (raw: string) => Promise<EditActionState>,
  onSaved?: () => void
): {
  value: string;
  setValue: (v: string) => void;
  commit: (raw: string) => void;
  // Volta ao último valor confirmado (ex.: Escape no calendário).
  revert: () => void;
  pending: boolean;
  error: boolean;
  errorMessage: string | null;
} {
  const [value, setValue] = useState(serverValue);
  const savedRef = useRef(serverValue);
  const [pending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
    setErrorMessage(null);
    startTransition(async () => {
      const res = await save(raw);
      if (res.ok) {
        savedRef.current = raw;
        onSaved?.();
      } else {
        setValue(savedRef.current);
        setError(true);
        setErrorMessage(res.message ?? null);
      }
    });
  }

  return {
    value,
    setValue,
    commit,
    revert: () => setValue(savedRef.current),
    pending,
    error,
    errorMessage,
  };
}
