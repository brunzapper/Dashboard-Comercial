// Versão: 1.0 | Data: 01/10/2026
import { describe, expect, it } from "vitest";

import {
  describeSchedule,
  nextOpenOccurrence,
  parseRitualSchedule,
  ritualOccurrences,
  ritualOccurrencesToOpen,
  type RitualSchedule,
} from "./cadence";

const take = (s: RitualSchedule, k: number, h?: Set<string>) => {
  const out: string[] = [];
  for (const o of ritualOccurrences(s, h)) {
    out.push(o.date);
    if (out.length >= k) break;
  }
  return out;
};

describe("ritualOccurrences", () => {
  it("dia útil pula fim de semana e feriado", () => {
    // 01/10/2026 = quinta. 02/10 sexta; 05/10 segunda.
    expect(take({ cadence: "diario_util", anchor: "2026-10-01" }, 3)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-05",
    ]);
    expect(
      take({ cadence: "diario_util", anchor: "2026-10-01" }, 2, new Set(["2026-10-02"]))
    ).toEqual(["2026-10-01", "2026-10-05"]);
  });

  it("semanal na sexta a partir da âncora", () => {
    expect(take({ cadence: "semanal", weekday: 5, anchor: "2026-10-01" }, 2)).toEqual([
      "2026-10-02",
      "2026-10-09",
    ]);
  });

  it("mensal no último dia útil (31/10/2026 é sábado)", () => {
    expect(take({ cadence: "mensal", monthDay: "ultimo_util", anchor: "2026-10-01" }, 3)).toEqual([
      "2026-10-30",
      "2026-11-30",
      "2026-12-31",
    ]);
  });

  it("mensal no dia fixo pula o mês cuja data já passou e respeita o fim", () => {
    expect(
      take({ cadence: "mensal", monthDay: 1, anchor: "2026-10-15", until: "2026-12-31" }, 5)
    ).toEqual(["2026-11-01", "2026-12-01"]);
  });
});

describe("próximas ocorrências", () => {
  const weekly: RitualSchedule = { cadence: "semanal", weekday: 5, anchor: "2026-10-01" };
  it("nunca retroativa e pula as que já existem", () => {
    expect(nextOpenOccurrence(weekly, "2026-10-08", new Set())).toEqual({
      n: 1,
      date: "2026-10-09",
    });
    expect(nextOpenOccurrence(weekly, "2026-10-08", new Set([1]))).toEqual({
      n: 2,
      date: "2026-10-16",
    });
  });
  it("automático abre a janela sem repetir", () => {
    expect(ritualOccurrencesToOpen(weekly, "2026-10-01", new Set(), 2).map((o) => o.n)).toEqual([0, 1]);
    expect(ritualOccurrencesToOpen(weekly, "2026-10-01", new Set([0]), 2).map((o) => o.n)).toEqual([1]);
  });
});

describe("parse e descrição", () => {
  it("fail-closed", () => {
    expect(parseRitualSchedule({ cadence: "semanal", anchor: "2026-10-01", weekday: 9 })).toBeNull();
    expect(parseRitualSchedule({ cadence: "x", anchor: "2026-10-01" })).toBeNull();
    expect(parseRitualSchedule({ cadence: "dias", anchor: "2026-10-01" })).toBeNull();
    expect(parseRitualSchedule({ cadence: "mensal", anchor: "2026-10-01", monthDay: "ultimo_util" })).toEqual({
      cadence: "mensal",
      anchor: "2026-10-01",
      monthDay: "ultimo_util",
    });
  });
  it("descreve por extenso", () => {
    expect(describeSchedule({ cadence: "semanal", weekday: 5, anchor: "2026-10-01" })).toBe("Toda sexta");
    expect(describeSchedule({ cadence: "mensal", monthDay: "ultimo_util", anchor: "2026-10-01" })).toBe(
      "Último dia útil do mês"
    );
  });
});
