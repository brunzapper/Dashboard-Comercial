// @vitest-environment jsdom
// Versão: 1.0 | Data: 03/10/2026
// OverflowTooltip: abre só quando o texto não cabe (jsdom não faz layout, então
// as medidas são definidas à mão).
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OverflowTooltip, isTextTruncated } from "./overflow-tooltip";

function size(el: Element, s: { sw: number; cw: number; sh?: number; ch?: number }) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: s.sw });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: s.cw });
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: s.sh ?? 20 });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: s.ch ?? 20 });
}

describe("isTextTruncated", () => {
  it("detecta reticências na largura e ignora a folga subpixel", () => {
    const el = document.createElement("span");
    size(el, { sw: 101, cw: 100 });
    expect(isTextTruncated(el)).toBe(false);
    size(el, { sw: 140, cw: 100 });
    expect(isTextTruncated(el)).toBe(true);
  });

  it("mede o pai quando o corte é do bloco que contém o link (line-clamp)", () => {
    const parent = document.createElement("div");
    const link = document.createElement("a");
    parent.appendChild(link);
    size(link, { sw: 0, cw: 0, sh: 0, ch: 0 });
    size(parent, { sw: 100, cw: 100, sh: 60, ch: 40 });
    expect(isTextTruncated(link)).toBe(true);
    size(parent, { sw: 100, cw: 100, sh: 40, ch: 40 });
    expect(isTextTruncated(link)).toBe(false);
  });

  it("null não está cortado", () => {
    expect(isTextTruncated(null)).toBe(false);
  });
});

describe("OverflowTooltip", () => {
  it("não abre com o nome inteiro visível", () => {
    render(
      <OverflowTooltip text="Comercial">
        <span>Comercial</span>
      </OverflowTooltip>
    );
    const trigger = screen.getByText("Comercial");
    size(trigger, { sw: 80, cw: 80 });
    fireEvent.focus(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("abre com o nome inteiro quando está cortado", () => {
    render(
      <OverflowTooltip text="Dashboard Comercial — Pré-Vendas Outbound">
        <span className="truncate">Dashboard Comercial — Pré-Vendas Outbound</span>
      </OverflowTooltip>
    );
    const trigger = screen.getByText("Dashboard Comercial — Pré-Vendas Outbound");
    size(trigger, { sw: 300, cw: 120 });
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Dashboard Comercial — Pré-Vendas Outbound"
    );
  });
});
