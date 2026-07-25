import { describe, expect, it } from "vitest";

import { estimateChartTextWidth, hbarRightMargin } from "./hbar-labels";

describe("estimateChartTextWidth", () => {
  it("texto vazio ocupa 0", () => {
    expect(estimateChartTextWidth("", 12)).toBe(0);
  });

  it("cresce com o comprimento do texto e com a fonte", () => {
    const curto = estimateChartTextWidth("42", 12);
    const longo = estimateChartTextWidth("R$ 1.234.567,89", 12);
    expect(longo).toBeGreaterThan(curto);
    expect(estimateChartTextWidth("42", 18)).toBeGreaterThan(curto);
  });

  it("aproxima ~0.62em por caractere (com folga)", () => {
    // 10 chars × 12px × 0.62 = 74.4 → 75 + 2 de folga.
    expect(estimateChartTextWidth("0123456789", 12)).toBe(77);
  });
});

describe("hbarRightMargin", () => {
  const fontPx = 12;

  it("sem rótulos externos, mantém a margem base", () => {
    expect(
      hbarRightMargin({ base: 12, fontPx, valueTexts: [], varTexts: [] })
    ).toBe(12);
  });

  it("reserva gap + largura do MAIOR rótulo de valor", () => {
    const w = estimateChartTextWidth("R$ 1.234.567,89", fontPx);
    expect(
      hbarRightMargin({
        base: 12,
        fontPx,
        valueTexts: ["42", "R$ 1.234.567,89"],
        varTexts: [],
      })
    ).toBe(12 + 4 + w);
  });

  it("só variação: gap + largura da variação", () => {
    const w = estimateChartTextWidth("▲ +12,3%", fontPx);
    expect(
      hbarRightMargin({
        base: 12,
        fontPx,
        valueTexts: [],
        varTexts: ["▲ +12,3%"],
      })
    ).toBe(12 + 4 + w);
  });

  it("valor + variação: espelha a geometria fim + gap + valor + gap + variação", () => {
    const valueW = estimateChartTextWidth("R$ 950,00", fontPx);
    const varW = estimateChartTextWidth("▼ -8%", fontPx);
    expect(
      hbarRightMargin({
        base: 12,
        fontPx,
        valueTexts: ["R$ 950,00"],
        varTexts: ["▼ -8%"],
      })
    ).toBe(12 + 4 + valueW + 4 + varW);
  });

  it("gap customizado substitui o padrão", () => {
    const w = estimateChartTextWidth("42", fontPx);
    expect(
      hbarRightMargin({
        base: 12,
        fontPx,
        valueTexts: ["42"],
        varTexts: [],
        gap: 6,
      })
    ).toBe(12 + 6 + w);
  });
});
