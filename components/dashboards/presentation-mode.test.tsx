// @vitest-environment jsdom
// Versão: 1.0 | Data: 02/10/2026
// Barra do modo Apresentar (v1.3): some após 2 s sem interação e só volta com
// o ponteiro 1 s perto da borda de baixo; "Exportar PDF" saiu dela.
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BAR_HIDE_AFTER_MS,
  BAR_REVEAL_AFTER_MS,
  PresentationBar,
} from "./presentation-mode";

function bar() {
  return screen.getByRole("button", { name: "Sair da apresentação", hidden: true }).parentElement!;
}

function move(y: number) {
  act(() => {
    window.dispatchEvent(new MouseEvent("pointermove", { clientY: y }) as PointerEvent);
  });
}

describe("PresentationBar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  });
  afterEach(() => vi.useRealTimers());

  const props = {
    slideIds: ["a", "b"],
    currentId: "a",
    title: "Capa",
    onSelect: () => {},
    onExit: () => {},
    laserMode: false,
    onLaserChange: () => {},
  };

  it("não tem mais o botão de PDF", () => {
    render(<PresentationBar {...props} />);
    expect(screen.queryByRole("button", { name: "Exportar PDF" })).toBeNull();
  });

  it("some após 2 s e volta só com 1 s de proximidade", () => {
    render(<PresentationBar {...props} />);
    expect(bar()).toHaveAttribute("data-visible");
    act(() => vi.advanceTimersByTime(BAR_HIDE_AFTER_MS + 10));
    expect(bar()).not.toHaveAttribute("data-visible");

    // Passar perto e sair antes de 1 s não revela.
    move(790);
    act(() => vi.advanceTimersByTime(BAR_REVEAL_AFTER_MS / 2));
    move(100);
    act(() => vi.advanceTimersByTime(BAR_REVEAL_AFTER_MS));
    expect(bar()).not.toHaveAttribute("data-visible");

    // Ficar perto 1 s revela.
    move(790);
    act(() => vi.advanceTimersByTime(BAR_REVEAL_AFTER_MS + 10));
    expect(bar()).toHaveAttribute("data-visible");
  });
});
