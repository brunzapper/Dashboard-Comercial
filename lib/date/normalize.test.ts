// Versão: 1.0 | Data: 24/07/2026
// Testes da normalização de fuso na ENTRADA (0079/0080). A invariante mais
// dura é o formato de saída: "YYYY-MM-DDTHH:mm:ss±HH:MM" BYTE A BYTE igual ao
// to_char(...) || '-03:00' do backfill 0080 — o reconcile compara strings e
// qualquer divergência reescreveria a base inteira. O read side é prefix-based,
// então o dia certo precisa estar no prefixo já na gravação.
import { describe, expect, it } from "vitest";

import {
  BRASILIA_TZ,
  normalizeDateString,
  offsetSuffix,
  wallTimeToEpoch,
  zonedParts,
} from "@/lib/date/normalize";

const MOSCOW = "Europe/Moscow";

describe("normalizeDateString", () => {
  it("fonte sem timezone (null/undefined) → passthrough", () => {
    expect(normalizeDateString("2026-07-17 18:30:00", null)).toBe(
      "2026-07-17 18:30:00"
    );
    expect(normalizeDateString("2026-07-17T18:30:00", undefined)).toBe(
      "2026-07-17T18:30:00"
    );
  });

  it("date-only é calendário puro — NUNCA converte (recuaria um dia)", () => {
    expect(normalizeDateString("2026-07-17", MOSCOW)).toBe("2026-07-17");
  });

  it("naive de Moscou → byte-exato no formato do backfill 0080", () => {
    // 18:30 MSK (UTC+3) = 15:30 UTC = 12:30 em Brasília (-03:00).
    expect(normalizeDateString("2026-07-17 18:30:00", MOSCOW)).toBe(
      "2026-07-17T12:30:00-03:00"
    );
    // Separador "T" e ausência de segundos → mesmo instante, segundos ":00".
    expect(normalizeDateString("2026-07-17T18:30", MOSCOW)).toBe(
      "2026-07-17T12:30:00-03:00"
    );
  });

  it("valor COM offset é re-expressão de instante (mesmo output do naive)", () => {
    expect(normalizeDateString("2026-07-17T18:30:00+03:00", MOSCOW)).toBe(
      "2026-07-17T12:30:00-03:00"
    );
  });

  it("sufixo Z cruzando meia-noite: o dia certo cai no PREFIXO", () => {
    expect(normalizeDateString("2026-01-15T02:00:00Z", MOSCOW)).toBe(
      "2026-01-14T23:00:00-03:00"
    );
  });

  it("fuso inválido → passthrough TOTAL, inclusive para valor com offset", () => {
    // A validação do fuso vem ANTES do ramo de offset: nunca conversão
    // parcial (offset converteria, naive não).
    expect(normalizeDateString("2026-07-17T18:30:00+03:00", "Foo/Bar")).toBe(
      "2026-07-17T18:30:00+03:00"
    );
    expect(normalizeDateString("2026-07-17 18:30:00", "Foo/Bar")).toBe(
      "2026-07-17 18:30:00"
    );
  });

  it("sentinelas e lixo → inalterados, sem lançar (sync não pode cair)", () => {
    expect(normalizeDateString("0000-00-00 00:00:00", MOSCOW)).toBe(
      "0000-00-00 00:00:00"
    );
    expect(normalizeDateString("abc", MOSCOW)).toBe("abc");
    expect(normalizeDateString("", MOSCOW)).toBe("");
  });

  it("fonte com DST converte pelo offset vigente na data", () => {
    // Londres: BST (UTC+1) no verão, GMT (UTC+0) no inverno.
    expect(normalizeDateString("2026-07-17 12:00:00", "Europe/London")).toBe(
      "2026-07-17T08:00:00-03:00"
    );
    expect(normalizeDateString("2026-01-17 12:00:00", "Europe/London")).toBe(
      "2026-01-17T09:00:00-03:00"
    );
  });
});

describe("primitivas de fuso", () => {
  it("offsetSuffix de Brasília é fixo -03:00 (sem DST desde 2019)", () => {
    expect(offsetSuffix(Date.UTC(2026, 6, 17, 12), BRASILIA_TZ)).toBe("-03:00");
    expect(offsetSuffix(Date.UTC(2026, 0, 17, 12), BRASILIA_TZ)).toBe("-03:00");
    expect(offsetSuffix(Date.UTC(2026, 6, 17, 12), MOSCOW)).toBe("+03:00");
  });

  it("wallTimeToEpoch × zonedParts fazem round-trip", () => {
    const wall = { y: 2026, m: 7, d: 17, hh: 18, mi: 30, ss: 0 };
    const epoch = wallTimeToEpoch(wall, MOSCOW);
    expect(epoch).toBe(Date.UTC(2026, 6, 17, 15, 30, 0));
    expect(zonedParts(epoch, MOSCOW)).toEqual(wall);
  });
});
