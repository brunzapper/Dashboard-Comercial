// Versão: 1.4 | Data: 19/08/2026
// v1.4: bloco fundido traz UMA linha por REGISTRO (valor somado das partes —
// a mesma empresa saía repetida uma vez por operando) e operando SEM registros
// não vira bloco: o fator fica sem operandos e os consumidores declaram o
// vazio uma vez só, com os avisos do bloco descartado subindo para o fator.
// Versão: 1.3 | Data: 17/08/2026
// v1.3: o agrupamento virou "bloco PRINCIPAL que recebe os dobrados"
// ({into, folded}). O pino central é a REGRESSÃO do relato: com 2 operandos,
// dobrar UM tem de gerar UM bloco (a versão anterior não fundia nada em
// nenhuma combinação). Também pinado: unidades diferentes não viram um Σ
// inventado, e o config LEGADO passa a fundir como o usuário esperava.
// Versão: 1.2 | Data: 17/08/2026
// v1.2: agrupamento configurável dos blocos (engrenagem da Visão geral). O
// pino é que a fusão é de EXIBIÇÃO: cada operando segue sendo CONSULTADO no
// próprio recorte, só a apresentação soma — e com fusão em jogo não existe
// número único a confrontar com o realizado.
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
  groupOperands,
  loadFactorRecords,
  operandRecordQuery,
  MAX_DETAIL_ROWS_PER_FACTOR,
  type CompDetailContext,
  type DetailPlan,
  type FactorOperand,
} from "./detail";
import {
  monthPeriod,
  type CompBreakdown,
  type CompFactor,
  type CompPlanConfig,
} from "./model";

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

/**
 * Breakdown mínimo — o loader lê realizado/base/comissões DAQUI, nunca das
 * linhas. É o pino de que o número exibido vem do cálculo.
 */
