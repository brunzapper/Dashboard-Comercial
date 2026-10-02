// Versão: 1.0 | Data: 02/10/2026
// v1.0 (02/10/2026): número-herói — partes de um valor formatado e a escala.
import { describe, expect, it } from "vitest";

import { compactNumber, splitValueText } from "./format";

describe("splitValueText", () => {
  it("separa moeda, número e unidade", () => {
    expect(splitValueText("R$ 4.200")).toEqual({ prefix: "R$", number: "4.200", suffix: "" });
    expect(splitValueText("R$ 1.651.508")).toEqual({ prefix: "R$", number: "1.651.508", suffix: "" });
    expect(splitValueText("-R$ 12,50")).toEqual({ prefix: "R$", number: "-12,50", suffix: "" });
    expect(splitValueText("US$ 9")).toEqual({ prefix: "US$", number: "9", suffix: "" });
    expect(splitValueText("23,5%")).toEqual({ prefix: "", number: "23,5", suffix: "%" });
    expect(splitValueText("4,2 mi")).toEqual({ prefix: "", number: "4,2", suffix: "mi" });
  });
  it("texto fora do formato volta inteiro (nunca quebra)", () => {
    expect(splitValueText("—")).toEqual({ prefix: "", number: "—", suffix: "" });
    expect(splitValueText("Ganho")).toEqual({ prefix: "", number: "Ganho", suffix: "" });
    expect(splitValueText("12 clientes ativos no mês")).toEqual({
      prefix: "",
      number: "12 clientes ativos no mês",
      suffix: "",
    });
  });
});

describe("compactNumber", () => {
  it("escala pt-BR com uma casa e sem zero à direita", () => {
    expect(compactNumber(4_200_000)).toEqual({ number: "4,2", suffix: "mi" });
    expect(compactNumber(4_000_000)).toEqual({ number: "4", suffix: "mi" });
    expect(compactNumber(830_000)).toEqual({ number: "830", suffix: "mil" });
    expect(compactNumber(1_250_000_000)).toEqual({ number: "1,3", suffix: "bi" });
    expect(compactNumber(-52_250)).toEqual({ number: "-52,3", suffix: "mil" });
    expect(compactNumber(735)).toEqual({ number: "735", suffix: "" });
  });
});
