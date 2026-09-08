// Versão: 1.0 | Data: 08/09/2026
// Paridade do SPEC de REMUNERAÇÃO com as constantes reais (molde de
// lib/import/operations/instructions.test.ts). Teto novo em model.ts ou bound
// novo em plan-validate.ts que não chegue ao texto reprova aqui, e o EXEMPLO
// do prompt roda pelo validador REAL — o prompt nunca ensina um JSON que o
// próprio sistema recusaria.
import { describe, expect, it } from "vitest";

import {
  MAX_COMMISSION_BLOCKS,
  MAX_COMMISSION_TIERS,
  MAX_FACTOR_FILTERS,
  MAX_FACTORS,
} from "@/lib/comp/model";
import {
  MAX_TIER_ATTAINMENT_PCT,
  MAX_TIER_RATE_PCT,
  MAX_WEIGHT_PCT,
} from "@/lib/comp/plan-validate";
import { FILTER_OPS } from "@/lib/widgets/filter-ops";
import type { Formula, FormulaToken } from "@/lib/records/formulas";
import type { OperandRef } from "@/lib/records/date-operands";
import type { CompPlanConfig } from "@/lib/comp/model";

import {
  COMP_SPEC,
  COMP_SPEC_EXAMPLE,
  buildCompPromptText,
} from "./instructions";
import { MAX_AI_COMP_TARGETS, type CompEditContext } from "./types";
import { validateCompEdit, type CompEditDeps } from "./validate";

const f = (...tokens: FormulaToken[]): Formula => ({ tokens });
const ref = (r: string): FormulaToken => ({ kind: "field", ref: r });

const atual: CompPlanConfig = {
  v: 1,
  factors: [
    {
      id: "f_vendas",
      label: "Vendas",
      weightPct: 60,
      metricKey: "comp_vendas",
      money: true,
      formula: f(ref("agg:sum:value")),
      sources: [],
    },
  ],
};

const ctx: CompEditContext = {
  planId: "p1",
  planName: "Comercial",
  planActive: true,
  atualJson: JSON.stringify(atual),
  fatores: [{ nome: "Vendas", pesoPct: 60, formulaTexto: "SOMA([Valor])" }],
  comissoes: [],
  membros: [{ nome: "Maria Silva" }, { nome: "João Souza" }],
  operacoes: ["Comercial"],
  fontes: ["negocios"],
  campos: [
    { ref: "value", label: "Valor" },
    { ref: "title", label: "Título" },
    { ref: "pipeline", label: "Funil" },
  ],
  moedas: ["BRL"],
  ano: 2026,
  mes: 9,
};

/** Catálogo mínimo com os operandos do exemplo. */
const aggCatalog: OperandRef[] = [
  { ref: "agg:sum:value", label: "Valor" },
  { ref: "agg:count:title", label: "Título" },
] as OperandRef[];

const deps: CompEditDeps = {
  aggCatalog,
  compCatalogFor: () => [{ ref: "comp:base", label: "Base variável" }] as OperandRef[],
  atual,
  newId: (prefix) => `${prefix}_novo`,
  memberIdByName: (name) =>
    ({ "Maria Silva": "r1", "João Souza": "r2" })[name] ?? null,
  operationIdByName: (name) => (name === "Comercial" ? "op1" : null),
};

describe("SPEC de remuneração — derivado das constantes reais", () => {
  it.each([
    ["MAX_FACTORS", MAX_FACTORS],
    ["MAX_COMMISSION_BLOCKS", MAX_COMMISSION_BLOCKS],
    ["MAX_COMMISSION_TIERS", MAX_COMMISSION_TIERS],
    ["MAX_FACTOR_FILTERS", MAX_FACTOR_FILTERS],
    ["MAX_WEIGHT_PCT", MAX_WEIGHT_PCT],
    ["MAX_TIER_ATTAINMENT_PCT", MAX_TIER_ATTAINMENT_PCT],
    ["MAX_TIER_RATE_PCT", MAX_TIER_RATE_PCT],
    ["MAX_AI_COMP_TARGETS", MAX_AI_COMP_TARGETS],
  ])("interpola %s", (_nome, valor) => {
    expect(COMP_SPEC).toContain(String(valor));
  });

  it("interpola todos os operadores de filtro", () => {
    for (const { op } of FILTER_OPS) expect(COMP_SPEC).toContain(op);
  });

  it("declara as invariantes que o sistema cobra", () => {
    // Cada uma destas frases evita um erro que o validador só sabe RECUSAR —
    // e as duas primeiras evitam perda de dado silenciosa.
    expect(COMP_SPEC).toContain("NUNCA emite id");
    expect(COMP_SPEC).toContain("EXCLUI a meta");
    expect(COMP_SPEC).toContain("SUBSTITUI a proposta pendente INTEIRA");
    expect(COMP_SPEC).toContain("PRESERVADA");
    expect(COMP_SPEC).toContain("LOOKUP");
  });

  it("avisa que zero NÃO é 'sem meta'", () => {
    // target 0 envenena o atingimento; o contrato usa null para excluir.
    expect(COMP_SPEC).toContain("nunca use 0");
  });
});

describe("SPEC de remuneração — o EXEMPLO passa pelo validador REAL", () => {
  it("valida e resolve as duas seções", () => {
    const res = validateCompEdit(COMP_SPEC_EXAMPLE, ctx, deps);
    expect(res.ok ? [] : res.errors).toEqual([]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.resolved).toBeDefined();
    expect(res.warnings).toHaveLength(1);
  });

  it("o fator existente HERDA o id (chave de overrides e metas)", () => {
    const res = validateCompEdit(COMP_SPEC_EXAMPLE, ctx, deps);
    expect(res.ok).toBe(true);
    if (!res.ok || !res.resolved) return;
    const vendas = res.resolved.config.factors.find((x) => x.label === "Vendas");
    expect(vendas?.id).toBe("f_vendas");
    expect(vendas?.metricKey).toBe("comp_vendas");
    // ... e o peso do delta venceu.
    expect(vendas?.weightPct).toBe(70);
  });

  it("o fator NOVO ganha id do servidor e metricKey sentinela", () => {
    const res = validateCompEdit(COMP_SPEC_EXAMPLE, ctx, deps);
    expect(res.ok).toBe(true);
    if (!res.ok || !res.resolved) return;
    const reunioes = res.resolved.config.factors.find(
      (x) => x.label === "Reuniões"
    );
    expect(reunioes?.id).toBe("f_novo");
    expect(reunioes?.metricKey).toBe("__auto__");
  });

  it("as metas saem resolvidas por id, com null preservado", () => {
    const res = validateCompEdit(COMP_SPEC_EXAMPLE, ctx, deps);
    expect(res.ok).toBe(true);
    if (!res.ok || !res.resolved) return;
    expect(res.resolved.targets).toEqual([
      { responsibleId: "r1", factorId: "f_vendas", value: 50000 },
      { responsibleId: "r2", factorId: "f_vendas", value: null },
    ]);
  });
});

describe("buildCompPromptText", () => {
  it("embute SPEC e catálogo", () => {
    const prompt = buildCompPromptText({
      catalogJson: JSON.stringify({ plano: "Comercial" }),
    });
    expect(prompt).toContain("FORMATO DA RESPOSTA");
    expect(prompt).toContain("PLANO ATUAL E CATÁLOGO (JSON)");
    expect(prompt).toContain(COMP_SPEC);
    expect(prompt).toContain("Comercial");
  });
});
