// Versão: 1.0 | Data: 02/10/2026
// Fonte do realizado (lib/indicators/realized-source.ts) e a quebra por
// dimensão (breakdownRows, lib/indicators/values.ts).
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  effectiveRealized,
  exposedFilters,
  isDefaultRealized,
  parseRealizedSource,
  realizedSourceKey,
} from "./realized-source";
import { breakdownRows } from "./values";

const F = { tokens: [{ kind: "field", ref: "agg:count:*" }] } as never;

describe("parseRealizedSource", () => {
  it("fail-closed: lixo ⇒ null; versão obrigatória", () => {
    expect(parseRealizedSource(null)).toBeNull();
    expect(parseRealizedSource({})).toBeNull();
    expect(parseRealizedSource({ v: 1, override: { formula: { tokens: [] } } })).toBeNull();
    expect(parseRealizedSource({ v: 1, filters: [{ field: "x", op: "eq_ci", value: "a" }] })).toBeNull();
  });
  it("guarda override, recortes (com exposto) e quebra", () => {
    const rs = parseRealizedSource({
      v: 1,
      override: { formula: F, sources: ["leads"] },
      filters: [{ field: "responsible_id", op: "eq", value: "Gabriella Salles", exposed: true }],
      breakdown: { field: "custom:fonte", display: "recolhido", limit: 5, lixo: 1 },
    });
    expect(rs?.override?.sources).toEqual(["leads"]);
    expect(rs?.filters?.[0]).toMatchObject({ field: "responsible_id", exposed: true });
    expect(rs?.breakdown).toEqual({ field: "custom:fonte", display: "recolhido", limit: 5 });
    expect(exposedFilters(rs)).toHaveLength(1);
    expect(isDefaultRealized(rs)).toBe(false);
    expect(realizedSourceKey(null)).toBe("");
  });
});

describe("effectiveRealized", () => {
  const def = { realized: { v: 1 as const, formula: F, sources: ["deals"], filters: [{ field: "stage", op: "eq" as const, value: "Ganho" }] } };
  it("sem override: fórmula do catálogo + recortes extras (sem a flag exposed)", () => {
    const e = effectiveRealized(def, {
      v: 1,
      filters: [{ field: "responsible_id", op: "eq", value: "Ana", exposed: true }],
    });
    expect(e?.own).toBe(false);
    expect(e?.sources).toEqual(["deals"]);
    expect(e?.filters).toEqual([
      { field: "stage", op: "eq", value: "Ganho" },
      { field: "responsible_id", op: "eq", value: "Ana" },
    ]);
  });
  it("override vence o catálogo; sem fórmula nenhuma ⇒ null", () => {
    expect(effectiveRealized(def, { v: 1, override: { formula: F, sources: [] } })?.own).toBe(true);
    expect(effectiveRealized({ realized: null }, null)).toBeNull();
    expect(effectiveRealized(null, { v: 1, override: { formula: F, sources: [] } })?.own).toBe(true);
  });
});

describe("breakdownRows", () => {
  it("os maiores primeiro, o resto em Outros, meses alinhados", () => {
    const m1 = new Map([["A", 10], ["B", 5], ["C", 1]]);
    const m2 = new Map([["A", 2], ["C", 3]]);
    const rows = breakdownRows([m1, m2, null], "soma", 2);
    expect(rows.map((r) => r.label)).toEqual(["A", "B", "Outros"]);
    expect(rows[0].realized).toEqual([10, 2, null]);
    expect(rows[2].realized).toEqual([1, 3, null]);
    expect(rows[0].total).toBe(12);
  });
});
