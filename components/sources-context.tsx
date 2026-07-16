// Versão: 1.0 | Data: 16/07/2026
// Contexto client do catálogo de fontes dinâmicas (data_sources). Carregado no
// servidor (lib/config/sources.ts) e provido em app/(app)/layout e no viewer
// de snapshots (app/s/[token]). Sem provider, valem os 3 builtins — mesmo
// padrão de components/source-labels-context.tsx.
"use client";

import { createContext, useContext } from "react";

import { BUILTIN_SOURCES, type SourceDef } from "@/lib/sources";

const SourcesContext = createContext<SourceDef[]>(BUILTIN_SOURCES);

export function SourcesProvider({
  sources,
  children,
}: {
  sources: SourceDef[];
  children: React.ReactNode;
}) {
  return (
    <SourcesContext.Provider value={sources}>
      {children}
    </SourcesContext.Provider>
  );
}

export function useSources(): SourceDef[] {
  return useContext(SourcesContext);
}
