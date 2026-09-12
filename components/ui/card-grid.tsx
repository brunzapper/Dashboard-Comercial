// Versão: 2.0 | Data: 12/09/2026
// Disposição dos cards do hub e do painel de Operação: GRADE (com número de
// colunas configurável) ou LISTA. Componente único — a string
// "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" estava repetida três vezes na
// Home e ia virar a quarta no painel de Operação.
//
// v2.0 (12/09/2026): `cardHeight` (altura MÍNIMA do card, 0 = automática) —
// em lista o card nasce de uma linha só e ficava fino demais para quem usa o
// hub como tela de trabalho. Desce por variável CSS para os cards, que a
// aplicam como min-height.
//
// O número de colunas entra por `style`, NUNCA por classe: `grid-cols-${n}` não
// existe no CSS gerado (Tailwind v4 varre o fonte em busca de classes literais),
// então a classe dinâmica sairia sem regra nenhuma e a grade colapsaria em uma
// coluna. `columns` é o TETO em telas largas; abaixo de `lg` o limite é 2 e
// abaixo de `sm` é sempre 1 — número de colunas é escolha de conforto em tela
// grande, não uma promessa de espremer 6 cards num celular.
import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { HubLayout } from "@/lib/config/ui-prefs";

export function CardGrid({
  layout,
  columns,
  cardHeight = 0,
  className,
  children,
}: {
  layout: HubLayout;
  columns: number;
  cardHeight?: number;
  className?: string;
  children: ReactNode;
}) {
  // `--hub-card-h` é lido pelos cards (min-height). Ausente = altura natural.
  const heightVar: Record<string, string> =
    cardHeight > 0 ? { "--hub-card-h": `${cardHeight}px` } : {};

  if (layout === "list") {
    return (
      <div
        className={cn("flex flex-col gap-2", className)}
        style={heightVar as unknown as CSSProperties}
      >
        {children}
      </div>
    );
  }
  return (
    <div
      className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", className)}
      // `--hub-cols` vira o teto a partir de `lg` (regra em globals.css); as
      // duas faixas menores continuam decididas pelas classes acima.
      style={
        {
          "--hub-cols": String(columns),
          ...heightVar,
        } as unknown as CSSProperties
      }
      data-hub-grid
    >
      {children}
    </div>
  );
}
