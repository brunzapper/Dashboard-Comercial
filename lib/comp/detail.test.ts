// Versão: 1.1 | Data: 16/08/2026
// v1.1: o detalhamento passou a ser por OPERANDO — a unidade que o
// runCalculatedWidget realmente consulta. Os testes pinam a PARIDADE do
// recorte: expansão de campo calculado agregado, condições de SOMASE, escopo
// de fonte (universo + coluna de data própria) e o recorte de "campo
// preenchido" que o SQL da RPC define (nullif(campo,'')). Sem isso a listagem
// trazia tudo do responsável e enchia de linhas R$ 0,00.
// Testes do núcleo do DETALHAMENTO por registro (lib/comp/detail.ts) — o mesmo
// que alimenta o painel de conferência da tela e as abas Det-<Nome> do export.
// O que está pinado aqui é a PARIDADE com o recorte do realizado: ordem dos
// filtros (factor.filters e DEPOIS o filtro de membro, como no engine), match
// de membro por campo, período do mês APURADO e os avisos honestos quando a
// listagem não consegue reproduzir o recorte da agregação.
// O contexto é montado à mão (os loaders do loadCompDetailContext já são
// cobertos por engine.test.ts); só a tabela `records` é fingida.
import { describe, expect, it } from "vitest";

import type { Formula } from "@/lib/records/formulas";
import type { FieldDefinition } from "@/lib/records/types";
import type { SourceDef } from "@/lib/sources";
import { EMPTY_CANON } from "@/lib/config/responsible-canon";
import { fakeSupabase } from "@/tests/helpers/fake-supabase";
import { buildAvailableFields } from "@/lib/widgets/fields";

import {
  factorOperands,
  loadFactorRecords,
  operandRecordQuery,
  MAX_DETAIL_ROWS_PER_FACTOR,
  type CompDetailContext,
  type DetailPlan,
  type FactorOperand,
} from "./detail";
import { monthPeriod, type CompFactor, type CompPlanConfig } from "./model";

const M1 = "11111111-1111-4111-8111-111111111111";

const f = (...refs: string[]): Formula => ({
  tokens: refs.map((ref) => ({ kind: "field", ref })),
});

const SOURCES: SourceDef[] = [
  {
    key: "negocios",
    recordType: "negocio",
    label: "Negócios",
    shortLabel: "Neg",
    defaultPeriodField: "closed_at",
    builtin: true,
    manualEntry: false,
  },
  {
    key: "reunioes",
    recordType: "reuniao",
    label: "Reuniões",
    shortLabel: "Reu",
    defaultPeriodField: "source_created_at",
    builtin: true,
    manualEntry: false,
  },
];

// `mrr_total` é calculado_agg: a fórmula do fator que o referencia precisa ser
// EXPANDIDA antes de virar operando (era a causa do "0 registros no recorte").
const FIELDS: FieldDefinition[] = [
  {
    field_key: "mrr_contrato",
    label: "MRR do contrato",
    data_type: "moeda",
  } as FieldDefinition,
  {
    field_key: "mrr_total",
    label: "MRR total",
    data_type: "calculado_agg",
    formula: f("agg:sum:custom:mrr_contrato"),
  } as FieldDefinition,
];

const factor = (over: Partial<CompFactor> = {}): CompFactor => ({
  id: "f_v",
  label: "Vendas",
  weightPct: 60,
  metricKey: "comp_vendas",
  money: true,
  formula: f("agg:sum:value"),
  sources: ["negocios"],
  ...over,
});

function ctxWith(over: Partial<CompDetailContext> = {}): CompDetailContext {
  return {
    year: 2026,
    month: 8,
    sources: SOURCES,
    allFields: FIELDS,
    available: buildAvailableFields(FIELDS, [], SOURCES),
    canon: EMPTY_CANON,
    nameById: new Map([[M1, "Ana"]]),
    fkLabels: { responsibles: { [M1]: "Ana" } },
    plans: [],
    rootByRecordType: new Map([
      ["negocio", SOURCES[0]],
      ["reuniao", SOURCES[1]],
    ]),
    ...over,
  };
}

