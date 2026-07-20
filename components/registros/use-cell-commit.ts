// Versão: 1.1 | Data: 20/07/2026
// v1.1 (20/07/2026): digitação em andamento não é mais sobrescrita por
//   serverValue novo (edição concorrente) — reconciliação no commit/revert.
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
  const [value, setValueState] = useState(serverValue);
  const savedRef = useRef(serverValue);
  // v1.1 (20/07/2026): edição local NÃO confirmada em andamento (dirtyRef) —
  // um refresh trazendo serverValue novo (edição concorrente de outro usuário)
  // não sobrescreve mais a digitação; o servidor entra no próximo
  // commit/revert (savedRef sempre acompanha o servidor).
  const dirtyRef = useRef(false);
  const [pending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const setValue = (v: string) => {
    dirtyRef.current = v !== savedRef.current;
    setValueState(v);
  };

  useEffect(() => {
    savedRef.current = serverValue;
    if (dirtyRef.current) return;
     
    setValueState(serverValue);
  }, [serverValue]);

  function commit(raw: string) {
    if (raw === savedRef.current) {
      dirtyRef.current = false;
      return;
    }
    setValueState(raw);
    setError(false);
    setErrorMessage(null);
    startTransition(async () => {
      const res = await save(raw);
      if (res.ok) {
        savedRef.current = raw;
        dirtyRef.current = false;
        onSaved?.();
      } else {
        dirtyRef.current = false;
        setValueState(savedRef.current);
        setError(true);
        setErrorMessage(res.message ?? null);
      }
    });
  }

  return {
    value,
    setValue,
    commit,
    revert: () => {
      dirtyRef.current = false;
      setValueState(savedRef.current);
    },
    pending,
    error,
    errorMessage,
  };
}
