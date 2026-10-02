// Versão: 1.0 | Data: 02/10/2026
// Textos do esqueleto de slide com {=…} (lib/dashboards/slide-text.ts).
import { describe, expect, it } from "vitest";

import { formatSlideValue, hasSlideExpr, renderSlideText, slideExprSources } from "./slide-text";

describe("slide-text", () => {
  it("detecta e extrai as expressões na ordem", () => {
    expect(hasSlideExpr("MRR de R$ 115 mil")).toBe(false);
    expect(slideExprSources("A {= [x] } e {= [y] }")).toEqual(["[x]", "[y]"]);
  });
  it("valor em escala, com o símbolo da moeda", () => {
    expect(formatSlideValue({ value: 115000, currency: "BRL" })).toBe("R$ 115 mil");
    expect(formatSlideValue({ value: 4200000, currency: null })).toBe("4,2 mi");
    expect(formatSlideValue({ value: null, currency: null })).toBe("—");
    expect(formatSlideValue(undefined)).toBe("…");
  });
  it("monta o texto final; texto sem expressão volta igual", () => {
    expect(
      renderSlideText("O trimestre pede {= [Meta] } de MRR", [{ value: 33820, currency: "BRL" }])
    ).toBe("O trimestre pede R$ 33,8 mil de MRR");
    expect(renderSlideText("Sem número", [])).toBe("Sem número");
  });
});
