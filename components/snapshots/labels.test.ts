// Versão: 1.0 | Data: 24/07/2026
// Testes dos rótulos compartilhados da UI de snapshots — helpers puros
// (env node, sem render). O Intl fica pinado em America/Sao_Paulo no próprio
// módulo, independente do TZ do processo.
import { describe, expect, it } from "vitest";

import {
  formatDateTime,
  frozenPeriodLabel,
  scheduleLabel,
} from "@/components/snapshots/labels";

describe("scheduleLabel", () => {
  it("modos manual/hourly/daily/weekly com defaults", () => {
    expect(scheduleLabel({ refresh_mode: "manual", refresh_time: null, refresh_weekday: null })).toBe("Manual");
    expect(scheduleLabel({ refresh_mode: "hourly", refresh_time: null, refresh_weekday: null })).toBe("A cada hora");
    expect(scheduleLabel({ refresh_mode: "daily", refresh_time: "08:30", refresh_weekday: null })).toBe("Diário às 08:30");
    expect(scheduleLabel({ refresh_mode: "daily", refresh_time: null, refresh_weekday: null })).toBe("Diário às 06:00");
    expect(scheduleLabel({ refresh_mode: "weekly", refresh_time: "07:00", refresh_weekday: 5 })).toBe("Sexta às 07:00");
    expect(scheduleLabel({ refresh_mode: "weekly", refresh_time: null, refresh_weekday: null })).toBe("Segunda às 06:00");
  });
});

describe("formatDateTime", () => {
  it("null/ausente → travessão; ISO → data/hora de Brasília", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
    const out = formatDateTime("2026-07-17T15:30:00Z"); // 12:30 em Brasília
    expect(out).toContain("17/07/2026");
    expect(out).toContain("12:30");
  });
});

describe("frozenPeriodLabel", () => {
  it("preset → rótulo humano; intervalo → dd/mm/aaaa; vazio → todo o período", () => {
    expect(frozenPeriodLabel(null)).toBe("Todo o período");
    expect(frozenPeriodLabel({})).toBe("Todo o período");
    expect(frozenPeriodLabel({ periodo: "este_mes" })).toBe("Este mês");
    expect(frozenPeriodLabel({ de: "2026-07-01", ate: "2026-07-31" })).toBe(
      "01/07/2026 – 31/07/2026"
    );
    expect(frozenPeriodLabel({ de: "2026-07-01" })).toBe("01/07/2026 – …");
  });
});
