// Versão: 1.0 | Data: 01/10/2026
// PRÉ-RENDER do modo Apresentar: ao entrar no modo, TODOS os slides montam de
// uma vez (os que não estão na tela ficam invisíveis, mas medidos), e a
// apresentação só começa quando eles estão prontos. Assim passar a página é
// trocar de camada — sem esperar dado chegar nem gráfico desenhar.
//
// Quem avisa prontidão é o widget que busca os PRÓPRIOS dados depois de montar
// (Tabela de metas, Tree…) — `useWarmupReady(id, pronto)`. Os gráficos do
// engine chegam no lote único da página e o shell já sabe quando ele está a
// caminho. Fora do modo (sem provider) o hook é um no-op: nenhum widget muda
// de comportamento.
"use client";

import { createContext, useContext, useEffect } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { WarmupState } from "@/lib/dashboards/presentation";

/** `null` = o widget saiu (desmontou) — deixa de contar. */
type Report = (id: string, ready: boolean | null) => void;

const WarmupContext = createContext<Report | null>(null);

export function PresentationWarmupProvider({
  report,
  children,
}: {
  report: Report;
  children: React.ReactNode;
}) {
  return <WarmupContext.Provider value={report}>{children}</WarmupContext.Provider>;
}

/** O widget avisa se já tem o que mostrar. No-op fora do modo Apresentar. */
export function useWarmupReady(id: string | null | undefined, ready: boolean) {
  const report = useContext(WarmupContext);
  useEffect(() => {
    if (id) report?.(id, ready);
  }, [report, id, ready]);
  useEffect(() => () => {
    if (id) report?.(id, null);
  }, [report, id]);
}

/** Tela de espera enquanto os slides preparam (com saída e atalho). */
export function PresentationWarmupOverlay({
  state,
  slides,
  onStartNow,
  onCancel,
}: {
  state: WarmupState;
  slides: number;
  onStartNow: () => void;
  onCancel: () => void;
}) {
  const pct = state.total > 0 ? Math.round((state.ready / state.total) * 100) : 0;
  return (
    <div
      className="bg-background fixed inset-0 z-[70] flex flex-col items-center justify-center gap-4 p-6 text-center"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="text-muted-foreground size-8 animate-spin" />
      <div className="flex flex-col gap-1">
        <p className="text-lg font-medium">Preparando a apresentação…</p>
        <p className="text-muted-foreground text-sm">
          {slides} {slides === 1 ? "slide" : "slides"} carregando de uma vez, para que passar
          de página seja instantâneo.
        </p>
      </div>
      {state.total > 0 ? (
        <div className="flex w-64 flex-col gap-1">
          <div className="bg-muted h-1.5 overflow-hidden rounded-full">
            <div className="bg-primary h-full transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-muted-foreground text-xs tabular-nums">
            {state.ready} de {state.total} quadros prontos
          </span>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button size="sm" onClick={onStartNow}>
          Começar agora
        </Button>
      </div>
    </div>
  );
}
