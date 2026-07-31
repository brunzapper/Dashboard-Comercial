// Versão: 1.0 | Data: 30/07/2026
// Testes dos builders PUROS do espelho de remuneração: serialização exata do
// FormData de createRecord/updateRecord (número com ponto; closed_at
// `YYYY-MM-DD` SEM hora — o coerceCore ancora em Brasília, invariante 11) e o
// atingimento médio ponderado (sem fatores válidos ⇒ null, nunca 0).
import { describe, expect, it } from "vitest";

import type { Formula } from "@/lib/records/formulas";

import { computeEntry, parseCompEntryInputs, type CompPlanConfig } from "./model";
import {
  MIRROR_FIELDS,
  mirrorAttainmentPct,
  mirrorFormValues,
  mirrorTitle,
} from "./mirror";

const aggFormula: Formula = { tokens: [{ kind: "field", ref: "agg:sum:value" }] };

const CONFIG: CompPlanConfig = {
  v: 1,
  factors: [
    {
      id: "f_a",
      label: "Vendas",
      weightPct: 60,
      metricKey: "comp_vendas",
      money: true,
      formula: aggFormula,
      sources: [],
    },
    {
      id: "f_b",
      label: "Reuniões",
      weightPct: 40,
      metricKey: "comp_reunioes",
      money: false,
      formula: aggFormula,
      sources: [],
    },
  ],
};

describe("mirror builders", () => {
  it("mirrorTitle e valores do form (ponto decimal; closed_at sem hora)", () => {
    const breakdown = computeEntry(
      CONFIG,
      1000,
      parseCompEntryInputs({ bonuses: [{ id: "b", label: "x", amount: 100.5 }] }),
      { f_a: 80, f_b: 10 },
      { f_a: 100, f_b: 10 }
    );
    const values = mirrorFormValues({
      config: CONFIG,
      breakdown,
      planName: "Comercial",
      memberName: "Maria",
      responsibleId: "resp-1",
      year: 2026,
      month: 7,
      lastDay: 31,
    });
    expect(values.core__title).toBe("Maria — 07/2026");
    expect(values.core__closed_at).toBe("2026-07-31");
    expect(values.core__currency).toBe("BRL");
    expect(values.responsible_id).toBe("resp-1");
    // 1000×60%×80% + 1000×40%×100% + 100,5 = 980,5.
    expect(values.core__value).toBe("980.5");
    expect(values.custom__rem_base).toBe("1000");
    expect(values.custom__rem_bonus).toBe("100.5");
    expect(values.custom__rem_plano).toBe("Comercial");
    // Ponderado: (60×80 + 40×100)/100 = 88.
    expect(values.custom__rem_atingimento).toBe("88");
    expect(mirrorTitle("Ana", 2026, 12)).toBe("Ana — 12/2026");
  });

  it("atingimento médio ignora fatores sem atingimento; nenhum ⇒ null", () => {
    const semAlvo = computeEntry(
      CONFIG,
      1000,
      parseCompEntryInputs({}),
      { f_a: 80, f_b: null },
      { f_a: 100 }
    );
    // Só Vendas tem atingimento (80%) — média = 80, não diluída pelo f_b.
    expect(mirrorAttainmentPct(CONFIG, semAlvo)).toBe(80);
    const nada = computeEntry(
      CONFIG,
      1000,
      parseCompEntryInputs({}),
      { f_a: null, f_b: null },
      {}
    );
    expect(mirrorAttainmentPct(CONFIG, nada)).toBeNull();
    const values = mirrorFormValues({
      config: CONFIG,
      breakdown: nada,
      planName: "P",
      memberName: "M",
      responsibleId: "r",
      year: 2026,
      month: 2,
      lastDay: 28,
    });
    expect(values.custom__rem_atingimento).toBe("");
    expect(values.core__value).toBe("0");
  });

  it("spec das field defs fixas do espelho", () => {
    expect(MIRROR_FIELDS.map((f) => f.key)).toEqual([
      "rem_base",
      "rem_bonus",
      "rem_atingimento",
      "rem_plano",
    ]);
    expect(MIRROR_FIELDS.every((f) => f.label.length > 0)).toBe(true);
  });
});
