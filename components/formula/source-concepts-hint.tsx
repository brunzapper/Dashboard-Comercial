// Versão: 1.0 | Data: 20/07/2026
// Popover "?" que explica os três escopos de fonte que convivem numa métrica
// calculada — fonte do WIDGET (linhas), fontes da MÉTRICA (universo do
// cálculo) e @fonte no OPERANDO (recorte de um operando só). É o jargão mais
// confuso do editor de fórmulas; este hint é reutilizado no builder de
// widgets (MetricRow/widget calculado) e nos editores de campos calculados.
"use client";

import { CircleHelp } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function SourceConceptsHint({ className }: { className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center",
            className
          )}
          aria-label="Como as fontes afetam o cálculo"
        >
          <CircleHelp className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="flex flex-col gap-2 text-xs">
          <p className="font-medium">Três escopos de fonte convivem aqui:</p>
          <p>
            <strong>Fontes do widget</strong> — de onde vêm as linhas e os
            registros exibidos (e as dimensões).
          </p>
          <p>
            <strong>Fontes da métrica</strong> — sobre quais fontes ESTA
            métrica é calculada. Pode ampliar ou restringir em relação ao
            widget (ex.: linhas só de Deals, métrica contando Leads e Deals).
            Nenhuma marcada = as fontes do widget.
          </p>
          <p>
            <strong>Fonte no operando</strong> — dentro da fórmula, um operando
            &quot;Contagem · Leads&quot; recorta SÓ aquele operando para a
            fonte, permitindo razões entre fontes (ex.: Contagem de Deals ÷
            Contagem de Leads = conversão).
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
