// Versão: 1.0 | Data: 12/08/2026
// Campos OCULTOS do formulário de novo registro (RecordCreateSheet) — chrome de
// UI por usuário, persistido em localStorage
// (`registros:hiddenCreateFields:<fonte>`), NUNCA no banco (padrão
// use-col-widths/comp-overview:group). A chave é por BASE, então a preferência
// vale em todas as superfícies do form (aba Registros, botão "+" do widget de
// tabela, quick-create do kanban). Valor = array de refs estáveis do form
// (`core__stage`…, `responsible_id`, `operation_id`, `custom__<field_key>`).
// Hidratação-safe: o SSR renderiza tudo visível e o localStorage entra
// pós-mount (flicker de um frame aceito); storage indisponível (modo privado)
// degrada para só-memória. Ref órfã (campo excluído do catálogo) fica dormindo
// no storage — quem renderiza a ignora.
"use client";

import { useEffect, useState } from "react";

function storageKeyFor(sourceKey: string): string {
  return `registros:hiddenCreateFields:${sourceKey}`;
}

function loadHidden(storageKey: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

function persist(storageKey: string, hidden: Set<string>) {
  try {
    if (hidden.size === 0) window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, JSON.stringify([...hidden]));
  } catch {
    // storage indisponível — segue só em memória
  }
}

export function useHiddenCreateFields(sourceKey: string): {
  isHidden: (fieldKey: string) => boolean;
  hideField: (fieldKey: string) => void;
  showField: (fieldKey: string) => void;
} {
  const storageKey = storageKeyFor(sourceKey);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // Carga pós-mount + recarga ao trocar de base (a chave muda). Leitura no
  // initializer causaria hydration mismatch (padrão use-col-widths).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHidden(loadHidden(storageKey));
  }, [storageKey]);

  function mutate(fieldKey: string, hide: boolean) {
    setHidden((cur) => {
      if (cur.has(fieldKey) === hide) return cur;
      const next = new Set(cur);
      if (hide) next.add(fieldKey);
      else next.delete(fieldKey);
      // Gravação imediata (conjunto pequeno; sem rajadas como o resize).
      persist(storageKey, next);
      return next;
    });
  }

  return {
    isHidden: (fieldKey) => hidden.has(fieldKey),
    hideField: (fieldKey) => mutate(fieldKey, true),
    showField: (fieldKey) => mutate(fieldKey, false),
  };
}
