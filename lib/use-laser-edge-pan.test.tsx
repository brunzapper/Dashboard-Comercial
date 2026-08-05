// @vitest-environment jsdom
// Versão: 1.0 | Data: 05/08/2026
// Auto-pan de borda do laser: sample na zona rola o eixo correspondente e
// CONTINUA rolando sem samples novos (sem idle — diferença deliberada do DnD);
// canto rola os dois eixos; miolo dorme com onSettle; stop() para na hora sem
// onSettle. jsdom não tem layout: rects mockados, scrollHeight definido à mão
// para o verticalScroller achar o "main" e o rAF vem dos fake timers.
import { act, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLaserEdgePan } from "@/lib/use-laser-edge-pan";

function Probe({
  onPan,
  onSettle,
}: {
  onPan?: () => void;
  onSettle?: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { onSample, stop } = useLaserEdgePan(ref, { onPan, onSettle });
  return (
    <div data-testid="main" style={{ overflowY: "auto" }}>
      <div
        data-testid="scroller"
        ref={ref}
        onPointerMove={(e) => onSample(e.clientX, e.clientY)}
      />
      <button data-testid="stop" onClick={() => stop()} />
    </div>
  );
}

const RECT = {
  left: 0,
  right: 400,
  top: 0,
  bottom: 300,
  width: 400,
  height: 300,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

function mountProbe(onPan?: () => void, onSettle?: () => void) {
  const utils = render(<Probe onPan={onPan} onSettle={onSettle} />);
  const el = utils.getByTestId("scroller");
  el.getBoundingClientRect = () => RECT;
  const main = utils.getByTestId("main");
  main.getBoundingClientRect = () => RECT;
  // scrollHeight > clientHeight (0 no jsdom) marca o "main" como rolável.
  Object.defineProperty(main, "scrollHeight", {
    value: 1000,
    configurable: true,
  });
  return { ...utils, el, main };
}

// jsdom sem PointerEvent: MouseEvent com type pointermove chega ao handler do
// React com clientX/Y intactos (mesmo truque de use-drag-pan.test.tsx).
function sampleAt(el: HTMLElement, clientX: number, clientY: number) {
  act(() => {
    fireEvent(
      el,
      new MouseEvent("pointermove", { clientX, clientY, bubbles: true })
    );
  });
}

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
      "setTimeout",
      "Date",
    ],
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useLaserEdgePan", () => {
  it("zona direita rola o scrollLeft e continua rolando sem samples novos", () => {
    const onPan = vi.fn();
    const { el } = mountProbe(onPan);
    sampleAt(el, 390, 150);
    advance(200);
    const parcial = el.scrollLeft;
    expect(parcial).toBeGreaterThan(0);
    expect(onPan).toHaveBeenCalled();
    // Sem idle: nenhum sample novo e o scroll segue crescendo.
    advance(300);
    expect(el.scrollLeft).toBeGreaterThan(parcial);
  });

  it("zona inferior rola o scrollTop do ancestral vertical", () => {
    const { el, main } = mountProbe();
    sampleAt(el, 200, 290);
    advance(200);
    expect(main.scrollTop).toBeGreaterThan(0);
    expect(el.scrollLeft).toBe(0);
  });

  it("canto rola os dois eixos (diagonal)", () => {
    const { el, main } = mountProbe();
    sampleAt(el, 390, 290);
    advance(200);
    expect(el.scrollLeft).toBeGreaterThan(0);
    expect(main.scrollTop).toBeGreaterThan(0);
  });

  it("no miolo não rola; sair da zona assenta com onSettle", () => {
    const onSettle = vi.fn();
    const { el } = mountProbe(undefined, onSettle);
    sampleAt(el, 200, 150);
    advance(200);
    expect(el.scrollLeft).toBe(0);
    expect(onSettle).not.toHaveBeenCalled(); // nunca rolou — nada a assentar

    sampleAt(el, 390, 150);
    advance(200);
    const rolado = el.scrollLeft;
    expect(rolado).toBeGreaterThan(0);
    sampleAt(el, 200, 150); // volta ao miolo com o loop vivo
    advance(100);
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(el.scrollLeft).toBe(rolado);
  });

  it("stop() para imediatamente e NÃO dispara onSettle", () => {
    const onSettle = vi.fn();
    const { el, getByTestId } = mountProbe(undefined, onSettle);
    sampleAt(el, 390, 150);
    advance(100);
    act(() => {
      fireEvent.click(getByTestId("stop"));
    });
    const parado = el.scrollLeft;
    advance(300);
    expect(el.scrollLeft).toBe(parado);
    expect(onSettle).not.toHaveBeenCalled();
  });

  it("desmontar no meio do pan não estoura", () => {
    const { el, unmount } = mountProbe();
    sampleAt(el, 390, 150);
    advance(50);
    unmount();
    expect(() => advance(300)).not.toThrow();
  });
});