function planWith(
  config: Partial<CompPlanConfig> = {},
  year = 2026,
  month = 8
): DetailPlan {
  const full: CompPlanConfig = { v: 1, factors: [factor()], ...config };
  return {
    row: {
      id: "p1",
      name: "Plano A",
      active: true,
      base_amount_default: 1000,
      config: full,
    },
    config: full,
    period: monthPeriod(year, month, SOURCES),
    targetRates: {},
    entryByMember: new Map(),
    targetsByMember: new Map(),
  };
}

const opsOf = (over: Partial<CompFactor> = {}): FactorOperand[] =>
  factorOperands(ctxWith(), factor(over));

describe("factorOperands", () => {
  it("soma simples vira UM operando com rótulo do campo", () => {
    const ops = opsOf();
    expect(ops).toHaveLength(1);
    expect(ops[0].field).toBe("value");
    expect([...ops[0].aggs]).toEqual(["sum"]);
    expect(ops[0].conds).toEqual([]);
    expect(ops[0].label).toBe("Soma de Valor");
  });

  it("contagem de linhas não vira coluna de campo", () => {
    const ops = opsOf({ formula: f("agg:count:*") });
    expect(ops).toHaveLength(1);
    expect(ops[0].field).toBe("*");
    expect(ops[0].label).toBe("Contagem de registros");
  });

  it("MÉDIA colapsa sum+count no MESMO operando (um recorte, um bloco)", () => {
    const ops = opsOf({ formula: f("agg:sum:value", "agg:count:value") });
    expect(ops).toHaveLength(1);
    expect(ops[0].label).toBe("Média de Valor");
  });

  it("campo calculado_agg aninhado é EXPANDIDO antes de virar operando", () => {
    // Sem expandir, `custom:mrr_total` não é um `agg:` e o fator ficaria sem
    // operando nenhum — o "0 registros no recorte" que o usuário viu.
    const ops = opsOf({ formula: f("custom:mrr_total") });
    expect(ops).toHaveLength(1);
    expect(ops[0].field).toBe("custom:mrr_contrato");
    expect(ops[0].label).toBe("Soma de MRR do contrato");
  });

  it("SOMASE carrega as condições do operando", () => {
    const ops = opsOf({
      formula: f('aggif:["sum","custom:mrr_contrato",[["stage","=","Ganho"]]]'),
    });
    expect(ops).toHaveLength(1);
    expect(ops[0].conds).toEqual([
      { ref: "stage", op: "=", value: "Ganho" },
    ]);
  });

  it("operando com escopo de fonte é abaixado com o predicado da fonte", () => {
    const ops = opsOf({ formula: f("agg:sum:value@reunioes") });
    expect(ops).toHaveLength(1);
    expect(ops[0].scope).toBe("reunioes");
    expect(ops[0].conds).toEqual([
      { ref: "record_type", op: "=", value: "reuniao" },
    ]);
    // E o predicado chega à consulta com operador que a listagem aplica.
    const q = operandRecordQuery(
      ctxWith(),
      planWith(),
      factor({ formula: f("agg:sum:value@reunioes") }),
      ops[0],
      M1
    );
    if (!q.ok) throw new Error("esperava ok");
    expect(q.config.filters).toContainEqual({
      field: "record_type",
      op: "eq",
      value: "reuniao",
    });
  });

  it("operandos de campos diferentes viram blocos diferentes", () => {
    const ops = opsOf({
      formula: f("agg:sum:value", "agg:sum:custom:mrr_contrato"),
    });
    expect(ops.map((o) => o.field)).toEqual(["value", "custom:mrr_contrato"]);
  });
});

