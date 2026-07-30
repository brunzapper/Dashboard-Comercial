// Versão: 1.1 | Data: 30/07/2026
// v1.1 (30/07/2026): reimplementado sobre o HelpHint genérico (components/ui) —
//   mesmo visual, menos um molde duplicado de popover "?".
// Popover "?" que explica os três escopos de fonte que convivem numa métrica
// calculada — fonte do WIDGET (linhas), fontes da MÉTRICA (universo do
// cálculo) e @fonte no OPERANDO (recorte de um operando só). É o jargão mais
// confuso do editor de fórmulas; este hint é reutilizado no builder de
// widgets (MetricRow/widget calculado) e nos editores de campos calculados.
"use client";

import { HelpHint } from "@/components/ui/help-hint";

export function SourceConceptsHint({ className }: { className?: string }) {
  return (
    <HelpHint
      ariaLabel="Como as bases afetam o cálculo"
      title="Três escopos de base convivem aqui:"
      className={className}
    >
      <p>
        <strong>Bases do widget</strong> — de onde vêm as linhas e os
        registros exibidos (e as dimensões).
      </p>
      <p>
        <strong>Bases da métrica</strong> — sobre quais bases ESTA
        métrica é calculada. Pode ampliar ou restringir em relação ao
        widget (ex.: linhas só de Deals, métrica contando Leads e Deals).
        Nenhuma marcada = as bases do widget.
      </p>
      <p>
        <strong>Base no operando</strong> — dentro da fórmula, um operando
        &quot;Contagem · Leads&quot; recorta SÓ aquele operando para a
        fonte, permitindo razões entre fontes (ex.: Contagem de Deals ÷
        Contagem de Leads = conversão).
      </p>
    </HelpHint>
  );
}
