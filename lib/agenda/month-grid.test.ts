// Versão: 1.0 | Data: 28/07/2026
// Guarda dos helpers puros da grade do calendário: cobertura do mês com bordas
// de meses vizinhos, segunda-feira ISO (inclusive em domingo), navegação por
// mês ancorada no dia 1 e virada de ano.
import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  mondayOfIso,
  monthGrid,
  monthLabel,
  monthOf,
  weekOf,
} from "./month-grid";

describe("mondayOfIso", () => {
  it("volta à segunda a partir de qualquer dia da semana", () => {
    expect(mondayOfIso("2026-07-01")).toBe("2026-06-29"); // quarta
    expect(mondayOfIso("2026-07-26")).toBe("2026-07-20"); // domingo
    expect(mondayOfIso("2026-07-20")).toBe("2026-07-20"); // já é segunda
  });
});

describe("addDays / monthOf", () => {
  it("cruza mês e ano", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(monthOf("2026-07-28")).toBe("2026-07");
  });
});

describe("addMonths", () => {
  it("navega ancorando no dia 1", () => {
    expect(addMonths("2026-07-15", 1)).toBe("2026-08-01");
    expect(addMonths("2026-07-15", -1)).toBe("2026-06-01");
    expect(addMonths("2026-12-05", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-01");
  });
});

describe("weekOf", () => {
  it("devolve segunda→domingo contendo a data", () => {
    expect(weekOf("2026-07-28")).toEqual([
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);
  });
});

describe("monthGrid", () => {
  it("cobre o mês inteiro com bordas dos vizinhos (julho/2026 = 5 semanas)", () => {
    const weeks = monthGrid("2026-07-15");
    expect(weeks).toHaveLength(5);
    for (const week of weeks) expect(week).toHaveLength(7);
    expect(weeks[0][0]).toBe("2026-06-29"); // segunda antes do dia 1 (quarta)
    expect(weeks[4][6]).toBe("2026-08-02"); // domingo depois do dia 31 (sexta)
    const days = new Set(weeks.flat());
    for (let d = 1; d <= 31; d++) {
      expect(days.has(`2026-07-${String(d).padStart(2, "0")}`)).toBe(true);
    }
  });

  it("mês exato em semanas não ganha borda (fev/2027 = 4 semanas)", () => {
    const weeks = monthGrid("2027-02-10");
    expect(weeks).toHaveLength(4);
    expect(weeks[0][0]).toBe("2027-02-01"); // segunda
    expect(weeks[3][6]).toBe("2027-02-28"); // domingo
  });
});

describe("monthLabel", () => {
  it("formata em pt-BR", () => {
    expect(monthLabel("2026-07-01")).toBe("Julho de 2026");
  });
});
