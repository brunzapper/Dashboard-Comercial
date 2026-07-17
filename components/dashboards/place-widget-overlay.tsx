// Versão: 1.0 | Data: 17/07/2026
// Overlay do modo Posicionar: cobre o canvas com cursor de mira e um ghost
// tracejado do tamanho do widget (w×h em unidades do grid) seguindo o ponteiro,
// com o CENTRO ancorado na célula sob o cursor. Clique entrega a posição
// (centerAnchored, já em unidades do grid); Esc posiciona automaticamente
// (onCancel — o widget nunca se perde). Puro de UI — quem cria/posiciona é o
// chamador (dashboard-client), que já pré-criou o widget em segundo plano.
"use client";

import { useEffect, useRef, useState } from "react";

import type { GridPosition } from "@/lib/widgets/types";
import { centerAnchored } from "@/lib/widgets/grid-placement";

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

export function PlaceWidgetOverlay({
  cellW,
  rowH,
  mx,
  my,
  cols,
  rows,
  w,
  h,
  onPlace,
  onCancel,
}: {
  // Métricas de célula do grid (as mesmas do RGL) p/ converter px → unidades.
  cellW: number;
  rowH: number;
  mx: number;
  my: number;
  cols: number; // largura do canvas em colunas do grid
  rows: number; // altura do canvas em linhas do grid
  w: number; // tamanho do widget a posicionar (unidades do grid)
  h: number;
  onPlace: (pos: GridPosition) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<GridPosition | null>(null);

  // Esc = posicionar automaticamente (fallback), a qualquer momento.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Célula sob o ponteiro (mesma fórmula do RGL/onCanvasContextMenu) → posição
  // com o centro do widget ancorado nela.
  const posAt = (e: React.PointerEvent | React.MouseEvent): GridPosition => {
    const r = ref.current!.getBoundingClientRect();
    const px = clamp(e.clientX - r.left, 0, r.width);
    const py = clamp(e.clientY - r.top, 0, r.height);
    const gx = clamp(Math.floor((px - mx) / (cellW + mx)), 0, cols - 1);
    const gy = clamp(Math.floor((py - my) / (rowH + my)), 0, rows - 1);
    return centerAnchored(gx, gy, w, h, cols);
  };

  const ghost = pos
    ? {
        left: pos.x * (cellW + mx) + mx,
        top: pos.y * (rowH + my) + my,
        width: pos.w * cellW + (pos.w - 1) * mx,
        height: pos.h * rowH + (pos.h - 1) * my,
      }
    : null;

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-30 cursor-crosshair touch-none"
      onPointerMove={(e) => setPos(posAt(e))}
      onPointerLeave={() => setPos(null)}
      onPointerUp={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        onPlace(posAt(e));
      }}
    >
      <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2">
        <span className="bg-background text-muted-foreground rounded-full border px-3 py-1.5 text-xs shadow-sm">
          Clique para posicionar o widget — Esc posiciona automaticamente
        </span>
      </div>
      {ghost ? (
        <div
          className="border-primary bg-primary/10 pointer-events-none absolute rounded-md border-2 border-dashed"
          style={ghost}
        />
      ) : null}
    </div>
  );
}
