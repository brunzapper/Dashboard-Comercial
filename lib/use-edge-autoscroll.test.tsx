// @vitest-environment jsdom
// Versão: 1.0 | Data: 31/07/2026
// Testes do auto-scroll de borda: a velocidade pura (zonas/sinal/clamp) e o
// loop rAF do hook (dragover na zona rola; idle desliga; stop() é imediato).
// jsdom não tem layout: o rect do container é mockado e o rAF vem dos fake
// timers do vitest.
import { fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  edgeScrollVelocity,
  useEdgeAutoScroll,
} from "@/lib/use-edge-autoscroll";

describe("edgeScrollVelocity", () => {
  const edge = 56;
  const max = 640;
  it("zero no miolo do container", () => {
    expect(edgeScrollVelocity(200, 0, 400, edge, max)).toBe(0);
  });
  it("negativa na zona esquerda, positiva na direita", () => {
    expect(edgeScrollVelocity(10, 0, 400, edge, max)).toBeLessThan(0);
    expect(edgeScrollVelocity(390, 0, 400, edge, max)).toBeGreaterThan(0);
  });
  it("proporcional à penetração na zona", () => {
    const raso = edgeScrollVelocity(350, 0, 400, edge, max);
    const fundo = edgeScrollVelocity(395, 0, 400, edge, max);
    expect(fundo).toBeGreaterThan(raso);
  });
  it("clamp em ±maxSpeed, inclusive além dos limites", () => {
    expect(edgeScrollVelocity(-100, 0, 400, edge, max)).toBe(-max);
    expect(edgeScrollVelocity(900, 0, 400, edge, max)).toBe(max);
  });
  it("container estreito demais para as zonas não rola", () => {
    expect(edgeScrollVelocity(10, 0, 100, edge, max)).toBe(0);
  });
});

function Probe() {
  const ref = useRef<HTMLDivElement | null>(null);
  const { onDragOver, stop } = useEdgeAutoScroll(ref);
  return (
    <div>
      <div data-testid="scroller" ref={ref} onDragOver={onDragOver} />
      <button data-testid="stop" onClick={stop} />
    </div>
  );
}

function mountProbe() {
  const utils = render(<Probe />);
  const el = utils.getByTestId("scroller");
  el.getBoundingClientRect = () =>
    ({ left: 0, right: 400, top: 0, bottom: 300, width: 400, height: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return { ...utils, el };
}

// jsdom não tem DragEvent (o fireEvent.dragOver perderia o clientX); um
// MouseEvent nativo do tipo dragover chega ao onDragOver do React com as
// coordenadas intactas.
function dragOverAt(el: HTMLElement, clientX: number) {
  fireEvent(el, new MouseEvent("dragover", { clientX, bubbles: true, cancelable: true }));
}

describe("useEdgeAutoScroll", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "Date"],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dragover na zona direita rola para a direita a cada frame", () => {
    const { el } = mountProbe();
    dragOverAt(el, 390);
    vi.advanceTimersByTime(200);
    expect(el.scrollLeft).toBeGreaterThan(0);
  });

  it("dragover no miolo não rola", () => {
    const { el } = mountProbe();
    dragOverAt(el, 200);
    vi.advanceTimersByTime(200);
    expect(el.scrollLeft).toBe(0);
  });

  it("sem dragover novo o loop desliga após o idle", () => {
    const { el } = mountProbe();
    dragOverAt(el, 390);
    vi.advanceTimersByTime(400);
    const antesDoIdle = el.scrollLeft;
    expect(antesDoIdle).toBeGreaterThan(0);
    // Passa do idleMs (600) sem eventos: o loop para e o scroll congela.
    vi.advanceTimersByTime(1000);
    const congelado = el.scrollLeft;
    vi.advanceTimersByTime(500);
    expect(el.scrollLeft).toBe(congelado);
  });

  it("stop() para imediatamente", () => {
    const { el, getByTestId } = mountProbe();
    dragOverAt(el, 390);
    vi.advanceTimersByTime(100);
    fireEvent.click(getByTestId("stop"));
    const parado = el.scrollLeft;
    vi.advanceTimersByTime(200);
    expect(el.scrollLeft).toBe(parado);
  });

  it("desmontar no meio do drag não estoura", () => {
    const { el, unmount } = mountProbe();
    dragOverAt(el, 390);
    vi.advanceTimersByTime(50);
    unmount();
    expect(() => vi.advanceTimersByTime(200)).not.toThrow();
  });
});
