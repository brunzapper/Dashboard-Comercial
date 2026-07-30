// Versão: 1.0 | Data: 30/07/2026
// Testes da coerção pura de valores (lib/records/coerce.ts) — em especial o
// fix da invariante 11 (write side): data core ancorada em Brasília — e a
// TRAVA ANTI-DIVERGÊNCIA do fluxo de inserção por IA: o valor canônico do
// validador, serializado como o apply serializa (String), passa por
// coerce/coerceCore e chega ao MESMO valor. Se a coerção e o validador
// divergirem, este arquivo quebra antes do usuário perceber.
import { describe, expect, it } from "vitest";

import { coerce, coerceCore, coreEquals, numOrNull } from "@/lib/records/coerce";

describe("coerceCore", () => {
  it("data: ancora o dia digitado em Brasília (invariante 11, write side)", () => {
    expect(coerceCore("data", "2026-07-01")).toBe("2026-07-01T00:00:00-03:00");
    // Datetime é truncado ao dia ANTES de ancorar (mesma semântica anterior).
    expect(coerceCore("data", "2026-07-01T15:30")).toBe(
      "2026-07-01T00:00:00-03:00"
    );
    expect(coerceCore("data", "")).toBeNull();
  });

  it("numero/moeda: número JS puro; inválido vira null", () => {
    expect(coerceCore("moeda", "1250.5")).toBe(1250.5);
    expect(coerceCore("numero", "abc")).toBeNull();
    expect(coerceCore("numero", "")).toBeNull();
  });

  it("booleano: só true/false literais", () => {
    expect(coerceCore("booleano", "true")).toBe(true);
    expect(coerceCore("booleano", "false")).toBe(false);
    expect(coerceCore("booleano", "sim")).toBeNull();
  });
});

describe("coerce (campos personalizados)", () => {
  it("numero aceita formato pt-BR e ponto decimal", () => {
    expect(coerce("numero", "1.234,56")).toBe(1234.56);
    expect(coerce("numero", "1250.5")).toBe(1250.5);
  });

  it("data custom fica TEXTO naive (nunca ancorar — read side prefix-based)", () => {
    expect(coerce("data", "2026-07-01")).toBe("2026-07-01");
  });
});

describe("coreEquals com o valor ancorado", () => {
  it("data compara pelo dia: ancorado casa com o timestamptz devolvido", () => {
    // PostgREST devolve UTC: 2026-07-01T00:00:00-03:00 == 2026-07-01T03:00:00+00:00.
    expect(
      coreEquals(
        "data",
        "2026-07-01T03:00:00+00:00",
        coerceCore("data", "2026-07-01")
      )
    ).toBe(true);
    // Legado gravado naive (UTC midnight) também casa pelo dia — edição com a
    // mesma data exibida não reescreve a linha.
    expect(
      coreEquals(
        "data",
        "2026-07-01T00:00:00+00:00",
        coerceCore("data", "2026-07-01")
      )
    ).toBe(true);
    expect(
      coreEquals("data", "2026-06-30T23:00:00+00:00", coerceCore("data", "2026-07-01"))
    ).toBe(false);
  });
});

describe("trava anti-divergência validador ↔ escrita (inserção por IA)", () => {
  // O apply serializa cada valor canônico com String(v) e o createRecord coage
  // com coerce/coerceCore — o round-trip deve devolver o valor validado.
  it("core: número, booleano e data", () => {
    expect(coerceCore("moeda", String(1250.5))).toBe(1250.5);
    expect(coerceCore("booleano", String(true))).toBe(true);
    expect(coerceCore("booleano", String(false))).toBe(false);
    expect(coerceCore("data", String("2026-07-28"))).toBe(
      "2026-07-28T00:00:00-03:00"
    );
    expect(coerceCore("texto", String("Proposta ACME"))).toBe("Proposta ACME");
  });

  it("custom: número, booleano, seleção e data naive", () => {
    expect(coerce("numero", String(1234.56))).toBe(1234.56);
    expect(coerce("booleano", String(true))).toBe(true);
    expect(coerce("selecao", String("Indicação"))).toBe("Indicação");
    expect(coerce("data", String("2026-07-28"))).toBe("2026-07-28");
  });
});

describe("numOrNull", () => {
  it("número finito ou null", () => {
    expect(numOrNull("10")).toBe(10);
    expect(numOrNull("")).toBeNull();
    expect(numOrNull(null)).toBeNull();
    expect(numOrNull("x")).toBeNull();
  });
});
