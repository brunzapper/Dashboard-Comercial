// Versão: 1.0 | Data: 05/08/2026
// Auto-pan de borda do Ponteiro Laser: com o modo apresentação ativo, aproximar
// o ponteiro das bordas/cantos da área visível rola a área de trabalho na
// direção da borda — os DOIS eixos: horizontal no container do grid
// (scrollRef), vertical no ancestral rolável (verticalScroller — no app, o
// <main> do AppShell). Alimentado por onSample (pointermove do overlay).
// DIFERENÇA deliberada do auto-scroll de DnD (use-edge-autoscroll): SEM timeout
// de idle — ponteiro PARADO na zona continua rolando (é o gesto: encostar na
// borda e esperar). O loop dorme só com as duas velocidades zeradas (onSettle;
// o próximo sample religa); stop() cancela na hora e NÃO dispara onSettle
// (leave/menu/unmount tratam o dwell por conta própria).
"use client";

import { useCallback, useEffect, useRef } from "react";

import { verticalScroller } from "@/lib/use-drag-pan";
import { edgeScrollVelocity } from "@/lib/use-edge-autoscroll";

// Estado mutável do loop (vive num ref — o pan não pode re-renderizar).
interface LaserPanState {
  scrollRef: React.RefObject<HTMLElement | null>;
  edge: number;
  maxSpeed: number;
  // Última posição do ponteiro (client): o loop rola a partir dela mesmo sem
  // pointermove novo.
  last: { x: number; y: number } | null;
  // Scroller vertical cacheado (resolvido no 1º tick; stop() limpa).
  v: HTMLElement | null;
  raf: number | null;
  prevTs: number | null;
  panningRef: { current: boolean };
  onPan?: () => void;
  onSettle?: () => void;
}

function panStop(st: LaserPanState) {
  if (st.raf != null) cancelAnimationFrame(st.raf);
  st.raf = null;
  st.prevTs = null;
  st.last = null;
  st.v = null;
  st.panningRef.current = false;
}

// O rect do <html> não é o viewport (top negativo com a página rolada); se o
// fallback do verticalScroller devolver o scroller do documento, os limites
// verticais são os da janela.
function verticalBounds(v: HTMLElement): { top: number; bottom: number } {
  if (v === document.scrollingElement || v === document.documentElement) {
    return { top: 0, bottom: window.innerHeight };
  }
  const r = v.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom };
}

function panTick(st: LaserPanState, ts: number) {
  st.raf = null;
  const el = st.scrollRef.current;
  if (!st.last || !el) {
    panStop(st);
    return;
  }
  const v = st.v ?? (st.v = verticalScroller(el));
  const hRect = el.getBoundingClientRect();
  const vb = verticalBounds(v);
  const vx = edgeScrollVelocity(
    st.last.x,
    hRect.left,
    hRect.right,
    st.edge,
    st.maxSpeed
  );
  const vy = edgeScrollVelocity(
    st.last.y,
    vb.top,
    vb.bottom,
    st.edge,
    st.maxSpeed
  );
  if (vx === 0 && vy === 0) {
    // Fora das zonas: dorme (o próximo sample religa) e devolve o dwell.
    st.prevTs = null;
    if (st.panningRef.current) {
      st.panningRef.current = false;
      st.onSettle?.();
    }
    return;
  }
  st.panningRef.current = true;
  const prev = st.prevTs;
  st.prevTs = ts;
  if (prev != null) {
    const dt = (ts - prev) / 1000;
    if (vx !== 0) el.scrollLeft += vx * dt;
    if (vy !== 0) v.scrollTop += vy * dt;
    st.onPan?.();
  }
  st.raf = requestAnimationFrame((t) => panTick(st, t));
}

export function useLaserEdgePan(
  scrollRef: React.RefObject<HTMLElement | null>,
  opts?: {
    edge?: number;
    maxSpeed?: number;
    /** A cada frame EM ZONA, depois de aplicar o scroll. */
    onPan?: () => void;
    /** Ao sair da zona naturalmente (loop dorme) — não dispara no stop(). */
    onSettle?: () => void;
  }
): {
  onSample: (clientX: number, clientY: number) => void;
  stop: () => void;
  panningRef: { current: boolean };
} {
  const edge = opts?.edge ?? 56;
  const maxSpeed = opts?.maxSpeed ?? 640;
  const { onPan, onSettle } = opts ?? {};
  const panningRef = useRef(false);

  const stRef = useRef<LaserPanState>({
    scrollRef,
    edge,
    maxSpeed,
    last: null,
    v: null,
    raf: null,
    prevTs: null,
    panningRef,
    onPan,
    onSettle,
  });

  const onSample = useCallback(
    (clientX: number, clientY: number) => {
      const st = stRef.current;
      // Opções/callbacks re-sincronizados fora do render (objeto do mount).
      st.edge = edge;
      st.maxSpeed = maxSpeed;
      st.onPan = onPan;
      st.onSettle = onSettle;
      st.last = { x: clientX, y: clientY };
      if (!st.scrollRef.current) return; // overlay sem container: inerte
      if (st.raf == null) st.raf = requestAnimationFrame((t) => panTick(st, t));
    },
    [edge, maxSpeed, onPan, onSettle]
  );

  const stop = useCallback(() => panStop(stRef.current), []);

  // Desmontar no meio (Esc/desativar o modo) não pode vazar o rAF.
  useEffect(() => stop, [stop]);

  return { onSample, stop, panningRef };
}
