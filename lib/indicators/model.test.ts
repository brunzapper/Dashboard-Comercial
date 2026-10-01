// Versão: 1.0 | Data: 01/10/2026
import { describe, expect, it } from "vitest";

import {
  attainment,
  combineChildren,
  formatIndicatorValue,
  indicatorStatus,
  monthLabel,
  monthsOfRange,
  parseIndicatorRealized,
  parseIndicatorRow,
  rollupMonths,
} from "./model";
import { monthElapsed } from "./values";

const FORMULA = { tokens: [{ kind: "field", ref: "agg:count:*@sqls" }] };

describe("parseIndicatorRow", () => {
  it("normaliza defaults e rejeita chave inválida", () => {
    const def = parseIndicatorRow({ key: "sql_inbound", label: " SQL " });
    expect(def).toMatchObject({
      key: "sql_inbound",
      label: "SQL",
      unit: "quantidade",
      rollup: "soma",
      direction: "maior_melhor",
      tolerancePct: 5,
      realized: null,
    });
    expect(parseIndicatorRow({ key: "SQL!", label: "x" })).toBeNull();
    expect(parseIndicatorRow({ key: "ok", label: "" })).toBeNull();
  });

  it("enum fora do contrato cai no padrão", () => {
    const def = parseIndicatorRow({ key: "cac", label: "CAC", unit: "x", direction: "menor_melhor" });
    expect(def?.unit).toBe("quantidade");
    expect(def?.direction).toBe("menor_melhor");
  });
});

describe("parseIndicatorRealized (fail-closed)", () => {
  it("aceita o shape v1", () => {
    const r = parseIndicatorRealized({
      v: 1,
      formula: FORMULA,
      sources: ["sqls"],
      filters: [{ field: "stage", op: "eq", value: "Ganho" }],
    });
    expect(r?.sources).toEqual(["sqls"]);
    expect(r?.filters).toHaveLength(1);
  });

  it("rejeita versão, fórmula vazia e operador interno do RPC", () => {
    expect(parseIndicatorRealized({ v: 2, formula: FORMULA })).toBeNull();
    expect(parseIndicatorRealized({ v: 1, formula: { tokens: [] } })).toBeNull();
    expect(
      parseIndicatorRealized({
        v: 1,
        formula: FORMULA,
        filters: [{ field: "stage", op: "eq_ci", value: "x" }],
      })
    ).toBeNull();
  });
});

describe("aritmética", () => {
  it("rollup por regra", () => {
    expect(rollupMonths([1, 2, 3], "soma")).toBe(6);
    expect(rollupMonths([2, 4, null], "media")).toBe(3);
    expect(rollupMonths([517591, 549278, null], "ultimo")).toBe(549278);
    expect(rollupMonths([1, 2], "nenhum")).toBeNull();
    expect(rollupMonths([null, null], "soma")).toBeNull();
  });

  it("atingimento respeita a direção", () => {
    expect(attainment(31, 31, "maior_melhor")).toBe(100);
    // CAC realizado abaixo da meta = melhor que a meta.
    expect(attainment(2500, 2837, "menor_melhor")).toBeCloseTo(113.48, 1);
    expect(attainment(null, 10, "maior_melhor")).toBeNull();
    expect(attainment(5, 0, "maior_melhor")).toBeNull();
  });

  it("combineChildren projeta como os slides", () => {
    // N2 vendas × ticket = MRR projetado.
    expect(
      combineChildren("×", [
        { value: 31, unit: "quantidade" },
        { value: 1000, unit: "moeda" },
      ])
    ).toBe(31000);
    // N3 SQL × conversão (percentual vira fração).
    expect(
      combineChildren("×", [
        { value: 135, unit: "quantidade" },
        { value: 23, unit: "percentual" },
      ])
    ).toBeCloseTo(31.05, 2);
    expect(
      combineChildren("+", [
        { value: 31, unit: "quantidade" },
        { value: 2, unit: "quantidade" },
      ])
    ).toBe(33);
    expect(
      combineChildren("×", [
        { value: 31, unit: "quantidade" },
        { value: null, unit: "moeda" },
      ])
    ).toBeNull();
    expect(
      combineChildren("÷", [
        { value: 10, unit: "numero" },
        { value: 0, unit: "numero" },
      ])
    ).toBeNull();
  });
});

describe("indicatorStatus", () => {
  const def = { direction: "maior_melhor", tolerancePct: 5, unit: "quantidade", rollup: "soma" } as const;
  it("mês fechado compara cheio, com faixa de tolerância", () => {
    expect(indicatorStatus(96, 100, def, { elapsed: 1 })).toBe("ok");
    expect(indicatorStatus(92, 100, def, { elapsed: 1 })).toBe("atencao");
    expect(indicatorStatus(80, 100, def, { elapsed: 1 })).toBe("fora");
  });
  it("mês corrente compara pro-rata", () => {
    expect(indicatorStatus(50, 100, def, { elapsed: 0.5 })).toBe("ok");
    expect(indicatorStatus(10, 100, def, { elapsed: 0 })).toBe("sem_dado");
  });
  it("percentual e custo não prorrateiam", () => {
    const pct = { ...def, unit: "percentual", rollup: "media" } as const;
    expect(indicatorStatus(20, 23, pct, { elapsed: 0.5 })).toBe("fora");
    const cac = { ...def, direction: "menor_melhor", unit: "moeda" } as const;
    expect(indicatorStatus(3000, 2837, cac, { elapsed: 0.5 })).toBe("atencao");
  });
});

describe("meses", () => {
  it("monthsOfRange cobre o intervalo e o trimestre padrão", () => {
    expect(monthsOfRange("2026-10-01", "2026-12-31", "2026-10-01")).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
    ]);
    expect(monthsOfRange(null, null, "2026-11-15")).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
    ]);
    expect(monthsOfRange("2026-12-01", "2027-01-31", "x")).toEqual(["2026-12", "2027-01"]);
  });
  it("rótulos", () => {
    expect(monthLabel("2026-10")).toBe("Outubro");
    expect(monthLabel("2026-10", true)).toBe("Outubro/26");
  });
  it("monthElapsed por dia útil", () => {
    expect(monthElapsed(2026, 9, "2026-10-01", new Set())).toBe(1);
    expect(monthElapsed(2026, 11, "2026-10-01", new Set())).toBe(0);
    // 01/10/2026 é quinta: 1 dia útil de 22.
    expect(monthElapsed(2026, 10, "2026-10-01", new Set())).toBeCloseTo(1 / 22, 5);
  });
});

describe("formatIndicatorValue", () => {
  it("formata por unidade", () => {
    expect(formatIndicatorValue(30220, "moeda")).toMatch(/30\.220/);
    expect(formatIndicatorValue(23, "percentual")).toBe("23%");
    expect(formatIndicatorValue(33, "quantidade")).toBe("33");
    expect(formatIndicatorValue(null, "moeda")).toBe("—");
  });
});
