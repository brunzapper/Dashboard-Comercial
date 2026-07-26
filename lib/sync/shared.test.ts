// Versão: 1.0 | Data: 26/07/2026
// Guarda da comparação de reconcile: colunas CORE timestamptz comparam por
// INSTANTE (timestampValuesDiffer) — o PostgREST devolve "+00:00" e os
// mappers emitem "-03:00"; byte-compare marcaria toda linha como alterada a
// cada sync (churn de update + audit_log, ~126k entradas por coluna até
// 26/07/2026). Campos custom (texto) seguem no byte-compare de valuesDiffer
// (invariante 0080: o formato É o dado, read prefix-based).
import { describe, expect, it } from "vitest";

import { timestampValuesDiffer, valuesDiffer } from "@/lib/sync/shared";

describe("timestampValuesDiffer", () => {
  it("mesmo instante em formatos diferentes NÃO difere (PostgREST +00:00 × mapper -03:00)", () => {
    expect(
      timestampValuesDiffer(
        "2026-07-17T15:30:00+00:00",
        "2026-07-17T12:30:00-03:00"
      )
    ).toBe(false);
    expect(
      timestampValuesDiffer(
        "2026-07-01T03:00:00+00:00",
        "2026-07-01T00:00:00-03:00"
      )
    ).toBe(false);
  });

  it("instantes diferentes diferem", () => {
    expect(
      timestampValuesDiffer(
        "2026-07-01T00:00:00+00:00",
        "2026-07-01T00:00:00-03:00"
      )
    ).toBe(true);
  });

  it("null/vazio e não-parseável caem no valuesDiffer", () => {
    expect(timestampValuesDiffer(null, null)).toBe(false);
    expect(timestampValuesDiffer(null, "2026-07-01T00:00:00-03:00")).toBe(true);
    expect(timestampValuesDiffer("abc", "abc")).toBe(false);
    expect(timestampValuesDiffer("abc", "def")).toBe(true);
  });
});

describe("valuesDiffer (comportamento preservado p/ texto)", () => {
  it("segue byte-compare: mesmo instante em formato diferente DIFERE", () => {
    expect(
      valuesDiffer("2026-07-17T15:30:00+00:00", "2026-07-17T12:30:00-03:00")
    ).toBe(true);
  });
});
