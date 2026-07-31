// Versão: 1.0 | Data: 30/07/2026
// Testes do modelo PURO da remuneração variável. Invariantes duras: parse
// FAIL-CLOSED do config (jsonb adulterado nunca "roda como der") e leniente
// por chave dos inputs; efetivo = manual ?? calculado em CADA variável
// (limpar override restaura a derivação); cap/floor só no calculado; fórmula
// livre avalia sobre as variáveis EFETIVAS (sincronia) e resultado inválido
// vira total null (nunca 0); overrides.total vence os dois modos.
import { describe, expect, it } from "vitest";

import type { Formula, FormulaToken } from "@/lib/records/formulas";

import {
  COMP_BASE_REF,
  COMP_BONUS_REF,
  COMP_FACTORS_REF,
  MAX_TOTAL_FORMULA_TOKENS,
  compFactorRef,
  compOperandCatalog,
  computeEntry,
  lastDayOfMonth,
  monthPeriod,
  parseCompEntryInputs,
  parseCompPlanConfig,
  roundMoney,
  type CompPlanConfig,
} from "@/lib/comp/model";

// Helpers de montagem de tokens (mesmo shape do construtor de botões).
const f = (...tokens: FormulaToken[]): Formula => ({ tokens });
const ref = (r: string): FormulaToken => ({ kind: "field", ref: r });
const num = (v: number): FormulaToken => ({ kind: "const", value: v });
const op = (o: "+" | "-" | "*" | "/"): FormulaToken => ({ kind: "op", op: o });

const aggFormula = f(ref("agg:sum:value"));

function makeConfig(over: Partial<CompPlanConfig> = {}): CompPlanConfig {
  return {
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
        sources: ["negocios"],
        capPct: 120,
        floorPct: 0,
      },
    ],
    ...over,
  };
}

const emptyInputs = () => parseCompEntryInputs({});

describe("parseCompPlanConfig (fail-closed)", () => {
  it("aceita config válido e aplica defaults (money=true)", () => {
    const raw = JSON.parse(JSON.stringify(makeConfig()));
    delete raw.factors[0].money;
    const parsed = parseCompPlanConfig(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.factors[0].money).toBe(true);
    expect(parsed!.factors[1].capPct).toBe(120);
  });

  it("rejeita v errado, fator inválido e ids duplicados", () => {
    expect(parseCompPlanConfig({ v: 2, factors: [] })).toBeNull();
    expect(parseCompPlanConfig({ v: 1 })).toBeNull();
    const semId = makeConfig();
    (semId.factors[0] as { id: string }).id = "";
    expect(parseCompPlanConfig(JSON.parse(JSON.stringify(semId)))).toBeNull();
    const dup = makeConfig();
    dup.factors[1].id = "f_a";
    expect(parseCompPlanConfig(JSON.parse(JSON.stringify(dup)))).toBeNull();
    const pesoRuim = makeConfig();
    (pesoRuim.factors[0] as { weightPct: unknown }).weightPct = "60";
    expect(parseCompPlanConfig(JSON.parse(JSON.stringify(pesoRuim)))).toBeNull();
  });

  it("rejeita floor > cap e fórmula sem tokens", () => {
    const invertido = makeConfig();
    invertido.factors[1].capPct = 50;
    invertido.factors[1].floorPct = 80;
    expect(parseCompPlanConfig(JSON.parse(JSON.stringify(invertido)))).toBeNull();
    const semFormula = makeConfig();
    (semFormula.factors[0] as { formula: unknown }).formula = { tokens: [] };
    expect(parseCompPlanConfig(JSON.parse(JSON.stringify(semFormula)))).toBeNull();
  });

  it("rejeita totalFormula acima do teto de tokens", () => {
    const tokens = Array.from(
      { length: MAX_TOTAL_FORMULA_TOKENS + 1 },
      () => num(1)
    );
    const cfg = { ...makeConfig(), totalFormula: { tokens } };
    expect(parseCompPlanConfig(JSON.parse(JSON.stringify(cfg)))).toBeNull();
  });
});

describe("parseCompEntryInputs (leniente por chave)", () => {
  it("número inválido cai, o resto sobrevive", () => {
    const parsed = parseCompEntryInputs({
      overrides: {
        factors: { f_a: { payout: "abc", attainmentPct: 90 } },
        total: Infinity,
      },
      bonuses: [
        { id: "b1", label: "Campanha", amount: 500 },
        { id: "b2", label: "Quebrado", amount: "x" },
      ],
      note: "obs",
    });
    expect(parsed.overrides.factors.f_a).toEqual({ attainmentPct: 90 });
    expect(parsed.overrides.total).toBeUndefined();
    expect(parsed.bonuses).toEqual([{ id: "b1", label: "Campanha", amount: 500 }]);
    expect(parsed.note).toBe("obs");
  });
});

