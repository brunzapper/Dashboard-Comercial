// Versão: 1.0 | Data: 03/10/2026
// Tooltip que só abre quando o texto NÃO cabe (reticências do `truncate` ou o
// corte do line-clamp). Nasceu para o nome de dashboard nos cards do Workspace
// (modo prévia corta em 2 linhas) e nos fixados da barra lateral (1 linha):
// com o nome inteiro visível, o tooltip só repetiria o que já está na tela.
//
// A medição é feita NA HORA de abrir (não em efeito/ResizeObserver): o corte
// depende da largura da coluna, do número de colunas do hub e do modo de
// exibição, e qualquer um deles muda sem remontar o card.
"use client";

import * as React from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Folga de 1px: arredondamento subpixel faz scrollWidth passar de clientWidth
// por uma fração em texto que cabe.
function overflows(el: Element): boolean {
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
}

/**
 * O texto do gatilho está cortado? Mede o próprio elemento E o pai: um link
 * inline (`<a>` dentro do título) tem clientWidth 0 e quem corta é o bloco que
 * o contém — no card do hub, o CardTitle com line-clamp.
 */
export function isTextTruncated(el: Element | null): boolean {
  if (!el) return false;
  if (overflows(el)) return true;
  const parent = el.parentElement;
  return parent ? overflows(parent) : false;
}

/**
 * Envolve UM elemento (via `asChild`) que exibe `text`. O elemento precisa
 * aceitar ref (Link, span, button…).
 */
export function OverflowTooltip({
  text,
  children,
  side = "top",
}: {
  text: string;
  children: React.ReactElement;
  side?: "top" | "right" | "bottom" | "left";
}) {
  // O Trigger do radix tipa a ref como <button>; com asChild ela aponta para
  // o elemento filho (link/span) — só lemos medidas de Element.
  const ref = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => setOpen(next && isTextTruncated(ref.current))}
    >
      <TooltipTrigger asChild ref={ref}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} className="break-words">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
