// Versão: 1.0 | Data: 15/07/2026
// Overlay de "desenhar para criar" (Tabela Livre): cobre o canvas do grid com
// cursor de mira; arrastar desenha um retângulo tracejado com um badge ao vivo
// "N linhas × M colunas" (derivadas do tamanho em px) e, ao soltar, entrega a
// posição em unidades do GRID (mesma matemática do onCanvasContextMenu do
// dashboard-grid) + as dimensões da tabela. Clique sem arrasto cria no tamanho
// padrão na célula clicada; Esc cancela. Puro de UI — quem cria o widget é o
// chamador (dashboard-client).
"use client";

import { useEffect, useRef, useState } from "react";

import type { GridPosition } from "@/lib/widgets/types";

// Derivação linhas×colunas da tabela a partir do retângulo em px: ~120px por
// coluna e ~32px por linha (descontado o cabeçalho ~36px), com limites sãos.
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
export function tableSizeFromPx(pxW: number, pxH: number): {
  rows: number;
  cols: number;
} {
  return {
    cols: clamp(Math.round(pxW / 120), 1, 12),
    rows: clamp(Math.round((pxH - 36) / 32), 1, 50),
  };
}

export function DrawToCreateOverlay({
  cellW,
  rowH,
  mx,
  my,
  cols,
  rows,
  onDone,
  onCancel,
}: {
  // Métricas de célula do grid (as mesmas do RGL) p/ converter px → unidades.
  cellW: number;
  rowH: number;
  mx: number;
  my: number;
  cols: number; // largura do canvas em colunas do grid
  rows: number; // altura do canvas em linhas do grid
  onDone: (rect: GridPosition, table: { rows: number; cols: number }) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);

  // Esc cancela a qualquer momento (inclusive no meio do arrasto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Posição do ponteiro relativa ao overlay (= ao canvas), presa aos limites.
  const localPoint = (e: React.PointerEvent): { x: number; y: number } => {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: clamp(e.clientX - r.left, 0, r.width),
      y: clamp(e.clientY - r.top, 0, r.height),
    };
  };

  // px → célula do grid (mesma fórmula do RGL/onCanvasContextMenu).
  const gridX = (px: number) =>
    clamp(Math.floor((px - mx) / (cellW + mx)), 0, cols - 1);
  const gridY = (px: number) =>
    clamp(Math.floor((px - my) / (rowH + my)), 0, rows - 1);

  function finish(d: { x0: number; y0: number; x1: number; y1: number }) {
    const pxW = Math.abs(d.x1 - d.x0);
    const pxH = Math.abs(d.y1 - d.y0);
    if (pxW < 8 && pxH < 8) {
      // Clique simples: tabela padrão 3×3 num widget 6×8 na célula clicada.
      const gx = gridX(Math.min(d.x0, d.x1));
      const gy = gridY(Math.min(d.y0, d.y1));
      onDone(
        { x: Math.min(gx, Math.max(0, cols - 6)), y: gy, w: 6, h: 8 },
        { rows: 3, cols: 3 }
      );
      return;
    }
    const gx0 = gridX(Math.min(d.x0, d.x1));
    const gy0 = gridY(Math.min(d.y0, d.y1));
    const gx1 = gridX(Math.max(d.x0, d.x1));
    const gy1 = gridY(Math.max(d.y0, d.y1));
    onDone(
      {
        x: gx0,
        y: gy0,
        w: Math.max(2, gx1 - gx0 + 1),
        h: Math.max(2, gy1 - gy0 + 1),
      },
      tableSizeFromPx(pxW, pxH)
    );
  }

  const rect = drag
    ? {
        left: Math.min(drag.x0, drag.x1),
        top: Math.min(drag.y0, drag.y1),
        width: Math.abs(drag.x1 - drag.x0),
        height: Math.abs(drag.y1 - drag.y0),
      }
    : null;
  const size = rect ? tableSizeFromPx(rect.width, rect.height) : null;

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-30 cursor-crosshair touch-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = localPoint(e);
        setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const p = localPoint(e);
        setDrag((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
      }}
      onPointerUp={(e) => {
        if (!drag) return;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // capture pode já ter sido liberada
        }
        const d = drag;
        setDrag(null);
        finish(d);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      {/* Dica no topo enquanto nada foi desenhado. */}
      {!drag ? (
        <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2">
          <span className="bg-background text-muted-foreground rounded-full border px-3 py-1.5 text-xs shadow-sm">
            Arraste para desenhar a Tabela Livre — Esc cancela
          </span>
        </div>
      ) : null}
      {rect ? (
        <div
          className="border-primary bg-primary/10 pointer-events-none absolute rounded-md border-2 border-dashed"
          style={rect}
        >
          <span className="bg-primary text-primary-foreground absolute -top-7 left-0 rounded px-2 py-0.5 text-xs whitespace-nowrap shadow">
            {size!.rows} linha{size!.rows === 1 ? "" : "s"} × {size!.cols}{" "}
            coluna{size!.cols === 1 ? "" : "s"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
