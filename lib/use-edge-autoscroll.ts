// Versão: 1.0 | Data: 31/07/2026
// Auto-scroll de borda para drag HTML5: enquanto um drag (card/coluna do
// kanban) paira perto da borda esquerda/direita do container rolável, um loop
// rAF rola na direção da borda com velocidade proporcional à penetração na
// zona. Alimentado pelos eventos `dragover` do container (DnD nativo não emite
// pointermove) — o handler NUNCA chama preventDefault/stopPropagation: quem
// habilita o drop segue sendo o dragover por coluna. O loop se auto-desliga
// quando o dragover para de chegar (idle — drag encerrado fora da janela/Esc);
// os call sites também chamam stop() nos dragend/drop para parada imediata.
"use client";

import { useCallback, useEffect, useRef } from "react";

// Velocidade horizontal (px/s) para a posição `x` do ponteiro num container
// [left, right] com zonas de borda de `edge`px. 0 fora das zonas; negativa =
// rolar para a esquerda; proporcional à penetração; clamp em ±maxSpeed
// (inclusive para x além dos limites — arrastar "para fora" rola no máximo).
export function edgeScrollVelocity(
  x: number,
  left: number,
  right: number,
  edge: number,
  maxSpeed: number
): number {
  if (edge <= 0 || right - left <= 2 * edge) return 0;
  const fromLeft = x - left;
  const fromRight = right - x;
  if (fromLeft < edge) {
    const depth = Math.min(1, (edge - fromLeft) / edge);
    return -maxSpeed * depth;
  }
  if (fromRight < edge) {
    const depth = Math.min(1, (edge - fromRight) / edge);
    return maxSpeed * depth;
  }
  return 0;
}

// Estado mutável do loop (vive num ref — o drag não pode re-renderizar).
interface EdgeState {
  scrollRef: React.RefObject<HTMLElement | null>;
  edge: number;
  maxSpeed: number;
  idleMs: number;
  last: { x: number; at: number } | null;
  raf: number | null;
  prevTs: number | null;
}

function edgeStop(st: EdgeState) {
  if (st.raf != null) cancelAnimationFrame(st.raf);
  st.raf = null;
  st.prevTs = null;
  st.last = null;
}

function edgeTick(st: EdgeState, ts: number) {
  st.raf = null;
  const el = st.scrollRef.current;
  if (!st.last || !el) {
    edgeStop(st);
    return;
  }
  if (performance.now() - st.last.at > st.idleMs) {
    edgeStop(st);
    return;
  }
  const prev = st.prevTs;
  st.prevTs = ts;
  if (prev != null) {
    const rect = el.getBoundingClientRect();
    const v = edgeScrollVelocity(
      st.last.x,
      rect.left,
      rect.right,
      st.edge,
      st.maxSpeed
    );
    if (v === 0) {
      // Fora da zona: dorme; o próximo dragover religa o loop.
      st.prevTs = null;
      return;
    }
    el.scrollLeft += (v * (ts - prev)) / 1000;
  }
  st.raf = requestAnimationFrame((t) => edgeTick(st, t));
}

export function useEdgeAutoScroll(
  scrollRef: React.RefObject<HTMLElement | null>,
  opts?: { edge?: number; maxSpeed?: number; idleMs?: number }
): { onDragOver: (e: React.DragEvent) => void; stop: () => void } {
  const edge = opts?.edge ?? 56;
  const maxSpeed = opts?.maxSpeed ?? 640;
  // `dragover` refere periodicamente (~350ms) mesmo com o ponteiro parado,
  // então o idle precisa de folga para não gaguejar; é só o fallback — os
  // call sites param explicitamente em dragend/drop.
  const idleMs = opts?.idleMs ?? 600;

  const stRef = useRef<EdgeState>({
    scrollRef,
    edge,
    maxSpeed,
    idleMs,
    last: null,
    raf: null,
    prevTs: null,
  });

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      const st = stRef.current;
      // Opções re-sincronizadas fora do render (o objeto do ref é o do mount).
      st.edge = edge;
      st.maxSpeed = maxSpeed;
      st.idleMs = idleMs;
      st.last = { x: e.clientX, at: performance.now() };
      if (st.raf == null) st.raf = requestAnimationFrame((t) => edgeTick(st, t));
    },
    [edge, maxSpeed, idleMs]
  );

  const stop = useCallback(() => edgeStop(stRef.current), []);

  // Desmontar no meio de um drag não pode vazar o rAF.
  useEffect(() => stop, [stop]);

  return { onDragOver, stop };
}
