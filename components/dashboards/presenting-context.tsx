"use client";
// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): sinal "o dashboard está sendo APRESENTADO" — separado de
//   BoardChrome.hideWidgetMenus, que também liga no modo tela cheia do app (lá
//   a pessoa segue trabalhando; aqui é palco). Os widgets usam para esconder o
//   que é interface de TRABALHO: diagnósticos de configuração ("Responsável não
//   encontrado"), barras de ferramenta, botões de adicionar, formulários de
//   lançamento e os widgets marcados `hideInPresentation`.
//   Default false: fora da apresentação nada muda.
import { createContext, useContext } from "react";

const PresentingContext = createContext(false);

export function PresentingProvider({
  value,
  children,
}: {
  value: boolean;
  children: React.ReactNode;
}) {
  return (
    <PresentingContext.Provider value={value}>
      {children}
    </PresentingContext.Provider>
  );
}

export function usePresenting(): boolean {
  return useContext(PresentingContext);
}
