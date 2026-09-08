// Versão: 1.0 | Data: 08/09/2026
// Guardas do contrato `remuneracao-edit`. O que se pina aqui não é "o validador
// recusa JSON torto" — é o conjunto de PERDAS SILENCIOSAS que o merge existe
// para impedir: id de fator regenerado (orfanaria overrides, agrupamento e as
// metas de todos os meses), chave não mencionada apagada, plano inativo
// reativado, memberTiers destruídas e meta virando 0 em vez de sumir.
import { describe, expect, it } from "vitest";

import type { CompPlanConfig } from "@/lib/comp/model";
import type { Formula, FormulaToken } from "@/lib/records/formulas";
import type { OperandRef } from "@/lib/records/date-operands";

import { MAX_AI_COMP_TARGETS, type CompEditContext } from "./types";
import { validateCompEdit, type CompEditDeps } from "./validate";

const f = (...tokens: FormulaToken[]): Formula => ({ tokens });
const ref = (r: string): FormulaToken => ({ kind: "field", ref: r });

function baseConfig(): CompPlanConfig {
  return {
    v: 1,
    apuracao: "mes_anterior",
    presetKey: "preset_x",
    factors: [
      {
        id: "f_vendas",
        label: "Vendas",
        weightPct: 60,
        metricKey: "comp_vendas",
        money: true,
        formula: f(ref("agg:sum:value")),
        sources: ["negocios"],
        filters: [{ field: "pipeline", op: "eq", value: "Novos" }],
        memberTeams: { r1: ["r2"] },
      },
    ],
    commissions: [
      {
        id: "c_com",
        label: "Comissão",
        triggerFactorId: "f_vendas",
        basisKind: "base",
        tierBy: "attainment",
        kind: "pct",
        tiers: [{ fromPct: 100, ratePct: 5 }],
        memberTiers: { r1: [{ fromPct: 100, ratePct: 9 }] },
      },
    ],
  } as CompPlanConfig;
}

function makeCtx(atual: CompPlanConfig, active = true): CompEditContext {
  return {
    planId: "p1",
    planName: "Comercial",
    planActive: active,
    atualJson: JSON.stringify(atual),
    fatores: atual.factors.map((x) => ({
      nome: x.label,
      pesoPct: x.weightPct,
      formulaTexto: "SOMA([Valor])",
    })),
    comissoes: (atual.commissions ?? []).map((b) => b.label ?? b.id),
    membros: [{ nome: "Maria Silva" }, { nome: "João Souza" }],
    operacoes: ["Comercial"],
    fontes: ["negocios"],
    campos: [{ ref: "value", label: "Valor" }],
    moedas: ["BRL"],
    ano: 2026,
    mes: 9,
  };
}

const aggCatalog: OperandRef[] = [
  { ref: "agg:sum:value", label: "Valor" },
  { ref: "agg:count:title", label: "Título" },
] as OperandRef[];

function makeDeps(atual: CompPlanConfig): CompEditDeps {
  let n = 0;
  return {
    aggCatalog,
    compCatalogFor: () =>
      [{ ref: "comp:base", label: "Base variável" }] as OperandRef[],
    atual,
    newId: (prefix) => `${prefix}_novo${++n}`,
    memberIdByName: (name) =>
      ({ "Maria Silva": "r1", "João Souza": "r2" })[name] ?? null,
    operationIdByName: (name) => (name === "Comercial" ? "op1" : null),
  };
}

function run(body: Record<string, unknown>, atual = baseConfig(), active = true) {
  return validateCompEdit(
    JSON.stringify({ formato: "remuneracao-edit", versao: 1, ...body }),
    makeCtx(atual, active),
    makeDeps(atual)
  );
}

describe("merge do delta sobre a config existente", () => {
  it("preserva o que a IA não mencionou (presetKey, filtros, memberTeams)", () => {
    // O round-trip do plan-editor re-emite estas chaves; um delta que as
    // apagasse destruiria o recorte do fator no primeiro apply.
    const res = run({ plano: { fatores: [{ nome: "Vendas", pesoPct: 70 }] } });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.resolved) return;
    const vendas = res.resolved.config.factors[0];
    expect(res.resolved.config.presetKey).toBe("preset_x");
    expect(vendas.filters).toEqual([
      { field: "pipeline", op: "eq", value: "Novos" },
    ]);
    expect(vendas.memberTeams).toEqual({ r1: ["r2"] });
    expect(vendas.sources).toEqual(["negocios"]);
  });

  it("fator casado por rótulo HERDA id e metricKey", () => {
    const res = run({ plano: { fatores: [{ nome: "vendas", pesoPct: 40 }] } });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.resolved) return;
    const vendas = res.resolved.config.factors[0];
    expect(vendas.id).toBe("f_vendas");
    expect(vendas.metricKey).toBe("comp_vendas");
    expect(vendas.weightPct).toBe(40);
  });

  it("renomear NÃO cria fator novo (o casamento é pelo rótulo ATUAL)", () => {
    const res = run({
      plano: { fatores: [{ nome: "Vendas", novoNome: "Receita" }] },
    });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.resolved) return;
    expect(res.resolved.config.factors).toHaveLength(1);
    expect(res.resolved.config.factors[0].id).toBe("f_vendas");
    expect(res.resolved.config.factors[0].label).toBe("Receita");
  });

  it("fator NOVO exige fórmula e ganha o sentinela de métrica", () => {
    const semFormula = run({ plano: { fatores: [{ nome: "Reuniões" }] } });
    expect(semFormula.ok).toBe(false);

    const res = run({
      plano: {
        fatores: [
          { nome: "Reuniões", pesoPct: 30, formulaTexto: "CONT.VALORES([Título])" },
        ],
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.resolved) return;
    const novo = res.resolved.config.factors[1];
    expect(novo.id).toBe("f_novo1");
    expect(novo.metricKey).toBe("__auto__");
  });

  it("delta sem 'ativo' NÃO reativa um plano desativado", () => {
    const res = run({ plano: { fatores: [] } }, baseConfig(), false);
    expect(res.ok).toBe(true);
    if (!res.ok || !res.resolved) return;
    expect(res.resolved.ativo).toBe(false);
  });
});

