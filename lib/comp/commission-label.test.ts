// Testes do helper ÚNICO da memória de cálculo da comissão (pt-BR). Os
// esperados são montados com os PRÓPRIOS formatadores (fmtMoneyBRL/fmtNumBR):
// o Intl pt-BR emite NBSP entre "R$" e o número — nunca digitar o literal
// com espaço comum.
import { describe, expect, it } from "vitest";

import {
  commissionMemory,
  fmtMoneyBRL,
  fmtNumBR,
} from "./commission-label";
import type { CompCommissionBlockBreakdown } from "./model";

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
