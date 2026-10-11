// Versão: 1.0 | Data: 11/10/2026
// v1.0 (11/10/2026): texto que não cabe e números grandes da Tree — parse
//   fail-closed, precedência cartão > widget > padrão e as FORMAS do número
//   (do mais longo ao mais curto).
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CARD_FIT,
  DEFAULT_NUMBER_FORMAT,
  numberCandidates,
  parseCardFit,
  parseNumberFormat,
  resolveCardFit,
  resolveNumberFormat,
} from "./card-fit";

const nbsp = (s: string) => s.replace(/ /g, " ");

describe("ajuste do cartão", () => {
  it("padrão = cartão cresce, 4 px de respiro", () => {
    expect(resolveCardFit(null, null)).toEqual(DEFAULT_CARD_FIT);
    expect(DEFAULT_CARD_FIT.overflow).toBe("cartao");
    expect(DEFAULT_CARD_FIT.padding).toBe(4);
  });
  it("parse descarta o inválido", () => {
    expect(parseCardFit({ overflow: "explodir", padding: 99, maxWidth: 10 })).toBeNull();
    expect(parseCardFit({ overflow: "texto", padding: "6", maxWidth: 400 })).toEqual({
      overflow: "texto",
      padding: 6,
      maxWidth: 400,
    });
  });
  it("cartão vence o widget por propriedade", () => {
    expect(resolveCardFit({ overflow: "cortar", padding: 10 }, { padding: 2 })).toEqual({
      overflow: "cortar",
      padding: 2,
      maxWidth: DEFAULT_CARD_FIT.maxWidth,
    });
  });
});

describe("formato de número", () => {
  it("parse e precedência", () => {
    expect(parseNumberFormat({ abbreviate: "x", style: "k", decimals: 9 })).toEqual({ style: "k" });
    const r = resolveNumberFormat({ style: "mil", decimals: 2 }, { decimals: 0 });
    expect(r.style).toBe("mil");
    expect(r.decimals).toBe(0);
    expect(r.suffixes).toEqual({ mil: "mil", mi: "mi", bi: "bi" });
    expect(r.space).toBe(true);
  });

  it("auto: completo primeiro, depois abreviado perdendo casas", () => {
    expect(numberCandidates(125430, "quantidade", DEFAULT_NUMBER_FORMAT).map(nbsp)).toEqual([
      "125.430",
      "125,4k",
      "125k",
    ]);
  });

  it("moeda preserva o R$; estilo mil", () => {
    const mil = resolveNumberFormat({ style: "mil" }, null);
    expect(numberCandidates(30000, "moeda", mil).map(nbsp)).toEqual(["R$ 30.000", "R$ 30 mil"]);
    expect(numberCandidates(1_250_000, "moeda", DEFAULT_NUMBER_FORMAT).map(nbsp)).toEqual([
      "R$ 1.250.000",
      "R$ 1,3M",
      "R$ 1M",
    ]);
  });

  it("decimais caem antes de abreviar", () => {
    expect(numberCandidates(1234.56, "numero", DEFAULT_NUMBER_FORMAT).map(nbsp)).toEqual([
      "1.234,56",
      "1.234,6",
      "1.235",
      "1,2k",
      "1k",
    ]);
  });

  it("sempre / nunca / percentual", () => {
    const sempre = resolveNumberFormat({ abbreviate: "sempre" }, null);
    expect(numberCandidates(30000, "quantidade", sempre)).toEqual(["30k"]);
    expect(numberCandidates(300, "quantidade", sempre)).toEqual(["300"]);
    const nunca = resolveNumberFormat({ abbreviate: "nunca" }, null);
    expect(numberCandidates(30000, "quantidade", nunca)).toEqual(["30.000"]);
    expect(numberCandidates(1250000, "percentual", DEFAULT_NUMBER_FORMAT)).toEqual([
      "1.250.000%",
    ]);
  });

  it("sufixos próprios", () => {
    const f = resolveNumberFormat({ style: "custom", suffixes: { mil: "K" }, space: false }, null);
    expect(numberCandidates(30500, "quantidade", { ...f, abbreviate: "sempre" })).toEqual([
      "30,5K",
      "31K",
    ]);
  });

  it("vazio vira travessão", () => {
    expect(numberCandidates(null, "moeda", DEFAULT_NUMBER_FORMAT)).toEqual(["—"]);
  });
});
