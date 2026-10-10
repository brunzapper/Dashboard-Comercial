// Versão: 1.0 | Data: 10/10/2026
// v1.0 (10/10/2026): nome do objeto aberto (dashboard, kanban, formulário,
//   esquema) para a ÚLTIMA migalha da barra de local. Só a página conhece o
//   nome; ela o PUBLICA aqui e LIMPA no desmonte — sem limpar, o nome do
//   dashboard anterior apareceria por um instante na tela seguinte.
//   Fora do AppShell (prévia, snapshot) o hook vira no-op.
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface LocationTitle {
  title: string | null;
  setTitle: (t: string | null) => void;
}

const LocationTitleContext = createContext<LocationTitle | null>(null);

export function LocationTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  const value = useMemo(() => ({ title, setTitle }), [title]);
  return (
    <LocationTitleContext.Provider value={value}>
      {children}
    </LocationTitleContext.Provider>
  );
}

export function useLocationTitle(): string | null {
  return useContext(LocationTitleContext)?.title ?? null;
}

/** A página publica o próprio nome enquanto está montada. */
export function usePublishLocationTitle(title: string | null | undefined) {
  const setTitle = useContext(LocationTitleContext)?.setTitle;
  useEffect(() => {
    if (!setTitle) return;
    setTitle(title?.trim() ? title : null);
    return () => setTitle(null);
  }, [setTitle, title]);
}

/** Variante em componente — para páginas RSC publicarem sem virar client. */
export function PublishLocationTitle({ title }: { title: string | null }) {
  usePublishLocationTitle(title);
  return null;
}
