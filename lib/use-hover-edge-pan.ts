// Versão: 1.2 | Data: 01/09/2026
// Auto-pan de borda por HOVER: aproximar o ponteiro (sem botão pressionado)
// das bordas/cantos da área visível rola a área de trabalho na direção da
// borda — os DOIS eixos: horizontal no container do grid (scrollRef), vertical
// no ancestral rolável (verticalScroller — no app, o <main> do AppShell).
// Alimentado por onSample (pointermove do chamador). DIFERENÇA deliberada do
// auto-scroll de DnD (use-edge-autoscroll): SEM timeout de idle — ponteiro
// PARADO na zona continua rolando (é o gesto: encostar na borda e esperar).
// O loop dorme só com as duas velocidades zeradas (onSettle; o próximo sample
// religa); stop() cancela na hora e NÃO dispara onSettle (leave/menu/unmount
// tratam as consequências por conta própria).
// Consumidores: LaserPointerOverlay (engate imediato — no modo apresentação o
// gesto é deliberado) e o canvas do DashboardGrid (com engageMs — ver v1.1).
// v1.1 (05/08/2026): renomeado de use-laser-edge-pan (o gesto passou a valer
//   também FORA do laser) + opção `engageMs`: o scroll só engata depois de o
//   ponteiro acumular engageMs contínuos em zona — atravessar a zona ao sair
//   do canvas (ir ao menu lateral/outra janela) não dá "chute" de scroll.
//   panningRef/onPan só valem a partir do engate; default 0 (laser intocado).
// v1.2 (01/09/2026): opção `shouldPan` — predicado consultado A CADA TICK
//   (não só no sample): false = trata como FORA da zona (dorme, zera o
//   engate, assenta se estava rolando). Existe porque o hook NÃO tem idle:
//   um modal Radix aberto sobre um ponteiro PARADO em zona põe
//   `pointer-events: none` no body, então nunca mais chega pointermove nem
//   pointerleave e o rAF rolaria para sempre por baixo do painel. Ausente =
//   comportamento byte-idêntico ao da v1.1 (laser e Registros intocados).
"use client";

import { useCallback, useEffect, useRef } from "react";

import { verticalScroller } from "@/lib/use-drag-pan";
import { edgeScrollVelocity } from "@/lib/use-edge-autoscroll";

// Estado mutável do loop (vive num ref — o pan não pode re-renderizar).
interface HoverPanState {
  scrollRef: React.RefObject<HTMLElement | null>;
  edge: number;
  maxSpeed: number;
  engageMs: number;
  // Última posição do ponteiro (client): o loop rola a partir dela mesmo sem
  // pointermove novo.
  last: { x: number; y: number } | null;
  // Scroller vertical cacheado (resolvido no 1º tick; stop() limpa).
  v: HTMLElement | null;
  raf: number | null;
  prevTs: number | null;
  // Timestamp (rAF) da ENTRADA na zona — base da espera de engate.
  zoneSince: number | null;
  panningRef: { current: boolean };
  shouldPan?: (clientX: number, clientY: number) => boolean;
  onPan?: () => void;
  onSettle?: () => void;
}

function panStop(st: HoverPanState) {
  if (st.raf != null) cancelAnimationFrame(st.raf);
  st.raf = null;
  st.prevTs = null;
  st.zoneSince = null;
  st.last = null;
  st.v = null;
  st.panningRef.current = false;
}

// Dorme o loop mantendo `last` (o próximo sample religa): fora das zonas ou
// com o gate `shouldPan` negando. Assenta só quem chegou a rolar de fato.
function panSleep(st: HoverPanState) {
  st.prevTs = null;
  st.zoneSince = null;
  if (st.panningRef.current) {
    st.panningRef.current = false;
    st.onSettle?.();
  }
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

function panTick(st: HoverPanState, ts: number) {
  st.raf = null;
  const el = st.scrollRef.current;
  if (!st.last || !el) {
    panStop(st);
    return;
  }
  // Gate do chamador (v1.2): ponteiro que não está mais DIRETAMENTE sobre a
  // área de trabalho (painel/menu portado por cima, widget sob o cursor) é
  // tratado como fora da zona — sem isso o loop rolaria por baixo do painel.
  if (st.shouldPan && !st.shouldPan(st.last.x, st.last.y)) {
    panSleep(st);
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
    // Fora das zonas: dorme (o próximo sample religa), reseta o engate e
    // avisa quem rolou de fato.
    panSleep(st);
    return;
  }
  // Em zona mas ainda dentro da espera de engate: segue armado sem rolar
  // (travessia rápida da zona nunca chega a engatar).
  if (st.zoneSince == null) st.zoneSince = ts;
  if (ts - st.zoneSince < st.engageMs) {
    st.prevTs = null;
    st.raf = requestAnimationFrame((t) => panTick(st, t));
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

export function useHoverEdgePan(
  scrollRef: React.RefObject<HTMLElement | null>,
  opts?: {
    edge?: number;
    maxSpeed?: number;
    /** Tempo contínuo em zona antes de o scroll engatar (default 0). */
    engageMs?: number;
    /**
     * Consultado a CADA tick com a última posição do ponteiro: false = trata
     * como fora da zona (dorme, zera o engate). Ausente = sempre permitido.
     */
    shouldPan?: (clientX: number, clientY: number) => boolean;
    /** A cada frame EM ZONA (já engatado), depois de aplicar o scroll. */
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
  const engageMs = opts?.engageMs ?? 0;
  const { shouldPan, onPan, onSettle } = opts ?? {};
  const panningRef = useRef(false);

  const stRef = useRef<HoverPanState>({
    scrollRef,
    edge,
    maxSpeed,
    engageMs,
    last: null,
    v: null,
    raf: null,
    prevTs: null,
    zoneSince: null,
    panningRef,
    shouldPan,
    onPan,
    onSettle,
  });

  const onSample = useCallback(
    (clientX: number, clientY: number) => {
      const st = stRef.current;
      // Opções/callbacks re-sincronizados fora do render (objeto do mount).
      st.edge = edge;
      st.maxSpeed = maxSpeed;
      st.engageMs = engageMs;
      st.shouldPan = shouldPan;
      st.onPan = onPan;
      st.onSettle = onSettle;
      st.last = { x: clientX, y: clientY };
      if (!st.scrollRef.current) return; // chamador sem container: inerte
      if (st.raf == null) st.raf = requestAnimationFrame((t) => panTick(st, t));
    },
    [edge, maxSpeed, engageMs, shouldPan, onPan, onSettle]
  );

  const stop = useCallback(() => panStop(stRef.current), []);

  // Desmontar no meio não pode vazar o rAF.
  useEffect(() => stop, [stop]);

  return { onSample, stop, panningRef };
}