describe("computeEntry — estrutura padrão", () => {
  it("base × Σ(peso × atingimento) + bônus, arredondado a 2 casas", () => {
    const bd = computeEntry(
      makeConfig(),
      1000,
      parseCompEntryInputs({ bonuses: [{ id: "b", label: "x", amount: 100 }] }),
      { f_a: 80, f_b: 10 },
      { f_a: 100, f_b: 10 }
    );
    // f_a: 1000 × 60% × 80% = 480; f_b: 1000 × 40% × 100% = 400.
    expect(bd.byFactor.f_a.attainmentPct).toBe(80);
    expect(bd.byFactor.f_a.payout).toBe(480);
    expect(bd.byFactor.f_b.payout).toBe(400);
    expect(bd.factorsTotal).toBe(880);
    expect(bd.bonusTotal).toBe(100);
    expect(bd.total).toBe(980);
    expect(bd.weightSumPct).toBe(100);
  });

  it("precedência manual ?? calculado em cada nível; limpar restaura", () => {
    const cfg = makeConfig();
    const realized = { f_a: 80, f_b: 10 };
    const targets = { f_a: 100, f_b: 10 };
    // Override de atingimento recalcula o payout a partir dele.
    let bd = computeEntry(
      cfg,
      1000,
      parseCompEntryInputs({
        overrides: { factors: { f_a: { attainmentPct: 90 } } },
      }),
      realized,
      targets
    );
    expect(bd.byFactor.f_a.attainmentPct).toBe(90);
    expect(bd.byFactor.f_a.payout).toBe(540);
    expect(bd.byFactor.f_a.overridden.attainmentPct).toBe(true);
    // Override de payout vence o atingimento (manual é manual).
    bd = computeEntry(
      cfg,
      1000,
      parseCompEntryInputs({
        overrides: { factors: { f_a: { attainmentPct: 90, payout: 111 } } },
      }),
      realized,
      targets
    );
    expect(bd.byFactor.f_a.payout).toBe(111);
    expect(bd.total).toBe(511);
    // "Limpar" = chave ausente ⇒ volta ao calculado sem re-consulta.
    bd = computeEntry(cfg, 1000, emptyInputs(), realized, targets);
    expect(bd.byFactor.f_a.payout).toBe(480);
    expect(bd.byFactor.f_a.overridden.attainmentPct).toBe(false);
    // Override de total vence tudo.
    bd = computeEntry(
      cfg,
      1000,
      parseCompEntryInputs({ overrides: { total: 1234.5 } }),
      realized,
      targets
    );
    expect(bd.total).toBe(1234.5);
    expect(bd.totalOverridden).toBe(true);
  });

  it("cap/floor clampam só o CALCULADO; override passa verbatim", () => {
    const cfg = makeConfig();
    // f_b tem cap 120 / floor 0: realizado 20 sobre alvo 10 = 200% ⇒ 120%.
    let bd = computeEntry(cfg, 1000, emptyInputs(), { f_a: 0, f_b: 20 }, { f_a: 100, f_b: 10 });
    expect(bd.byFactor.f_b.attainmentPct).toBe(120);
    // Atingimento negativo é clampado pelo floor 0.
    bd = computeEntry(cfg, 1000, emptyInputs(), { f_a: 0, f_b: -5 }, { f_a: 100, f_b: 10 });
    expect(bd.byFactor.f_b.attainmentPct).toBe(0);
    // f_a não tem cap: 200% passa. E override manual ignora o clamp de f_b.
    bd = computeEntry(
      cfg,
      1000,
      parseCompEntryInputs({
        overrides: { factors: { f_b: { attainmentPct: 300 } } },
      }),
      { f_a: 200, f_b: 20 },
      { f_a: 100, f_b: 10 }
    );
    expect(bd.byFactor.f_a.attainmentPct).toBe(200);
    expect(bd.byFactor.f_b.attainmentPct).toBe(300);
  });

  it("alvo 0/ausente ou realizado null ⇒ atingimento null e payout 0", () => {
    const bd = computeEntry(
      makeConfig(),
      1000,
      emptyInputs(),
      { f_a: 80, f_b: null },
      { f_a: 0, f_b: 10 }
    );
    expect(bd.byFactor.f_a.attainmentPct).toBeNull();
    expect(bd.byFactor.f_a.payout).toBe(0);
    expect(bd.byFactor.f_b.attainmentPct).toBeNull();
    expect(bd.byFactor.f_b.payout).toBe(0);
    expect(bd.total).toBe(0);
  });

  it("pesos não precisam somar 100 (sem normalização silenciosa)", () => {
    const cfg = makeConfig();
    cfg.factors[0].weightPct = 70;
    cfg.factors[1].weightPct = 70;
    const bd = computeEntry(cfg, 1000, emptyInputs(), { f_a: 100, f_b: 10 }, { f_a: 100, f_b: 10 });
    expect(bd.weightSumPct).toBe(140);
    expect(bd.factorsTotal).toBe(1400);
  });
});

