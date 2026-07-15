// Versão: 1.0 | Data: 15/07/2026
// Contexto client dos rótulos de exibição das fontes (nomes curtos dos
// prefixos/chips nos dropdowns de campo + rótulo "Geral"). Carregados no
// servidor (lib/config/source-labels.ts) e providos em app/(app)/layout e no
// viewer de snapshots (app/s/[token]). Sem provider, valem os defaults.
"use client";

import { createContext, useContext } from "react";

import {
  DEFAULT_SOURCE_DISPLAY_LABELS,
  type SourceDisplayLabels,
} from "@/lib/sources";

const SourceLabelsContext = createContext<SourceDisplayLabels>(
  DEFAULT_SOURCE_DISPLAY_LABELS
);

export function SourceLabelsProvider({
  labels,
  children,
}: {
  labels: SourceDisplayLabels;
  children: React.ReactNode;
}) {
  return (
    <SourceLabelsContext.Provider value={labels}>
      {children}
    </SourceLabelsContext.Provider>
  );
}

export function useSourceLabels(): SourceDisplayLabels {
  return useContext(SourceLabelsContext);
}
