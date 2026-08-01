// Testes do helper ÚNICO da memória de cálculo da comissão (pt-BR). Os
// esperados são montados com os PRÓPRIOS formatadores (fmtMoneyBRL/fmtNumBR):
// o Intl pt-BR emite NBSP entre "R$" e o número — nunca digitar o literal
// com espaço comum.
import { describe, expect, it } from "vitest";

import {
  commissionMemory,
  entryMemoryLines,
  factorPayoutFormula,
  fmtMoneyBRL,
  fmtNumBR,
} from "./commission-label";
import {
  computeEntry,
  parseCompEntryInputs,
  type CompCommissionBlockBreakdown,
  type CompPlanConfig,
} from "./model";

function block(
  over: Partial<CompCommissionBlockBreakdown> = {}
): CompCommissionBlockBreakdown {
  return {
    blockId: "b1",
    label: "Comissão 1",
    value: 0,
    tier: null,
    triggerValue: null,
    tierBy: "attainment",
    kind: "pct",
    basis: null,
    basisLabel: null,
    basisMoney: false,
    triggerLabel: "Vendas",
    triggerMoney: false,
    memberTiersApplied: false,
    ...over,
  };
}

describe("commissionMemory", () => {
  it("per_unit por realizado: contagem × R$/unidade, faixa 'a partir de'", () => {
    const mem = commissionMemory(
      block({
        kind: "per_unit",
        tierBy: "realized",
        tier: { fromPct: 26, amount: 12.5 },
        triggerValue: 44,
        triggerLabel: "Reuniões",
        basis: 44,
        basisLabel: "Reuniões",
        basisMoney: false,
        value: 550,
      })
    );
    expect(mem.formula).toBe(
      `${fmtNumBR(44)} (Reuniões) × ${fmtMoneyBRL(12.5)} = ${fmtMoneyBRL(550)}`
    );
    expect(mem.tierNote).toBe(
      `faixa a partir de ${fmtNumBR(26)} (Reuniões: ${fmtNumBR(44)})`
    );
    expect(mem.memberTiers).toBe(false);
  });

  it("pct por atingimento sobre fator money: % × R$ com o gatilho em %", () => {
    const mem = commissionMemory(
      block({
        tier: { fromPct: 80, ratePct: 40 },
        triggerValue: 90,
        basis: 9450,
        basisLabel: "Vendas",
        basisMoney: true,
        value: 3780,
      })
    );
    expect(mem.formula).toBe(
      `${fmtNumBR(40)}% × ${fmtMoneyBRL(9450)} (Vendas) = ${fmtMoneyBRL(3780)}`
    );
    expect(mem.tierNote).toBe(
      `faixa ≥ ${fmtNumBR(80)}% (atingimento de Vendas: ${fmtNumBR(90)}%)`
    );
  });

  it("pct sobre a Base variável e pct por realizado money (limiar em R$)", () => {
    const base = commissionMemory(
      block({
        tier: { fromPct: 0, ratePct: 10 },
        triggerValue: 100,
        basis: 1000,
        basisLabel: "Base variável",
        basisMoney: true,
        value: 100,
      })
    );
    expect(base.formula).toBe(
      `${fmtNumBR(10)}% × ${fmtMoneyBRL(1000)} (Base variável) = ${fmtMoneyBRL(100)}`
    );
    const realized = commissionMemory(
      block({
        tierBy: "realized",
        tier: { fromPct: 5000, ratePct: 20 },
        triggerValue: 9450,
        triggerMoney: true,
        basis: 9450,
        basisLabel: "Vendas",
        basisMoney: true,
        value: 1890,
      })
    );
    expect(realized.tierNote).toBe(
      `faixa a partir de ${fmtMoneyBRL(5000)} (Vendas: ${fmtMoneyBRL(9450)})`
    );
  });

  it("flat: valor fixo da faixa, sem multiplicando", () => {
    const mem = commissionMemory(
      block({
        kind: "flat",
        tier: { fromPct: 75, amount: 750 },
        triggerValue: 90,
        triggerLabel: "Reuniões",
        value: 750,
      })
    );
    expect(mem.formula).toBe(`${fmtMoneyBRL(750)} (valor fixo da faixa)`);
    expect(mem.tierNote).toBe(
      `faixa ≥ ${fmtNumBR(75)}% (atingimento de Reuniões: ${fmtNumBR(90)}%)`
    );
  });

  it("nenhuma faixa atingida e gatilho vazio: só o motivo, sem fórmula", () => {
    const below = commissionMemory(block({ triggerValue: 40 }));
    expect(below.formula).toBeNull();
    expect(below.tierNote).toBe(
      `nenhuma faixa atingida (gatilho: ${fmtNumBR(40)}%)`
    );
    const empty = commissionMemory(block());
    expect(empty.formula).toBeNull();
    expect(empty.tierNote).toBe(
      "sem gatilho apurado (atingimento/realizado vazio)"
    );
  });

  it("faixa ok mas fator-base sem realizado: fórmula nula com o motivo do zero", () => {
    const mem = commissionMemory(
      block({
        tier: { fromPct: 50, ratePct: 3 },
        triggerValue: 90,
        basis: null,
        basisLabel: "Vendas",
        value: 0,
      })
    );
    expect(mem.formula).toBeNull();
    expect(mem.tierNote).toBe(
      `faixa ≥ ${fmtNumBR(50)}% (atingimento de Vendas: ${fmtNumBR(90)}%) — fator-base sem realizado ⇒ ${fmtMoneyBRL(0)}`
    );
  });

  it("memberTiersApplied atravessa (o caller decide o sufixo)", () => {
    expect(commissionMemory(block({ memberTiersApplied: true })).memberTiers).toBe(
      true
    );
  });
});

