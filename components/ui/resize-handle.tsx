// Versão: 1.0 | Data: 07/08/2026
// Alça de redimensionamento (largura de coluna / altura de linha) — extraída
// VERBATIM de components/dashboards/appearance-editing.tsx (que re-exporta;
// imports existentes seguem valendo) para reuso fora dos dashboards — a tabela
// de /registros usa nas colunas. Faixa fina posicionada na borda da célula,
// visível ao passar o mouse. Arrastar altera o tamanho: mede a célula-pai no
// início e `onResize` recebe o novo tamanho (px) a cada movimento.
"use client";

import { useRef } from "react";

import { cn } from "@/lib/utils";

export function ResizeHandle({
  axis,
  onResize,
  minSize = 40,
}: {
  axis: "col" | "row";
  onResize: (size: number) => void;
  minSize?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const dragRef = useRef<{ pos: number; size: number } | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Mede a célula/linha que contém a alça como tamanho inicial.
    const cell = ref.current?.parentElement as HTMLElement | null;
    const size = cell
      ? axis === "col"
        ? cell.offsetWidth
        : cell.offsetHeight
      : minSize;
    dragRef.current = { pos: axis === "col" ? e.clientX : e.clientY, size };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const delta = (axis === "col" ? e.clientX : e.clientY) - d.pos;
    onResize(Math.max(minSize, Math.round(d.size + delta)));
  }
  function endDrag(e: React.PointerEvent) {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // capture pode já ter sido liberada
    }
  }

  return (
    <span
      ref={ref}
      role="separator"
      aria-orientation={axis === "col" ? "vertical" : "horizontal"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={(e) => e.stopPropagation()}
      title={axis === "col" ? "Arraste para largura" : "Arraste para altura"}
      className={cn(
        "absolute z-10 opacity-0 transition-opacity hover:opacity-100",
        "before:absolute before:bg-primary/60 before:content-['']",
        axis === "col"
          ? "top-0 right-0 h-full w-2 cursor-col-resize before:top-0 before:right-0 before:h-full before:w-0.5"
          : "bottom-0 left-0 h-2 w-full cursor-row-resize before:bottom-0 before:left-0 before:h-0.5 before:w-full"
      )}
    />
  );
}