const breakdownStub = (realized: number | null) =>
  ({
    base: 1000,
    byFactor: {
      f_v: {
        target: null,
        realized,
        attainmentPct: null,
        payout: 0,
        overridden: { realized: false, attainmentPct: false, payout: false },
        targetSource: null,
        targetBRL: null,
      },
    },
    factorsTotal: 0,
    bonusTotal: 0,
    commission: null,
    commissionBlocks: [],
    total: null,
    totalOverridden: false,
    totalFromFormula: false,
    totalFormulaError: false,
  }) as unknown as CompBreakdown;

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
      breakdownStub(999) // realizado oficial: NUNCA derivado das linhas
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
      breakdownStub(null)
    );
    // Bloco vazio não vira sub-bloco (era "· 0 registros" por operando); o
    // fator fica sem operandos — os consumidores dizem UMA vez que não houve
    // registro — e o AVISO sobe para o fator, nunca some junto com o bloco.
    expect(out.operands).toEqual([]);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain("memberField");
  });

  it("operando vazio some do detalhe, mas o que TEM registro fica", async () => {
    const fac = factor({
      formula: f("agg:sum:value", "agg:sum:custom:mrr_contrato"),
    });
    // A 2ª consulta (MRR) devolve vazio: o bloco dela não pode virar linha
    // "· 0 registros no recorte" ao lado do bloco populado.
    const s = fakeSupabase({
      tables: {
        records: (q) =>
          q.steps.some((st) =>
            JSON.stringify(st.args).includes("mrr_contrato")
          )
            ? { data: [], error: null, count: 0 }
            : { data: recRows(2), error: null, count: 2 },
        record_matches: [],
        responsibles: [{ id: M1, display_name: "Ana" }],
      },
    });
    const out = await loadFactorRecords(
      s.db,
      ctxWith(),
      planWith({ factors: [fac] }),
      fac,
      M1,
      breakdownStub(999)
    );
    expect(out.operands).toHaveLength(1);
    expect(out.operands[0].label).toBe("Soma de Valor");
  });

  it("REGRESSÃO: 2 operandos, um dobrado ⇒ UM bloco com o subtotal somado", async () => {
    // O relato: desmarcar um operando não fundia nada. Com 2 operandos — o
    // caso comum — a 1ª versão era inerte em QUALQUER combinação.
    const fac = factor({
      formula: f("agg:sum:value", "agg:sum:custom:mrr_contrato"),
    });
    const keys = factorOperands(ctxWith(), fac).map((o) => o.key);
    // Linhas com os DOIS campos preenchidos: só assim o subtotal fundido
    // exercita a soma das duas partes (100+100 de Valor, 50+50 de MRR).
    const rows = recRows(2).map((r) => ({
      ...r,
      custom_fields: { mrr_contrato: 50 },
    }));
    const s = supa(rows);
    const out = await loadFactorRecords(
      s.db,
      ctxWith(),
      planWith({
        factors: [fac],
        detailGrouping: { byFactor: { f_v: { into: keys[0], folded: [keys[1]] } } },
      }),
      fac,
      M1,
      breakdownStub(999)
    );
    // O recorte NÃO muda: os dois operandos seguem consultados em separado.
    expect(s.queries.filter((q) => q.table === "records")).toHaveLength(2);
    expect(out.operands).toHaveLength(1);
    const bloco = out.operands[0];
    // O bloco é do PRINCIPAL — herda o rótulo dele, não um genérico.
    expect(bloco.label).toBe("Soma de Valor");
    expect(bloco.mergedFrom).toEqual(["Soma de MRR do contrato"]);
    expect(bloco.aggNote).toContain("Soma de Valor + Soma de MRR do contrato");
    // UMA linha por REGISTRO (2 registros), com o valor somado das partes —
    // era o mesmo negócio repetido uma vez por operando.
    expect(bloco.rows).toHaveLength(2);
    expect(bloco.rows.map((r) => r.value)).toEqual([150, 150]);
    expect(bloco.total).toBe(2); // registros DISTINTOS, não 2+2
    expect(bloco.aggNote).toContain("2 registros");
    // Ambas as partes somam em R$: o subtotal é um número único.
    expect(bloco.listedSum).toBe(300); // 200 de Valor + 100 de MRR
    expect(bloco.sumParts).toEqual([]);
    // Com fusão em jogo não há número único a confrontar com o realizado.
    expect(out.listedForCompare).toBeNull();
  });

  it("registro presente em UM operando só entra com o valor que tem", async () => {
    const fac = factor({
      formula: f("agg:sum:value", "agg:sum:custom:mrr_contrato"),
    });
    const keys = factorOperands(ctxWith(), fac).map((o) => o.key);
    // Só o 2º negócio tem MRR — como o "Adicional ao MRR" do relato, que só
    // uma empresa tinha. Ele NÃO pode virar linha separada.
    const rows = recRows(2).map((r, i) => ({
      ...r,
      custom_fields: i === 1 ? { mrr_contrato: 70 } : {},
    }));
    const out = await loadFactorRecords(
      supa(rows).db,
      ctxWith(),
      planWith({
        factors: [fac],
        detailGrouping: { byFactor: { f_v: { into: keys[0], folded: [keys[1]] } } },
      }),
      fac,
      M1,
      breakdownStub(999)
    );
    const bloco = out.operands[0];
    expect(bloco.rows).toHaveLength(2);
    expect(bloco.rows.map((r) => r.value)).toEqual([100, 170]);
  });

  it("fusão de unidades DIFERENTES não inventa um total: mostra as parcelas", async () => {
    const fac = factor({ formula: f("agg:sum:value", "agg:count:*") });
    const keys = factorOperands(ctxWith(), fac).map((o) => o.key);
    const out = await loadFactorRecords(
      supa(recRows(2)).db,
      ctxWith(),
      planWith({
        factors: [fac],
        detailGrouping: { byFactor: { f_v: { into: keys[0], folded: [keys[1]] } } },
      }),
      fac,
      M1,
      breakdownStub(999)
    );
    const bloco = out.operands[0];
    // Somar contagem com dinheiro daria um número sem significado.
    expect(bloco.listedSum).toBeNull();
    expect(bloco.sumParts).toEqual([
      { label: "Soma de Valor", value: 200, money: true },
      { label: "Contagem de registros", value: 2, money: false },
    ]);
  });

  it("operando fora do principal e dos dobrados mantém bloco próprio", async () => {
    const fac = factor({
      formula: f("agg:sum:value", "agg:sum:custom:mrr_contrato", "agg:count:*"),
    });
    const keys = factorOperands(ctxWith(), fac).map((o) => o.key);
    const out = await loadFactorRecords(
      supa(recRows(1)).db,
      ctxWith(),
      planWith({
        factors: [fac],
        detailGrouping: { byFactor: { f_v: { into: keys[0], folded: [keys[1]] } } },
      }),
      fac,
      M1,
      breakdownStub(999)
    );
    expect(out.operands).toHaveLength(2);
    expect(out.operands[0].mergedFrom).toHaveLength(1);
    expect(out.operands[1].label).toBe("Contagem de registros");
    expect(out.operands[1].mergedFrom).toEqual([]);
  });
});

