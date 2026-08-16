// Versão: 1.0 | Data: 16/08/2026
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
  factorRecordQuery,
  factorValueColumns,
  loadFactorRecords,
  MAX_DETAIL_ROWS_PER_FACTOR,
  type CompDetailContext,
  type DetailPlan,
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
];

const FIELDS: FieldDefinition[] = [];

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
    rootByRecordType: new Map([["negocio", SOURCES[0]]]),
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

describe("factorValueColumns", () => {
  it("pega os operandos agregados na ordem, sem repetir campo", () => {
    const cols = factorValueColumns(
      factor({ formula: f("agg:sum:value", "agg:sum:custom:bonus", "agg:sum:value") }),
      FIELDS
    );
    expect(cols.map((c) => c.ref)).toEqual(["value", "custom:bonus"]);
    expect(cols[0].agg).toBe("sum");
  });

  it("contagem não vira coluna (a evidência é a própria linha)", () => {
    expect(factorValueColumns(factor({ formula: f("agg:count:*") }), FIELDS)).toEqual(
      []
    );
  });
});

describe("factorRecordQuery", () => {
  it("filtros do fator vêm ANTES do filtro de membro (ordem do engine)", () => {
    const q = factorRecordQuery(
      ctxWith(),
      planWith(),
      factor({ filters: [{ field: "stage", op: "eq", value: "ganho" }] }),
      M1
    );
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.config.filters).toEqual([
      { field: "stage", op: "eq", value: "ganho" },
      { field: "responsible_id", op: "eq", value: M1 },
    ]);
    expect(q.config.sources).toEqual(["negocios"]);
    expect(q.config.settings).toEqual({ rowMode: "records" });
    expect(q.warnings).toEqual([]);
  });

  it("período é o do plano (mês apurado quando config.apuracao)", () => {
    const q = factorRecordQuery(
      ctxWith(),
      // O deslocamento vive no loader; aqui o plano já chega com julho.
      planWith({ apuracao: "mes_anterior" }, 2026, 7),
      factor(),
      M1
    );
    if (!q.ok) throw new Error("esperava ok");
    expect(q.period.from).toBe("2026-07-01");
    expect(q.period.to).toBe("2026-07-31");
  });

  it("memberField troca o filtro pelo CONJUNTO de nomes; sem nome vira erro", () => {
    const comCampo = factor({ memberField: "custom:sdr_reuniao" });
    const q = factorRecordQuery(ctxWith(), planWith(), comCampo, M1);
    if (!q.ok) throw new Error("esperava ok");
    expect(q.config.filters).toEqual([
      { field: "custom:sdr_reuniao", op: "in", value: ["Ana"] },
    ]);
    const semNome = factorRecordQuery(
      ctxWith({ nameById: new Map(), fkLabels: {} }),
      planWith(),
      comCampo,
      M1
    );
    expect(semNome.ok).toBe(false);
  });

  it("avisa quando a listagem não reproduz o recorte da agregação", () => {
    // Campo fora da whitelist do modo lista: o filtro seria DESCARTADO em
    // silêncio — o recorte listado sairia mais largo que o do cálculo.
    const dropado = factorRecordQuery(
      ctxWith(),
      planWith(),
      factor({ filters: [{ field: "match:leads:stage", op: "eq", value: "x" }] }),
      M1
    );
    if (!dropado.ok) throw new Error("esperava ok");
    expect(dropado.warnings).toHaveLength(1);
    expect(dropado.warnings[0]).toContain("não pôde ser aplicada");

    // Operando com escopo numa fonte fora de factor.sources: a agregação une
    // essa fonte, a listagem não.
    const escopado = factorRecordQuery(
      ctxWith(),
      planWith(),
      factor({ formula: f("agg:sum:value@outra") }),
      M1
    );
    if (!escopado.ok) throw new Error("esperava ok");
    expect(escopado.warnings[0]).toContain("bases fora desta listagem");

    // `custom:` e colunas do núcleo são reproduzíveis — sem ruído.
    const limpo = factorRecordQuery(
      ctxWith(),
      planWith(),
      factor({ filters: [{ field: "custom:origem", op: "in", value: ["A"] }] }),
      M1
    );
    if (!limpo.ok) throw new Error("esperava ok");
    expect(limpo.warnings).toEqual([]);
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

  it("soma a coluna listada e devolve o realizado OFICIAL intocado", async () => {
    const { db } = supa(recRows(3));
    const out = await loadFactorRecords(
      db,
      ctxWith(),
      planWith(),
      factor(),
      M1,
      999 // realizado oficial: NUNCA recalculado a partir das linhas
    );
    expect(out.realized).toBe(999);
    expect(out.listedSum).toBe(300);
    expect(out.total).toBe(3);
    expect(out.truncated).toBe(false);
    expect(out.valueLabel).toBe("Valor");
    expect(out.aggNote).toContain("Soma de Valor");
    expect(out.rows[0]).toMatchObject({
      title: "Negócio 0",
      sourceLabel: "Negócios",
      responsibleLabel: "Ana",
      stage: "Ganho",
      value: 100,
    });
  });

  it("média/mín/máx não somam (Σ direto não conferiria nada)", async () => {
    const { db } = supa(recRows(2));
    const out = await loadFactorRecords(
      db,
      ctxWith(),
      planWith(),
      factor({ formula: f("agg:avg:value") }),
      M1,
      100
    );
    expect(out.listedSum).toBeNull();
  });

  it("recorte acima da janela trunca com aviso e mantém a contagem exata", async () => {
    const { db } = supa(recRows(MAX_DETAIL_ROWS_PER_FACTOR + 1), 4321);
    const out = await loadFactorRecords(db, ctxWith(), planWith(), factor(), M1, 1);
    expect(out.rows).toHaveLength(MAX_DETAIL_ROWS_PER_FACTOR);
    expect(out.total).toBe(4321);
    expect(out.truncated).toBe(true);
    expect(out.warnings.join(" ")).toContain("primeiros de");
  });

  it("membro sem nome p/ o memberField: fator sem linhas, com o motivo", async () => {
    const { db } = supa([]);
    const out = await loadFactorRecords(
      db,
      ctxWith({ nameById: new Map(), fkLabels: {} }),
      planWith(),
      factor({ memberField: "custom:sdr_reuniao" }),
      M1,
      null
    );
    expect(out.rows).toEqual([]);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain("memberField");
  });
});
