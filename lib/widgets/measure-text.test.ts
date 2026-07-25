// Versão: 1.0 | Data: 25/07/2026
// Testes do medidor de texto (lib/widgets/measure-text.ts). Em jsdom o canvas
// 2D não existe (getContext("2d") → null), então measureTextWidth cai no
// estimador determinístico — os asserts cobrem o FALLBACK, não o canvas.
import { describe, expect, it } from "vitest";

import {
  estimateTextWidth,
  maxTextWidth,
  measureTextWidth,
} from "@/lib/widgets/measure-text";

describe("estimateTextWidth", () => {
  it("string vazia mede 0", () => {
    expect(estimateTextWidth("", 11)).toBe(0);
  });

  it("é determinístico e cresce com o comprimento do texto", () => {
    const a = estimateTextWidth("12", 11);
    const b = estimateTextWidth("1234", 11);
    expect(a).toBe(estimateTextWidth("12", 11));
    expect(b).toBeGreaterThan(a);
  });

  it("cresce com o tamanho da fonte", () => {
    expect(estimateTextWidth("R$ 1.234", 16)).toBeGreaterThan(
      estimateTextWidth("R$ 1.234", 11)
    );
  });
});

describe("measureTextWidth (fallback em jsdom)", () => {
  it("string vazia mede 0 e texto mede > 0", () => {
    expect(measureTextWidth("", 11)).toBe(0);
    expect(measureTextWidth("42%", 11)).toBeGreaterThan(0);
  });

  it("monotônico no comprimento (mesma fonte)", () => {
    expect(measureTextWidth("1.234.567 (45%)", 11)).toBeGreaterThan(
      measureTextWidth("12", 11)
    );
  });
});

describe("maxTextWidth", () => {
  it("lista vazia → 0; senão o mais largo", () => {
    expect(maxTextWidth([], 11)).toBe(0);
    const widest = measureTextWidth("1.234.567 (45%)", 11);
    expect(maxTextWidth(["12", "1.234.567 (45%)", "9%"], 11)).toBe(widest);
  });
});