describe("operandRecordQuery", () => {
  const query = (over: Partial<CompFactor> = {}, idx = 0) => {
    const fac = factor(over);
    const ops = factorOperands(ctxWith(), fac);
    const q = operandRecordQuery(ctxWith(), planWith(), fac, ops[idx], M1);
    if (!q.ok) throw new Error(`esperava ok: ${q.error}`);
    return q;
  };

  it("ordem dos filtros: fator → membro → condições → campo preenchido", () => {
    const q = query({
      filters: [{ field: "stage", op: "eq", value: "ganho" }],
      formula: f('aggif:["sum","custom:mrr_contrato",[["pipeline","=","Novo"]]]'),
    });
    expect(q.config.filters).toEqual([
      { field: "stage", op: "eq", value: "ganho" },
      { field: "responsible_id", op: "eq", value: M1 },
      // Op de LISTA, nunca o interno `eq_ci` — o funil o descartaria em
      // silêncio e o recorte voltaria a ser "tudo do responsável".
      { field: "pipeline", op: "eq", value: "Novo" },
      { field: "custom:mrr_contrato", op: "not_null" },
      { field: "custom:mrr_contrato", op: "neq", value: "" },
    ]);
  });

  it("campo do núcleo leva só not_null (literal vazio quebraria o numérico)", () => {
    expect(query().config.filters).toEqual([
      { field: "responsible_id", op: "eq", value: M1 },
      { field: "value", op: "not_null" },
    ]);
  });

  it("contagem de linhas não filtra campo preenchido — o recorte é a linha", () => {
    expect(query({ formula: f("agg:count:*") }).config.filters).toEqual([
      { field: "responsible_id", op: "eq", value: M1 },
    ]);
  });

  it("universo une as fontes dos operandos escopados", () => {
    // A agregação consulta a união; restringir a factor.sources zerava o
    // operando de fora (o "0 registros" com realizado > 0).
    const q = query({ formula: f("agg:sum:value", "agg:sum:value@reunioes") }, 0);
    expect(q.config.sources).toEqual(["negocios", "reunioes"]);
  });

  it("operando escopado roda só na fonte dele, com a data DELA", () => {
    const q = query({ formula: f("agg:sum:value@reunioes") });
    expect(q.config.sources).toEqual(["reunioes"]);
    // monthPeriod dá closed_at às duas fontes; o escopo repõe a coluna própria.
    expect(q.period.fieldBySource?.reuniao ?? q.period.fieldBySource?.reunioes)
      .toBe("source_created_at");
  });

  it("período é o do plano (mês apurado quando config.apuracao)", () => {
    const fac = factor();
    const ops = factorOperands(ctxWith(), fac);
    const q = operandRecordQuery(
      ctxWith(),
      // O deslocamento vive no loader; aqui o plano já chega com julho.
      planWith({ apuracao: "mes_anterior" }, 2026, 7),
      fac,
      ops[0],
      M1
    );
    if (!q.ok) throw new Error("esperava ok");
    expect(q.period.from).toBe("2026-07-01");
    expect(q.period.to).toBe("2026-07-31");
  });

  it("memberField troca o filtro pelo CONJUNTO de nomes; sem nome vira erro", () => {
    const comCampo = factor({ memberField: "custom:sdr_reuniao" });
    const ops = factorOperands(ctxWith(), comCampo);
    const q = operandRecordQuery(ctxWith(), planWith(), comCampo, ops[0], M1);
    if (!q.ok) throw new Error("esperava ok");
    expect(q.config.filters[0]).toEqual({
      field: "custom:sdr_reuniao",
      op: "in",
      value: ["Ana"],
    });
    const semNome = operandRecordQuery(
      ctxWith({ nameById: new Map(), fkLabels: {} }),
      planWith(),
      comCampo,
      ops[0],
      M1
    );
    expect(semNome.ok).toBe(false);
  });

  it("avisa quando uma condição do fator não é reproduzível na listagem", () => {
    const q = query({
      filters: [{ field: "match:leads:stage", op: "eq", value: "x" }],
    });
    expect(q.warnings).toHaveLength(1);
    expect(q.warnings[0]).toContain("não pôde ser aplicada");
    // Recorte reproduzível não gera ruído.
    expect(
      query({ filters: [{ field: "custom:origem", op: "in", value: ["A"] }] })
        .warnings
    ).toEqual([]);
  });
});

