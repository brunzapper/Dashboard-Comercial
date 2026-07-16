// Versão: 1.0 | Data: 16/07/2026
// Hook de pan ("mãozinha"): segurar o botão esquerdo e arrastar rola o
// container horizontal passado em `scrollRef` e o ancestral rolável vertical
// (no app, o <main> do AppShell). Extraído do DashboardGrid para reuso na
// tabela de Registros; comportamento idêntico ao original.
"use client";

import { useEffect, useRef, useState } from "react";

// Sobe do elemento até o ancestral que rola verticalmente (no app é o
// <main className="flex-1 overflow-auto">). Fallback para o scroller do
// documento caso, em algum layout, quem role seja a própria janela.
function verticalScroller(from: HTMLElement): HTMLElement {
  let el: HTMLElement | null = from;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight)
      return el;
    el = el.parentElement;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

// IMPORTANTE: NÃO usamos setPointerCapture. A captura no elemento roubava o
// ponteiro de eventos disparados por outros layers (ex.: ao abrir o Sheet de
// "Editar dados"/"Aparência" a partir do menu do widget, um pointerdown caía
// no canvas vazio, capturava o ponteiro e impedia o painel de montar). Em vez
// disso ouvimos pointermove/up no `window` e só engatamos o pan após um limiar
// de arraste (~4px), então um clique simples nunca inicia o pan.
export function useDragPan(
  scrollRef: React.RefObject<HTMLElement | null>,
  opts?: {
    // Alvos que não devem armar o pan (widgets, controles interativos etc.).
    ignore?: (target: HTMLElement) => boolean;
  }
) {
  // Refs para não re-renderizar a cada movimento; `panning` só troca o
  // cursor/seleção.
  const panRef = useRef<{
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
    v: HTMLElement;
    engaged: boolean;
  } | null>(null);
  const [panning, setPanning] = useState(false);
  // Um AbortController por gesto: os listeners de window são registrados com o
  // `signal` e removidos de uma vez por `abort()` (no fim do gesto ou ao
  // desmontar). Evita recriar/rastrear identidades de handler.
  const panAbortRef = useRef<AbortController | null>(null);

  // Segurança: encerra o gesto (remove os listeners) se desmontar no meio.
  useEffect(() => () => panAbortRef.current?.abort(), []);

  // Enquanto arrasta: cursor "fechado" e sem seleção de texto em toda a página.
  // O cleanup restaura mesmo se o componente desmontar no meio do gesto.
  useEffect(() => {
    if (!panning) return;
    const { body } = document;
    const prevCursor = body.style.cursor;
    const prevSelect = body.style.userSelect;
    body.style.cursor = "grabbing";
    body.style.userSelect = "none";
    return () => {
      body.style.cursor = prevCursor;
      body.style.userSelect = prevSelect;
    };
  }, [panning]);

  // Botão esquerdo arma o pan (a rolagem só engata após o limiar no
  // pointermove). Só mouse/caneta — o toque mantém a rolagem nativa.
  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === "touch" || e.button !== 0) return;
    if (opts?.ignore?.(e.target as HTMLElement)) return;
    const sc = scrollRef.current;
    if (!sc) return;
    const v = verticalScroller(sc);
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: sc.scrollLeft,
      scrollTop: v.scrollTop,
      v,
      engaged: false,
    };
    const ac = new AbortController();
    panAbortRef.current = ac;
    const { signal } = ac;
    const end = () => {
      panRef.current = null;
      setPanning(false);
      ac.abort();
    };
    window.addEventListener(
      "pointermove",
      (ev) => {
        const p = panRef.current;
        if (!p) return;
        const dx = ev.clientX - p.startX;
        const dy = ev.clientY - p.startY;
        if (!p.engaged) {
          if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return; // ainda é um clique
          p.engaged = true;
          setPanning(true);
        }
        if (scrollRef.current) scrollRef.current.scrollLeft = p.scrollLeft - dx;
        p.v.scrollTop = p.scrollTop - dy;
      },
      { signal }
    );
    window.addEventListener("pointerup", end, { signal });
    window.addEventListener("pointercancel", end, { signal });
  }

  return { panning, onPointerDown };
}
