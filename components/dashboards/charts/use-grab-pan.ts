// Versão: 1.0 | Data: 11/10/2026
// v1.0 (11/10/2026): PAN com a mão num contêiner rolável — usado pela Tree em
//   modo Apresentar: as barras de rolagem somem (classe `GRAB_PAN_CLASS`) e o
//   conteúdo que não cabe se move segurando e arrastando (cursor de mão). A
//   roda do mouse continua rolando. Controles (botão, campo, link) não iniciam
//   o arrasto.
"use client";

import { useEffect, type RefObject } from "react";

/** Esconde as barras de rolagem sem tirar a rolagem. */
export const GRAB_PAN_CLASS =
  "cursor-grab active:cursor-grabbing [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

const CONTROLS = "button, input, textarea, select, a, [role='menuitem'], [role='checkbox'], [data-no-drag]";

export function useGrabPan(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let start: { id: number; x: number; y: number; left: number; top: number } | null = null;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(CONTROLS)) return;
      start = { id: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
      el.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!start || start.id !== e.pointerId) return;
      el.scrollLeft = start.left - (e.clientX - start.x);
      el.scrollTop = start.top - (e.clientY - start.y);
    };
    const up = (e: PointerEvent) => {
      if (!start || start.id !== e.pointerId) return;
      start = null;
      el.releasePointerCapture?.(e.pointerId);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [ref, enabled]);
}