describe("comissões", () => {
  it("bloco de mesmo rótulo herda id e PRESERVA as tabelas por membro", () => {
    const res = run({
      plano: {
        comissoes: [
          {
            nome: "Comissão",
            gatilho: "Vendas",
            base: "base",
            faixas: [{ aPartirDe: 80, percentual: 6 }],
          },
        ],
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.resolved) return;
    const bloco = res.resolved.config.commissions?.[0];
    expect(bloco?.id).toBe("c_com");
    expect(bloco?.memberTiers).toEqual({ r1: [{ fromPct: 100, ratePct: 9 }] });
    expect(bloco?.tiers).toEqual([{ fromPct: 80, ratePct: 6 }]);
  });

  it("a lista presente SUBSTITUI a anterior inteira", () => {
    const res = run({ plano: { comissoes: [] } });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.resolved) return;
    expect(res.resolved.config.commissions).toEqual([]);
  });

  it("per_unit exige base de FATOR (senão não há o que multiplicar)", () => {
    const res = run({
      plano: {
        comissoes: [
          {
            nome: "Por reunião",
            gatilho: "Vendas",
            base: "base",
            tipo: "per_unit",
            faixas: [{ aPartirDe: 0, valor: 50 }],
          },
        ],
      },
    });
    expect(res.ok).toBe(false);
  });

  it("gatilho desconhecido é erro, nunca bloco sem gatilho", () => {
    const res = run({
      plano: {
        comissoes: [
          {
            nome: "X",
            gatilho: "Não existe",
            base: "base",
            faixas: [{ aPartirDe: 0, percentual: 1 }],
          },
        ],
      },
    });
    expect(res.ok).toBe(false);
  });
});

describe("filtros do recorte", () => {
  it("recusa operador INTERNO (seria dropado em silêncio pelo modo lista)", () => {
    const res = run({
      plano: {
        fatores: [
          { nome: "Vendas", filtros: [{ field: "pipeline", op: "eq_ci", value: "x" }] },
        ],
      },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join(" ")).toContain("eq_ci");
  });

  it("null LIMPA o recorte; lista substitui", () => {
    const limpo = run({ plano: { fatores: [{ nome: "Vendas", filtros: null }] } });
    expect(limpo.ok).toBe(true);
    if (!limpo.ok || !limpo.resolved) return;
    expect(limpo.resolved.config.factors[0].filters).toBeUndefined();
  });
});

describe("metas", () => {
  it("resolve membro por nome e fator por rótulo; null é EXCLUSÃO, não 0", () => {
    const res = run({
      metas: [
        { membro: "Maria Silva", fator: "Vendas", valor: 50000 },
        { membro: "João Souza", fator: "Vendas", valor: null },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.resolved) return;
    expect(res.resolved.targets).toEqual([
      { responsibleId: "r1", factorId: "f_vendas", value: 50000 },
      { responsibleId: "r2", factorId: "f_vendas", value: null },
    ]);
  });

  it("membro desconhecido é erro (nunca meta em branco)", () => {
    const res = run({ metas: [{ membro: "Fulano", fator: "Vendas", valor: 1 }] });
    expect(res.ok).toBe(false);
  });

  it("respeita o teto do lote", () => {
    const metas = Array.from({ length: MAX_AI_COMP_TARGETS + 1 }, () => ({
      membro: "Maria Silva",
      fator: "Vendas",
      valor: 1,
    }));
    const res = run({ metas });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join(" ")).toContain(String(MAX_AI_COMP_TARGETS));
  });
});

describe("forma da resposta", () => {
  it("exige ao menos uma seção", () => {
    const res = run({});
    expect(res.ok).toBe(false);
  });

  it("recusa formato/versão errados", () => {
    const r1 = validateCompEdit(
      JSON.stringify({ formato: "outro", versao: 1, metas: [] }),
      makeCtx(baseConfig()),
      makeDeps(baseConfig())
    );
    expect(r1.ok).toBe(false);
  });
});
