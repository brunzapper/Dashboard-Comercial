// Versão: 1.0 | Data: 28/11/2026
// Colunas relevantes da grade por indicador — cenário do Full Cycle (gatilho por
// atingimento + base derivada + Outbound pago 50% pelo realizado) e um plano
// clássico por peso, que tem de seguir com as 4 colunas de sempre.
import { describe, expect, it } from "vitest";

import { computeEntry, parseCompEntryInputs, type CompPlanConfig } from "./model";
import { factorCommissionCell, factorGridColumns } from "./grid-columns";

const agg = { tokens: [{ kind: "field" as const, ref: "agg:sum:value" }] };
const fc: CompPlanConfig = {
  v: 1,
  factors: [
    { id: "tot", label: "Totais", weightPct: 0, metricKey: "a", money: true, formula: agg, sources: [] },
    { id: "out", label: "Outbound", weightPct: 0, metricKey: "b", money: true, formula: agg, sources: [] },
    {
      id: "rest",
      label: "Sem Outbound",
      weightPct: 0,
      metricKey: "c",
      money: true,
      realizedFrom: "indicators",
      formula: {
        tokens: [
          { kind: "field", ref: "comp:f:tot:realizado" },
          { kind: "op", op: "-" },
          { kind: "field", ref: "comp:f:out:realizado" },
        ],
      },
      sources: [],
    },
  ],
  commissions: [
    {
      id: "tab",
      triggerFactorId: "tot",
      basisKind: "factor",
      basisFactorId: "rest",
      tierBy: "attainment",
      kind: "pct",
      tiers: [
        { fromPct: 1, ratePct: 30 },
        { fromPct: 75, ratePct: 40 },
      ],
    },
    {
      id: "ob",
      triggerFactorId: "out",
      basisKind: "factor",
      basisFactorId: "out",
      tierBy: "realized",
      kind: "pct",
      tiers: [{ fromPct: 0, ratePct: 50 }],
    },
  ],
};

describe("factorGridColumns", () => {
  it("Full Cycle: gatilho mostra Meta/Ating.; quem é pago mostra Remun./Recebe; ninguém mostra Valor", () => {
    const [tot, out, rest] = fc.factors.map((f) => factorGridColumns(fc, f));
    expect(tot).toEqual(["target", "realized", "attainment"]);
    expect(out).toEqual(["realized", "rate", "commission"]);
    expect(rest).toEqual(["realized", "rate", "commission"]);
  });

  it("plano por peso segue com Meta | Real. | Ating. | Valor", () => {
    const cfg: CompPlanConfig = { v: 1, factors: [{ ...fc.factors[0], weightPct: 60 }] };
    expect(factorGridColumns(cfg, cfg.factors[0])).toEqual(["target", "realized", "attainment", "payout"]);
  });

  it("fórmula do total que lê o valor/atingimento traz a coluna de volta", () => {
    const cfg: CompPlanConfig = {
      v: 1,
      factors: [fc.factors[0]],
      totalFormula: { tokens: [{ kind: "field", ref: "comp:f:tot:ating" }] },
    };
    expect(factorGridColumns(cfg, cfg.factors[0])).toEqual(["target", "realized", "attainment"]);
  });
});

describe("factorCommissionCell", () => {
  it("faixa aplicada e valor por indicador-base", () => {
    const bd = computeEntry(fc, 0, parseCompEntryInputs({}), { tot: 8000, out: 2000 }, { tot: 10000 });
    expect(factorCommissionCell(fc, bd, "rest")).toEqual({ rate: "40%", value: 2400 });
    expect(factorCommissionCell(fc, bd, "out")).toEqual({ rate: "50%", value: 1000 });
    expect(factorCommissionCell(fc, bd, "tot")).toBeNull();
  });
});