// ————— Memória da LINHA inteira (entryMemoryLines) — breakdowns montados
// pelo PRÓPRIO computeEntry (nunca literais com espaço comum: NBSP do Intl).

const aggCount = { tokens: [{ kind: "field" as const, ref: "agg:count:*" }] };

// Plano 100% comissão (estilo SDR Inbound): fator peso 0 + bloco per_unit.
const cfgSoComissao: CompPlanConfig = {
  v: 1,
  factors: [
    {
      id: "reunioes",
      label: "Reuniões",
      weightPct: 0,
      metricKey: "m_r",
      money: false,
      formula: aggCount,
      sources: [],
    },
  ],
  commissions: [
    {
      id: "premio",
      label: "Prêmio por reunião",
      triggerFactorId: "reunioes",
      basisKind: "factor",
      basisFactorId: "reunioes",
      tierBy: "realized",
      kind: "per_unit",
      tiers: [
        { fromPct: 0, amount: 10 },
        { fromPct: 26, amount: 12.5 },
      ],
    },
  ],
};

// Plano clássico: dois fatores com peso, sem comissão.
const cfgPesos: CompPlanConfig = {
  v: 1,
  factors: [
    {
      id: "f_a",
      label: "Vendas",
      weightPct: 60,
      metricKey: "m_a",
      money: true,
      formula: aggCount,
      sources: [],
    },
    {
      id: "f_b",
      label: "Reuniões",
      weightPct: 40,
      metricKey: "m_b",
      money: false,
      formula: aggCount,
      sources: [],
    },
  ],
};

describe("factorPayoutFormula", () => {
  it("é byte-idêntica ao antigo title inline da grade", () => {
    expect(factorPayoutFormula(3000, 60, 90, 1620)).toBe(
      `${fmtMoneyBRL(3000)} × ${fmtNumBR(60)}% × ${fmtNumBR(90)}% = ${fmtMoneyBRL(1620)}`
    );
  });
});