describe("loadFactorRecords", () => {
  const recRows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `r${i}`,
      record_type: "negocio",
      title: `Negócio ${i}`,
      value: 100,
      currency: "BRL",
      stage: "Ganho",
      closed_at: "2026-08-1{}".replace("{}", String(i % 9)),
      responsible_id: M1,
      custom_fields: {},
      is_mock: false,
    }));

  const supa = (rows: unknown[], count = rows.length) =>
    fakeSupabase({
      tables: {
        records: () => ({ data: rows, error: null, count }),
        // attachMatches (match:<fonte>:) e os rótulos de FK do modo lista.
        record_matches: [],
        responsibles: [{ id: M1, display_name: "Ana" }],
      },
    });

  const load = (rows: unknown[], over: Partial<CompFactor> = {}, count?: number) =>
    loadFactorRecords(
      supa(rows, count ?? rows.length).db,
      ctxWith(),
      planWith(),
      factor(over),
      M1,
      999 // realizado oficial: NUNCA recalculado a partir das linhas
    );

  it("operando único de soma: Σ vira a quantidade confrontável", async () => {
    const out = await load(recRows(3));
    expect(out.realized).toBe(999); // autoridade intocada
    expect(out.operands).toHaveLength(1);
    expect(out.operands[0].listedSum).toBe(300);
    expect(out.operands[0].total).toBe(3);
    expect(out.operands[0].valueLabel).toBe("Valor");
    expect(out.operands[0].aggNote).toContain("Soma de Valor");
    expect(out.listedForCompare).toBe(300);
    expect(out.operands[0].rows[0]).toMatchObject({
      title: "Negócio 0",
      sourceLabel: "Negócios",
      responsibleLabel: "Ana",
      stage: "Ganho",
      value: 100,
    });
  });

  it("contagem: o confrontável é a QUANTIDADE do recorte, não uma soma", async () => {
    const out = await load(recRows(4), { formula: f("agg:count:*") });
    expect(out.listedForCompare).toBe(4);
    expect(out.operands[0].valueLabel).toBe("Registros");
  });

  it("média não tem número único a confrontar", async () => {
    const out = await load(recRows(2), {
      formula: f("agg:sum:value", "agg:count:value"),
    });
    expect(out.operands).toHaveLength(1);
    expect(out.listedForCompare).toBeNull();
  });

  it("fórmula que COMBINA operandos: um bloco cada, sem confronto", async () => {
    const out = await load(recRows(2), {
      formula: f("agg:sum:value", "agg:sum:custom:mrr_contrato"),
    });
    expect(out.operands).toHaveLength(2);
    expect(out.operands.map((o) => o.label)).toEqual([
      "Soma de Valor",
      "Soma de MRR do contrato",
    ]);
    // Comparar um Σ parcial com o realizado era exatamente o alarme falso.
    expect(out.listedForCompare).toBeNull();
  });

  it("recorte acima da janela trunca, avisa e não finge um Σ parcial", async () => {
    const out = await load(
      recRows(MAX_DETAIL_ROWS_PER_FACTOR + 1),
      {},
      4321
    );
    const op = out.operands[0];
    expect(op.rows).toHaveLength(MAX_DETAIL_ROWS_PER_FACTOR);
    expect(op.total).toBe(4321);
    expect(op.truncated).toBe(true);
    expect(op.listedSum).toBeNull();
    expect(out.listedForCompare).toBeNull();
    expect(op.warnings.join(" ")).toContain("primeiros de");
  });

  it("membro sem nome p/ o memberField: bloco sem linhas, com o motivo", async () => {
    const fac = factor({ memberField: "custom:sdr_reuniao" });
    const out = await loadFactorRecords(
      supa([]).db,
      ctxWith({ nameById: new Map(), fkLabels: {} }),
      planWith(),
      fac,
      M1,
      null
    );
    expect(out.operands[0].rows).toEqual([]);
    expect(out.operands[0].warnings).toHaveLength(1);
    expect(out.operands[0].warnings[0]).toContain("memberField");
  });
});
