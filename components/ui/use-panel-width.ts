// Versão: 1.0 | Data: 30/07/2026
// Largura persistida de painel lateral redimensionável pela borda esquerda.
// Padrão extraído do widget-builder (pointer capture; clamp min→95vw; grava no
// localStorage só no fim do arrasto). Chrome de UI por usuário — nunca dado.
"use client";

import { useEffect, useRef, useState } from "react";

// Puro (unit-testável): painel abre à direita, então o teto é 95% da viewport.
export function clampPanelWidth(
  width: number,
  min: number,
  viewportWidth: number
): number {
  return Math.min(
    Math.round(viewportWidth * 0.95),
    Math.max(min, Math.round(width))
  );
}

export interface PanelResizeHandleProps {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
}

export function usePanelWidth(
  storageKey: string,
  defaultWidth: number,
  opts?: { min?: number }
): { width: number; handleProps: PanelResizeHandleProps } {
  const min = opts?.min ?? 320;
  const [width, setWidth] = useState(defaultWidth);
  useEffect(() => {
    const saved = Number(
      typeof window !== "undefined"
        ? window.localStorage.getItem(storageKey)
        : ""
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (Number.isFinite(saved) && saved >= min) setWidth(saved);
  }, [storageKey, min]);

  const dragRef = useRef<{ x: number; w: number } | null>(null);
  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    dragRef.current = { x: e.clientX, w: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    // Painel abre à direita: arrastar para a ESQUERDA (delta negativo) aumenta.
    setWidth(
      clampPanelWidth(
        d.w - (e.clientX - d.x),
        min,
        typeof window !== "undefined" ? window.innerWidth : 1280
      )
    );
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    if (typeof window !== "undefined")
      window.localStorage.setItem(storageKey, String(width));
  }

  return {
    width,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
