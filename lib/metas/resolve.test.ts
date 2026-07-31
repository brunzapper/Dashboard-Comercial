// Versão: 1.0 | Data: 31/07/2026
// Testes da resolução de metas (antes sem cobertura): goalPeriodScope
// (byte-idêntico à regra histórica do KPI modo meta), resolveGoal
// (explicit-first + roll-up operação/global; ausência ⇒ null; Number() do
// target string do PostgREST) e resolveGoalOperandValues (degrade POR CHAVE
// em erro — nunca lança, nunca fabrica 0).
import { describe, expect, it } from "vitest";

import { fakeSupabase, type RecordedQuery } from "@/tests/helpers/fake-supabase";

import {
  goalPeriodScope,
  resolveGoal,
  resolveGoalOperandValues,
} from "./resolve";

interface GoalRow {
  period_year: number;
  period_month: number | null;
  scope: string;
  metric: string;
  operation_id: string | null;
  responsible_id: string | null;
  target: string | number | null; // PostgREST devolve numeric como string
}

// Mini-banco de goals: aplica eq/is/in gravados na cadeia; maybeSingle na
// cadeia ⇒ devolve UMA linha (ou null), senão a lista.
function goalsHandler(rows: GoalRow[]) {
  return (q: RecordedQuery) => {
    let out = rows;
    for (const s of q.steps) {
      const [col, val] = s.args as [keyof GoalRow, unknown];
      if (s.method === "eq") out = out.filter((r) => r[col] === val);
      if (s.method === "is") out = out.filter((r) => r[col] == null);
      if (s.method === "in")
        out = out.filter((r) => (val as unknown[]).includes(r[col]));
    }
    const single = q.steps.some((s) => s.method === "maybeSingle");
    return { data: single ? (out[0] ?? null) : out, error: null };
  };
}

const NOW = new Date("2026-07-15T12:00:00");

describe("goalPeriodScope", () => {
  it("sem período: mês corrente; annualDefault ⇒ anual", () => {
    expect(goalPeriodScope(null, NOW)).toEqual({ year: 2026, month: 7 });
    expect(goalPeriodScope(undefined, NOW, true)).toEqual({
      year: 2026,
      month: null,
    });
  });

  it("intervalo dentro de um mês ⇒ meta MENSAL do mês do from", () => {
    expect(
      goalPeriodScope({ from: "2026-03-01", to: "2026-03-31" }, NOW)
    ).toEqual({ year: 2026, month: 3 });
    // Mês parcial idem (meta do mês inteiro — sem rateio).
    expect(
      goalPeriodScope({ from: "2026-03-05", to: "2026-03-10" }, NOW)
    ).toEqual({ year: 2026, month: 3 });
  });

  it("multi-mês/trimestre/cruzando ano ⇒ meta ANUAL do ano do from; sem `to` idem", () => {
    expect(
      goalPeriodScope({ from: "2026-01-01", to: "2026-03-31" }, NOW)
    ).toEqual({ year: 2026, month: null });
    expect(
      goalPeriodScope({ from: "2025-11-01", to: "2026-02-28" }, NOW)
    ).toEqual({ year: 2025, month: null });
    expect(goalPeriodScope({ from: "2026-03-01" }, NOW)).toEqual({
      year: 2026,
      month: null,
    });
  });
});

describe("resolveGoal", () => {
  const ROWS: GoalRow[] = [
    // Global mensal explícita (target string — PostgREST numeric).
    { period_year: 2026, period_month: 7, scope: "global", metric: "mrr", operation_id: null, responsible_id: null, target: "50000" },
    // Metas de responsável (alimentam roll-ups).
    { period_year: 2026, period_month: 7, scope: "responsible", metric: "sql", operation_id: null, responsible_id: "r1", target: "10" },
    { period_year: 2026, period_month: 7, scope: "responsible", metric: "sql", operation_id: null, responsible_id: "r2", target: "5" },
    // Meta de operação (alimenta o roll-up global de `vendas`).
    { period_year: 2026, period_month: 7, scope: "operation", metric: "vendas", operation_id: "opA", responsible_id: null, target: "30" },
  ];
  const fake = () =>
    fakeSupabase({
      rpc: {
        operation_subtree: () => ({
          data: [{ operation_id: "opA" }, { operation_id: "opB" }],
          error: null,
        }),
      },
      tables: {
        goals: goalsHandler(ROWS),
        responsible_operations: [
          { responsible_id: "r1", operation_id: "opA" },
          { responsible_id: "r2", operation_id: "opB" },
        ],
      },
    });

  it("explícita vence (e converte target string → number)", async () => {
    const g = await resolveGoal(fake().db, {
      scope: "global",
      year: 2026,
      month: 7,
      metric: "mrr",
    });
    expect(g).toEqual({ target: 50000, source: "explicit" });
  });

  it("roll-up de operação: soma metas de RESPONSÁVEL da subárvore", async () => {
    const g = await resolveGoal(fake().db, {
      scope: "operation",
      operationId: "opA",
      year: 2026,
      month: 7,
      metric: "sql",
    });
    expect(g).toEqual({ target: 15, source: "rollup" });
  });

  it("global sem explícita: soma de operação; na falta, soma de responsável", async () => {
    const byOp = await resolveGoal(fake().db, {
      scope: "global",
      year: 2026,
      month: 7,
      metric: "vendas",
    });
    expect(byOp).toEqual({ target: 30, source: "rollup" });
    const byResp = await resolveGoal(fake().db, {
      scope: "global",
      year: 2026,
      month: 7,
      metric: "sql",
    });
    expect(byResp).toEqual({ target: 15, source: "rollup" });
  });

  it("ausência total ⇒ null/none (nunca 0)", async () => {
    const g = await resolveGoal(fake().db, {
      scope: "global",
      year: 2026,
      month: 1,
      metric: "mrr",
    });
    expect(g).toEqual({ target: null, source: "none" });
  });
});

describe("resolveGoalOperandValues", () => {
  it("resolve por chave em paralelo; erro degrada SÓ a chave para null", async () => {
    const fake = fakeSupabase({
      tables: {
        goals: (q: RecordedQuery) => {
          const metric = q.steps.find(
            (s) => s.method === "eq" && s.args[0] === "metric"
          )?.args[1];
          if (metric === "boom") throw new Error("falha simulada");
          return goalsHandler([
            { period_year: 2026, period_month: 7, scope: "global", metric: "mrr", operation_id: null, responsible_id: null, target: "50000" },
          ])(q);
        },
      },
    });
    const values = await resolveGoalOperandValues(fake.db, ["mrr", "boom", "sumida"], {
      year: 2026,
      month: 7,
    });
    expect(values.mrr).toBe(50000);
    expect(values.boom).toBeNull();
    expect(values.sumida).toBeNull();
  });
});
