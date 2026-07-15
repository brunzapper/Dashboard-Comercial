// Versão: 1.0 | Data: 15/07/2026
// Contexto de "focar widget": formas e links de nota chamam useFocusWidget()
// para navegar até um widget-alvo (mesma aba, outra aba ou outro dashboard),
// centralizando-o na tela com um pulso de destaque. A implementação vive no
// shell (dashboard-client.tsx), que conhece as abas e o router.
"use client";

import { createContext, useContext } from "react";

import type { WidgetLinkTarget } from "@/lib/widgets/types";

type FocusFn = (target: WidgetLinkTarget) => void;

const FocusContext = createContext<FocusFn | null>(null);

export function WidgetFocusProvider({
  focus,
  children,
}: {
  focus: FocusFn;
  children: React.ReactNode;
}) {
  return <FocusContext.Provider value={focus}>{children}</FocusContext.Provider>;
}

// Fora do provider (ex.: preview isolado) o foco é um no-op silencioso.
export function useFocusWidget(): FocusFn {
  return useContext(FocusContext) ?? (() => {});
}