describe("entryMemoryLines", () => {
  it("plano só-comissão: fator peso 0 + bloco; SEM linha de Total (um termo só)", () => {
    const bd = computeEntry(
      cfgSoComissao,
      null,
      parseCompEntryInputs({}),
      { reunioes: 44 },
      {}
    );
    const lines = entryMemoryLines(cfgSoComissao, bd);
    expect(lines[0]).toBe(
      `Reuniões: realizado ${fmtNumBR(44)} (gatilho/base de comissão)`
    );
    expect(lines[1]).toBe(
      `Prêmio por reunião: ${fmtNumBR(44)} (Reuniões) × ${fmtMoneyBRL(12.5)} = ${fmtMoneyBRL(550)} — faixa a partir de ${fmtNumBR(26)} (Reuniões: ${fmtNumBR(44)})`
    );
    // 1 bloco sem override ⇒ sem linha de soma; comissão é o único termo ⇒
    // sem linha de Total.
    expect(lines).toHaveLength(2);
  });

  it("plano com pesos + bônus: conta por fator e Total composto", () => {
    const inputs = parseCompEntryInputs({
      bonuses: [{ id: "b1", label: "Campanha", amount: 100 }],
    });
    const bd = computeEntry(
      cfgPesos,
      1000,
      inputs,
      { f_a: 50000, f_b: 9 },
      { f_a: 100000, f_b: 10 }
    );
    const lines = entryMemoryLines(cfgPesos, bd);
    // f_a: 1000×60%×50% = 300; f_b: 1000×40%×90% = 360.
    expect(lines[0]).toBe(`Vendas: ${factorPayoutFormula(1000, 60, 50, 300)}`);
    expect(lines[1]).toBe(`Reuniões: ${factorPayoutFormula(1000, 40, 90, 360)}`);
    expect(lines[2]).toBe(`Bônus: ${fmtMoneyBRL(100)}`);
    expect(lines[3]).toBe(
      `Total: fatores ${fmtMoneyBRL(660)} + bônus ${fmtMoneyBRL(100)} = ${fmtMoneyBRL(760)}`
    );
    expect(lines).toHaveLength(4);
  });

  it("override da soma da comissão vira nota calculado × manual", () => {
    const bd = computeEntry(
      cfgSoComissao,
      null,
      parseCompEntryInputs({ overrides: { commission: 42 } }),
      { reunioes: 44 },
      {}
    );
    const lines = entryMemoryLines(cfgSoComissao, bd);
    expect(lines).toContain(
      `Comissão manual ${fmtMoneyBRL(42)} (calculado ${fmtMoneyBRL(550)})`
    );
  });

  it("payout manual e atingimento vazio têm linhas dedicadas (fórmula nunca mente)", () => {
    const bd = computeEntry(
      cfgPesos,
      1000,
      parseCompEntryInputs({
        overrides: { factors: { f_a: { payout: 500 } } },
      }),
      { f_a: 50000, f_b: 9 },
      { f_a: 100000 } // f_b sem alvo ⇒ atingimento null
    );
    const lines = entryMemoryLines(cfgPesos, bd);
    expect(lines[0]).toBe(`Vendas: ${fmtMoneyBRL(500)} (manual)`);
    expect(lines[1]).toBe(
      `Reuniões: sem atingimento (alvo/realizado vazio) ⇒ ${fmtMoneyBRL(0)}`
    );
  });

  it("totalFormula: linha própria; erro da fórmula vira aviso", () => {
    const ok: CompPlanConfig = {
      ...cfgPesos,
      totalFormula: {
        tokens: [
          { kind: "const", value: 100 },
          { kind: "op", op: "+" },
          { kind: "const", value: 23 },
        ],
      },
    };
    const bdOk = computeEntry(ok, 1000, parseCompEntryInputs({}), {}, {});
    expect(entryMemoryLines(ok, bdOk)).toContain(
      `Total pela fórmula do plano: ${fmtMoneyBRL(123)}`
    );
    const err: CompPlanConfig = {
      ...cfgPesos,
      totalFormula: {
        tokens: [
          { kind: "const", value: 1 },
          { kind: "op", op: "/" },
          { kind: "const", value: 0 },
        ],
      },
    };
    const bdErr = computeEntry(err, 1000, parseCompEntryInputs({}), {}, {});
    expect(entryMemoryLines(err, bdErr)).toContain(
      "Fórmula do total sem resultado"
    );
  });

  it("override do total vence tudo na linha final", () => {
    const bd = computeEntry(
      cfgPesos,
      1000,
      parseCompEntryInputs({ overrides: { total: 999 } }),
      { f_a: 50000, f_b: 9 },
      { f_a: 100000, f_b: 10 }
    );
    expect(entryMemoryLines(cfgPesos, bd)).toContain(
      `Total manual: ${fmtMoneyBRL(999)}`
    );
  });
});
