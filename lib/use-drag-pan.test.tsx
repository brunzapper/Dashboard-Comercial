// @vitest-environment jsdom
// Versão: 1.0 | Data: 31/07/2026
// Pan "mãozinha" + auto-scroll de borda (v1.1): arrastar além do limiar rola o
// container; com `edgeAutoScroll`, ponteiro PARADO na zona de borda continua
// rolando na direção do arrasto (loop rAF acumulando na base — pointermove
// posterior não faz snap-back) e pointerup congela; sem a opção, nada roda
// sozinho. jsdom sem PointerEvent: eventos são MouseEvent com type pointer*
// (o React roteia pelo type; o hook só lê clientX/clientY/button).
import { act, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDragPan } from "@/lib/use-drag-pan";

function Probe({ edge }: { edge?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { onPointerDown } = useDragPan(ref, {
    edgeAutoScroll: edge ? true : undefined,
  });
  return <div data-testid="scroller" ref={ref} onPointerDown={onPointerDown} />;
}

function mountProbe(edge?: boolean) {
  const utils = render(<Probe edge={edge} />);
  const el = utils.getByTestId("scroller");
  el.getBoundingClientRect = () =>
    ({ left: 0, right: 400, top: 0, bottom: 300, width: 400, height: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return { ...utils, el };
}

const down = (el: HTMLElement, x: number) =>
  act(() => {
    fireEvent(
      el,
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 10 })
    );
  });
const move = (x: number) =>
  act(() => {
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: 10 }));
  });
const up = () =>
  act(() => {
    window.dispatchEvent(new MouseEvent("pointerup", {}));
  });

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "Date"],
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useDragPan + edgeAutoScroll", () => {
  it("arrastar p/ a esquerda rola; parado na borda continua rolando; sem snap-back; pointerup congela", () => {
    const { el } = mountProbe(true);
    down(el, 300);
    // Arrasta até a borda esquerda: dx = -290 → scrollLeft = 290.
    move(10);
    expect(el.scrollLeft).toBe(290);

    // Ponteiro PARADO na zona: o loop rAF continua revelando a direita.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const auto = el.scrollLeft;
    expect(auto).toBeGreaterThan(290);

    // Pointermove no MESMO lugar parte da base acumulada (sem snap-back).
    move(10);
    expect(el.scrollLeft).toBeGreaterThanOrEqual(auto);

    // Solta: congela.
    up();
    const solto = el.scrollLeft;
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(el.scrollLeft).toBe(solto);
  });

  it("sem edgeAutoScroll, parado na borda NÃO rola sozinho", () => {
    const { el } = mountProbe(false);
    down(el, 300);
    move(10);
    expect(el.scrollLeft).toBe(290);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(el.scrollLeft).toBe(290);
    up();
  });

  it("no miolo do container o loop dorme", () => {
    const { el } = mountProbe(true);
    down(el, 300);
    move(200); // dx = -100 → 100; x=200 fora das zonas de 56px
    expect(el.scrollLeft).toBe(100);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(el.scrollLeft).toBe(100);
    up();
  });
});