describe("groupOperands", () => {
  const ops3 = () =>
    opsOf({
      formula: f("agg:sum:value", "agg:sum:custom:mrr_contrato", "agg:count:*"),
    });
  const keysOf = (grupos: FactorOperand[][]) =>
    grupos.map((g) => g.map((o) => o.key));

  it("sem config, cada operando fica no próprio bloco (padrão)", () => {
    const ops = ops3();
    expect(keysOf(groupOperands(ops, "f_v", undefined))).toEqual(
      ops.map((o) => [o.key])
    );
  });

  it("o principal RECEBE os dobrados e vem primeiro no grupo", () => {
    const ops = ops3();
    const g = groupOperands(ops, "f_v", {
      byFactor: { f_v: { into: ops[1].key, folded: [ops[2].key] } },
    });
    // Ordem da fórmula preservada; o dobrado sai do bloco próprio.
    expect(keysOf(g)).toEqual([[ops[0].key], [ops[1].key, ops[2].key]]);
  });

  it("dobrar UM operando já funde (era exatamente o que faltava)", () => {
    const ops = ops3();
    const g = groupOperands(ops, "f_v", {
      byFactor: { f_v: { into: ops[0].key, folded: [ops[1].key] } },
    });
    expect(keysOf(g)).toEqual([
      [ops[0].key, ops[1].key],
      [ops[2].key],
    ]);
  });

  it("config apontando para operando inexistente volta ao padrão", () => {
    const ops = ops3();
    const g = groupOperands(ops, "f_v", {
      byFactor: { f_v: { into: "sumiu", folded: [ops[1].key] } },
    });
    expect(keysOf(g)).toEqual(ops.map((o) => [o.key]));
    const semDobrado = groupOperands(ops, "f_v", {
      byFactor: { f_v: { into: ops[0].key, folded: ["sumiu"] } },
    });
    expect(keysOf(semDobrado)).toEqual(ops.map((o) => [o.key]));
  });

  it("config de OUTRO fator não agrupa este", () => {
    const ops = ops3();
    const g = groupOperands(ops, "f_v", {
      byFactor: { f_outro: { into: ops[0].key, folded: [ops[1].key] } },
    });
    expect(g).toHaveLength(3);
  });

  it("LEGADO separateByFactor: o resto entra no 1º listado", () => {
    const ops = ops3();
    // Era "estes têm bloco próprio"; agora o não-listado é dobrado no 1º —
    // config já gravado passa a fazer o que o usuário esperava.
    const g = groupOperands(ops, "f_v", {
      byFactor: {},
      separateByFactor: { f_v: [ops[0].key] },
    });
    expect(keysOf(g)).toEqual([[ops[0].key, ops[1].key, ops[2].key]]);
  });

  it("shape novo VENCE o legado do mesmo fator", () => {
    const ops = ops3();
    const g = groupOperands(ops, "f_v", {
      byFactor: { f_v: { into: ops[2].key, folded: [ops[0].key] } },
      separateByFactor: { f_v: [ops[0].key] },
    });
    expect(keysOf(g)).toEqual([[ops[1].key], [ops[2].key, ops[0].key]]);
  });
});
