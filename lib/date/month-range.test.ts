// Versão: 1.0 | Data: 02/10/2026
// Aritmética do seletor de meses (lib/date/month-range.ts).
import { describe, expect, it } from "vitest";

import { addMonths, monthPreset, monthSpan } from "./month-range";

describe("month-range", () => {
  it("soma meses cruzando o ano", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
  it("intervalo inclusivo, invertido troca, com teto", () => {
    expect(monthSpan("2026-10", "2026-12", 12)).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(monthSpan("2026-12", "2026-10", 12)).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(monthSpan("2026-01", "2027-12", 12)).toHaveLength(12);
  });
  it("atalhos relativos a hoje", () => {
    expect(monthPreset("trimestre", "2026-10-02")).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(monthPreset("proximo_trimestre", "2026-10-02")).toEqual(["2027-01", "2027-02", "2027-03"]);
    expect(monthPreset("ultimos3", "2026-01-15")).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(monthPreset("ano", "2026-10-02")).toHaveLength(12);
  });
});
