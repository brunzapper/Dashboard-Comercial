// Versão: 1.0 | Data: 17/09/2026
// O CARIMBO da Base manual dentro do painel: `max(updated_at)` + contagem das
// duas tabelas (lib/manual-base/load.loadManualBaseStamp), carregado pela page
// a cada render RSC.
//
// Ele existe porque o widget "Base do Dashboard" busca os próprios dados por
// action, e uma edição feita em OUTRO lugar (o painel do ⋮, o assistente de
// IA, outra pessoa) não teria como chegar até ele. Com o carimbo por props, o
// router.refresh() do save troca o valor e o widget re-busca — o mesmo
// mecanismo do fingerprint `deferredScopeById` dos widgets deferidos, e pelo
// mesmo motivo.
"use client";

import { createContext, useContext } from "react";

const ManualBaseStampContext = createContext<string>("");

export function ManualBaseStampProvider({
  stamp,
  children,
}: {
  stamp: string;
  children: React.ReactNode;
}) {
  return (
    <ManualBaseStampContext.Provider value={stamp}>
      {children}
    </ManualBaseStampContext.Provider>
  );
}

export function useManualBaseStamp(): string {
  return useContext(ManualBaseStampContext);
}
