// Versão: 1.0 | Data: 24/07/2026
// Testes dos utilitários PUROS de dia útil (0081) — base do alinhamento
// "mesmo dia útil" (businessDayAlign), da comparação previous_period_bd e da
// goalLine. Referência de calendário: julho/2026 começa numa QUARTA (04-05,
// 11-12, 18-19 e 25-26 são fins de semana → 23 dias úteis).
import { describe, expect, it } from "vitest";

import {
  businessDayIndexInMonth,
  businessDayOrdinalLabel,
  businessDaysBetween,
  businessDaysInMonth,
  daysInMonth,
  isBusinessDay,
  nthBusinessDayOfMonth,
} from "@/lib/date/business-days";

const NONE = new Set<string>();

describe("daysInMonth", () => {
  it("meses são 1–12; bissexto correto", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 7)).toBe(31);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe("isBusinessDay", () => {
  it("segunda a sexta sim; fim de semana não", () => {
    expect(isBusinessDay("2026-07-20", NONE)).toBe(true); // segunda
    expect(isBusinessDay("2026-07-18", NONE)).toBe(false); // sábado
    expect(isBusinessDay("2026-07-19", NONE)).toBe(false); // domingo
  });

  it("feriado no Set derruba dia de semana", () => {
    expect(isBusinessDay("2026-07-21", new Set(["2026-07-21"]))).toBe(false);
  });

  it("aceita datetime (usa o prefixo) e rejeita ISO inválido", () => {
    expect(isBusinessDay("2026-07-21T10:00:00-03:00", NONE)).toBe(true);
    expect(isBusinessDay("21/07/2026", NONE)).toBe(false);
    expect(isBusinessDay("", NONE)).toBe(false);
  });
});

describe("businessDaysInMonth", () => {
  it("julho/2026 tem 23 dias úteis; feriado em dia de semana desconta", () => {
    expect(businessDaysInMonth(2026, 7, NONE)).toBe(23);
    expect(businessDaysInMonth(2026, 7, new Set(["2026-07-15"]))).toBe(22);
  });

  it("feriado caindo no sábado não desconta nada", () => {
    expect(businessDaysInMonth(2026, 7, new Set(["2026-07-18"]))).toBe(23);
  });
});

describe("businessDayIndexInMonth", () => {
  it("dia útil → ordinal no mês", () => {
    expect(businessDayIndexInMonth("2026-07-01", NONE)).toBe(1);
    expect(businessDayIndexInMonth("2026-07-17", NONE)).toBe(13);
  });

  it("dia NÃO útil → índice do último útil anterior", () => {
    expect(businessDayIndexInMonth("2026-07-18", NONE)).toBe(13); // sábado
  });

  it("dia 1 em domingo → 0 (nenhum útil ainda); ISO inválido → 0", () => {
    expect(businessDayIndexInMonth("2026-02-01", NONE)).toBe(0); // domingo
    expect(businessDayIndexInMonth("x", NONE)).toBe(0);
  });
});

describe("nthBusinessDayOfMonth", () => {
  it("pula fim de semana/feriado no início do mês", () => {
    expect(nthBusinessDayOfMonth(2026, 7, 1, NONE)).toBe("2026-07-01");
    expect(nthBusinessDayOfMonth(2026, 7, 1, new Set(["2026-07-01"]))).toBe(
      "2026-07-02"
    );
    // 4º útil de fev/2026 (mês começa no domingo): 02..05 são seg..qui.
    expect(nthBusinessDayOfMonth(2026, 2, 4, NONE)).toBe("2026-02-05");
  });

  it("n > total → clamp no último útil; n < 1 tratado como 1", () => {
    expect(nthBusinessDayOfMonth(2026, 7, 99, NONE)).toBe("2026-07-31");
    expect(nthBusinessDayOfMonth(2026, 7, 0, NONE)).toBe("2026-07-01");
  });

  it("mês patológico sem nenhum dia útil → último dia do mês", () => {
    const all = new Set<string>();
    for (let d = 1; d <= 31; d++) {
      all.add(`2026-07-${String(d).padStart(2, "0")}`);
    }
    expect(nthBusinessDayOfMonth(2026, 7, 3, all)).toBe("2026-07-31");
  });
});

describe("businessDaysBetween", () => {
  it("inclusivo nas duas pontas", () => {
    // sex 17 + seg 20 (18/19 é fim de semana).
    expect(businessDaysBetween("2026-07-17", "2026-07-20", NONE)).toBe(2);
    expect(businessDaysBetween("2026-07-20", "2026-07-20", NONE)).toBe(1);
  });

  it("atravessa mês", () => {
    // sex 31/07 + seg 03/08.
    expect(businessDaysBetween("2026-07-31", "2026-08-03", NONE)).toBe(2);
  });

  it("intervalo invertido ou ISO inválido → 0", () => {
    expect(businessDaysBetween("2026-07-20", "2026-07-17", NONE)).toBe(0);
    expect(businessDaysBetween("x", "2026-07-20", NONE)).toBe(0);
  });
});

describe("businessDayOrdinalLabel", () => {
  it("rótulo único do badge", () => {
    expect(businessDayOrdinalLabel(14)).toBe("14º dia útil");
  });
});