describe("computeEntry — fórmula livre de total", () => {
  it("compõe as variáveis EFETIVAS (override alimenta o total livre)", () => {
    // total = valor(f_a) × 2 + bônus.
    const cfg = makeConfig({
      totalFormula: f(
        ref(compFactorRef("f_a", "valor")),
        op("*"),
        num(2),
        op("+"),
        ref(COMP_BONUS_REF)
      ),
    });
    const inputs = parseCompEntryInputs({
      bonuses: [{ id: "b", label: "x", amount: 50 }],
    });
    let bd = computeEntry(cfg, 1000, inputs, { f_a: 80, f_b: 10 }, { f_a: 100, f_b: 10 });
    expect(bd.totalFromFormula).toBe(true);
    expect(bd.total).toBe(1010); // 480×2 + 50
    // Override do payout de f_a muda o total livre em sincronia.
    bd = computeEntry(
      cfg,
      1000,
      parseCompEntryInputs({
        overrides: { factors: { f_a: { payout: 100 } } },
        bonuses: [{ id: "b", label: "x", amount: 50 }],
      }),
      { f_a: 80, f_b: 10 },
      { f_a: 100, f_b: 10 }
    );
    expect(bd.total).toBe(250);
  });

  it("resultado inválido (div/0, ref ausente) ⇒ total null, nunca 0", () => {
    const cfg = makeConfig({
      totalFormula: f(ref(COMP_BASE_REF), op("/"), num(0)),
    });
    const bd = computeEntry(cfg, 1000, emptyInputs(), { f_a: 1, f_b: 1 }, { f_a: 1, f_b: 1 });
    expect(bd.total).toBeNull();
    expect(bd.totalFormulaError).toBe(true);
    // overrides.total vence até a fórmula quebrada.
    const bd2 = computeEntry(
      cfg,
      1000,
      parseCompEntryInputs({ overrides: { total: 700 } }),
      { f_a: 1, f_b: 1 },
      { f_a: 1, f_b: 1 }
    );
    expect(bd2.total).toBe(700);
  });

  it("comp:fatores e comp:base entram no contexto", () => {
    const cfg = makeConfig({
      totalFormula: f(
        ref(COMP_FACTORS_REF),
        op("+"),
        ref(COMP_BASE_REF),
        op("*"),
        num(0.1)
      ),
    });
    const bd = computeEntry(cfg, 1000, emptyInputs(), { f_a: 80, f_b: 10 }, { f_a: 100, f_b: 10 });
    expect(bd.total).toBe(980); // 880 + 100
  });
});

describe("compOperandCatalog", () => {
  it("deriva 4 refs por fator + 3 totais, com rótulos por fator", () => {
    const cat = compOperandCatalog(makeConfig());
    expect(cat).toHaveLength(11);
    const refs = cat.map((o) => o.ref);
    expect(refs).toContain("comp:f:f_a:valor");
    expect(refs).toContain(COMP_BASE_REF);
    expect(new Set(refs).size).toBe(refs.length);
    const valor = cat.find((o) => o.ref === "comp:f:f_a:valor");
    expect(valor?.label).toBe("Vendas — Valor (R$)");
  });
});

describe("monthPeriod / lastDayOfMonth / roundMoney", () => {
  it("cobre fevereiro bissexto e dezembro", () => {
    expect(lastDayOfMonth(2024, 2)).toBe(29);
    expect(lastDayOfMonth(2026, 2)).toBe(28);
    expect(lastDayOfMonth(2026, 12)).toBe(31);
  });

  it("monta bounds YYYY-MM-DD e fieldBySource p/ todas as fontes (subs incl.)", () => {
    const period = monthPeriod(2026, 7, [
      {
        key: "negocios",
        recordType: "negocios",
        label: "Negócios",
        shortLabel: "Neg",
        defaultPeriodField: "closed_at",
        builtin: true,
        manualEntry: false,
      },
      {
        key: "estudo",
        recordType: "negocios",
        label: "Estudo",
        shortLabel: "Est",
        defaultPeriodField: "source_created_at",
        builtin: false,
        manualEntry: false,
        parentKey: "negocios",
      },
    ]);
    expect(period.from).toBe("2026-07-01");
    expect(period.to).toBe("2026-07-31");
    expect(period.fieldBySource).toEqual({
      negocios: "closed_at",
      estudo: "source_created_at",
    });
  });

  it("roundMoney arredonda a 2 casas", () => {
    expect(roundMoney(10.005)).toBe(10.01);
    expect(roundMoney(880.0000001)).toBe(880);
  });
});
