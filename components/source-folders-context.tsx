// Versão: 1.0 | Data: 26/07/2026
// Contexto client das PASTAS DE BASES (source_folders, 0107). Carregado no
// servidor (lib/config/source-folders.ts) e provido em app/(app)/layout —
// pastas são globais da org, então o provider do layout serve também os
// boards/kanbans (que re-provêem SÓ o SourcesProvider com o catálogo
// escopado): o agrupamento acontece no CONSUMIDOR via
// groupSourcesByFolder(useSourceFolders(), useSources()), e pasta esvaziada
// pelo escopo some porque o helper omite grupos vazios. Sem provider (viewer
// público /s/[token]), vale [] — nenhuma pasta, UI degrada para listas
// planas. Mesmo padrão de components/sources-context.tsx.
"use client";

import { createContext, useContext } from "react";

import type { SourceFolder } from "@/lib/source-folders";

const SourceFoldersContext = createContext<SourceFolder[]>([]);

export function SourceFoldersProvider({
  folders,
  children,
}: {
  folders: SourceFolder[];
  children: React.ReactNode;
}) {
  return (
    <SourceFoldersContext.Provider value={folders}>
      {children}
    </SourceFoldersContext.Provider>
  );
}

export function useSourceFolders(): SourceFolder[] {
  return useContext(SourceFoldersContext);
}
