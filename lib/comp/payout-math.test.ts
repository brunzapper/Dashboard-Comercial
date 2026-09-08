// Versão: 1.0 | Data: 17/08/2026
// Testes da aritmética "registro → remuneração" (lib/comp/payout-math.ts), que
// alimenta a memória de cálculo do detalhamento. O que está pinado:
//  - a escada mostra TODAS as faixas, com a aplicada marcada e as que ficaram
//    acima do alcançado visíveis (sem elas o valor pago parece arbitrário);
//  - `unitValue` devolve número só quando a relação É linear — cap/piso ativo,
//    valor manual, sem alvo e fator só-gatilho devolvem null, porque ali um
//    "cada X vale Y" seria mentira.
import { describe, expect, it } from "vitest";

import {
  commissionRolesOf,
  resolvedUnitValue,
  tierLadder,
  unitValue,
} from "./payout-math";
import type {
  CompCommissionBlock,
  CompCommissionBlockBreakdown,
  CompFactor,
  CompFactorBreakdown,
  CompPlanConfig,
} from "./model";

const M1 = "m1";

const factor = (over: Partial<CompFactor> = {}): CompFactor => ({
  id: "f_reunioes",
  label: "Reuniões",
  weightPct: 0,
  metricKey: "comp_reunioes",
  money: false,
  formula: { tokens: [{ kind: "field", ref: "agg:count:*" }] },
  sources: [],
  ...over,
});

const fb = (over: Partial<CompFactorBreakdown> = {}): CompFactorBreakdown => ({
  target: null,
  realized: 44,
  attainmentPct: null,
  payout: 0,
  overridden: { realized: false, attainmentPct: false, payout: false },
  targetSource: null,
  targetBRL: null,
  ...over,
});

const block = (over: Partial<CompCommissionBlock> = {}): CompCommissionBlock => ({
  id: "premio",
  label: "Prêmio por reunião",
  triggerFactorId: "f_reunioes",
  basisKind: "factor",
  basisFactorId: "f_reunioes",
  tierBy: "realized",
  kind: "per_unit",
  tiers: [
    { fromPct: 0, amount: 10 },
    { fromPct: 40, amount: 12.5 },
    { fromPct: 80, amount: 15 },
  ],
  ...over,
});

const cb = (
  over: Partial<CompCommissionBlockBreakdown> = {}
): CompCommissionBlockBreakdown => ({
  blockId: "premio",
  label: "Prêmio por reunião",
  value: 550,
  tier: { fromPct: 40, amount: 12.5 },
  triggerValue: 44,
  tierBy: "realized",
  kind: "per_unit",
  basis: 44,
  basisLabel: "Reuniões",
  basisMoney: false,
  triggerLabel: "Reuniões",
  triggerMoney: false,
  memberTiersApplied: false,
  ...over,
});

describe("commissionRolesOf", () => {
  it("acha os blocos em que o fator é gatilho e/ou base", () => {
    const config = {
      v: 1,
      factors: [factor()],
      commissions: [
        block(),
        block({ id: "outro", triggerFactorId: "x", basisFactorId: "x" }),
      ],
    } as CompPlanConfig;
    const roles = commissionRolesOf(config, "f_reunioes");
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({ isTrigger: true, isBasis: true });
    expect(commissionRolesOf(config, "inexistente")).toEqual([]);
  });
});

describe("tierLadder", () => {
  it("mostra as faixas NÃO alcançadas — é o que explica o valor aplicado", () => {
    const escada = tierLadder(block(), M1, 44);
    expect(escada).toEqual([
      { fromPct: 0, amount: 10, applied: false, reached: true },
      { fromPct: 40, amount: 12.5, applied: true, reached: true },
      { fromPct: 80, amount: 15, applied: false, reached: false },
    ]);
  });

  it("sem gatilho apurado, nenhuma faixa é aplicada nem alcançada", () => {
    const escada = tierLadder(block(), M1, null);
    expect(escada.every((t) => !t.applied && !t.reached)).toBe(true);
  });

  it("faixas do MEMBRO substituem a tabela do plano", () => {
    const b = block({ memberTiers: { [M1]: [{ fromPct: 0, amount: 99 }] } });
    expect(tierLadder(b, M1, 44)).toEqual([
      { fromPct: 0, amount: 99, applied: true, reached: true },
    ]);
    // Outro membro segue na tabela do plano.
    expect(tierLadder(b, "outro", 44)).toHaveLength(3);
  });
});

describe("unitValue", () => {
  const roles = [{ block: block(), isTrigger: true, isBasis: true }];
  const blocks = new Map([["premio", cb()]]);

  it("comissão per_unit: cada unidade vale o valor fixo da faixa", () => {
    expect(unitValue(factor(), fb(), roles, blocks)).toEqual({
      perUnit: 12.5,
      kind: "commission",
      blockId: "premio",
    });
  });

  it("comissão pct: cada unidade vale a taxa da faixa", () => {
    const pct = new Map([
      ["premio", cb({ kind: "pct", tier: { fromPct: 40, ratePct: 20 } })],
    ]);
    expect(unitValue(factor(), fb(), roles, pct)).toMatchObject({
      perUnit: 0.2,
      kind: "commission",
    });
  });

  it("comissão flat não tem valor POR UNIDADE (o valor da faixa é fixo)", () => {
    const flat = new Map([
      ["premio", cb({ kind: "flat", tier: { fromPct: 40, amount: 750 } })],
    ]);
    expect(unitValue(factor(), fb(), roles, flat)).toBeNull();
  });

  it("sem faixa atingida não há valor por unidade", () => {
    const semFaixa = new Map([["premio", cb({ tier: null })]]);
    expect(unitValue(factor(), fb(), roles, semFaixa)).toBeNull();
  });

  it("fator SÓ gatilho (não é base) não converte unidade em dinheiro", () => {
    const soGatilho = [{ block: block(), isTrigger: true, isBasis: false }];
    expect(unitValue(factor(), fb(), soGatilho, blocks)).toBeNull();
  });

  it("fator com peso: a conta é base × peso ÷ alvo", () => {
    const f = factor({ weightPct: 50 });
    const b = fb({ target: 100, targetBRL: 100, realized: 80 });
    const uv = resolvedUnitValue(f, b, [], new Map(), 1000);
    // 1000 × 50% ÷ 100 = 5 por unidade de realizado.
    expect(uv).toEqual({ perUnit: 5, kind: "weight" });
  });

  it("peso: cap ATIVO quebra a linearidade — nada de valor por unidade", () => {
    const f = factor({ weightPct: 50, capPct: 100 });
    // realizado 150 sobre alvo 100 = 150% > cap: unidade extra não paga mais.
    const b = fb({ target: 100, targetBRL: 100, realized: 150 });
    expect(resolvedUnitValue(f, b, [], new Map(), 1000)).toBeNull();
  });

  it("peso: valor manual e alvo ausente também devolvem null", () => {
    const f = factor({ weightPct: 50 });
    expect(
      resolvedUnitValue(
        f,
        fb({
          target: 100,
          targetBRL: 100,
          realized: 80,
          overridden: { realized: false, attainmentPct: false, payout: true },
        }),
        [],
        new Map(),
        1000
      )
    ).toBeNull();
    expect(
      resolvedUnitValue(f, fb({ realized: 80 }), [], new Map(), 1000)
    ).toBeNull();
  });
});
