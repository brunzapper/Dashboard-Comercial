// Versão: 1.3 | Data: 18/09/2026
// v1.3 (18/09/2026): FAMÍLIAS (0143). O caso de resiliência POR METADE é o que
//   pegou um defeito real: um `Promise.all` no loader fazia a ausência das
//   tabelas de família (mais novas que as de número) rejeitar a rodada inteira,
//   e a Base manual voltava VAZIA — os números sumiam do dashboard de quem
//   ainda não aplicou a migração.
// v1.2 (17/09/2026): regressão do card SÓ com métrica manual — o payload não
//   pode ir vazio ao RPC (ele ergue 'Widget sem dimensões nem métricas'). O
//   caso já existia aqui, mas asseverando só o VALOR: o fake não emula a
//   exceção do Postgres, então o teste passava com a consulta quebrada.
// Versão: 1.1 | Data: 17/09/2026
// v1.1 (17/09/2026): o RÓTULO da métrica manual vem do DADO (manualSeriesLabel)
//   — a série não está em `available`, e o fieldLabel devolveria o ref cru.
// A Base manual DENTRO do engine, com cliente fake (tests/helpers/fake-supabase).
//
// O que estes testes protegem, em ordem de gravidade:
//  1. `manual:` NUNCA chega ao RPC. Se chegasse, seria preciso recriar
//     run_widget_query — e, com ele, o espelho de snapshot (invariante 1).
//     A asserção é sobre os ARGUMENTOS gravados da chamada.
//  2. O número digitado se soma ao número sincronizado na MESMA linha — que é
//     o pedido inteiro ("dividir registros convertidos por e-mails
//     respondidos").
//  3. Um widget cujas métricas são todas manuais desenha barras, mesmo sem
//     registro nenhum.
//  4. Dimensão que não sabemos repartir devolve "—", não um número inventado.
import { describe, expect, it } from "vitest";

import { runWidget } from "@/lib/widgets/engine";
import type { WidgetConfig } from "@/lib/widgets/types";
import { fakeSupabase, type TableHandler } from "@/tests/helpers/fake-supabase";
import { AVAILABLE } from "@/tests/helpers/engine-fixtures";

const SERIES = [
  { id: "s-rep", key: "emails_replied", label: "# Emails replied", default_spread: "ancora", sort_order: 0 },
];

const entry = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  series_id: "s-rep",
  period_start: "2026-08-01",
  period_end: "2026-08-31",
  value: 35,
  responsible_id: null,
  operation_id: null,
  spread: "ancora",
  note: null,
  ...over,
});

// O fake é fail-closed: tabela sem handler LANÇA. Declarar as de família aqui
// é o que mantém honesto o "a base inteira foi consultada" — e o loader trata
// cada metade em separado, então um teste pode omitir números sem perder eixos.
const manualTables = (
  entries: unknown[],
  extra: Record<string, TableHandler> = {}
): Record<string, TableHandler> => ({
  manual_series: SERIES,
  manual_entries: entries,
  manual_families: [],
  manual_family_members: [],
  ...extra,
});

const config = (over: Partial<WidgetConfig>): WidgetConfig => ({
  source: "records",
  dimensions: [],
  metrics: [],
  filters: [],
  visual_type: "tabela",
  ...over,
});

const AGOSTO = { field: "closed_at", from: "2026-08-01", to: "2026-08-31" };
const MES = [{ field: "closed_at", transform: "month" as const }];

// Tudo o que desceu ao banco numa chamada, como texto — para procurar "manual:".
const payloadText = (args: Record<string, unknown>) =>
  JSON.stringify([args.p_dimensions, args.p_metrics, args.p_filters]);

describe("resiliência por metade (0143)", () => {
  it("falha nas tabelas de FAMÍLIA não derruba os NÚMEROS", async () => {
    const boom = () => {
      throw new Error("relation \"manual_families\" does not exist");
    };
    const { db } = fakeSupabase({
      rpc: {
        run_widget_query: () => ({
          data: [{ dim_1: "2026-08-01T00:00:00", metric_1: 12 }],
          error: null,
        }),
      },
      tables: {
        manual_series: SERIES,
        manual_entries: [entry()],
        manual_families: boom,
        manual_family_members: boom,
      },
    });

    const data = await runWidget(
      db,
      config({
        dimensions: MES,
        metrics: [
          { field: "manual:emails_replied", agg: "sum" },
          { field: "*", agg: "count" },
        ],
      }),
      AVAILABLE,
      AGOSTO
    );

    // O número digitado continua lá — sem eixo nenhum, a Base manual é
    // exatamente o que era na 0142.
    expect(data.rows[0].metric_1).toBe(35);
    expect(data.rows[0].metric_2).toBe(12);
  });
});

describe("o ref manual: nunca desce ao RPC (invariante 1)", () => {
  it("métrica manual sai do p_metrics, e o RPC só recebe as de registro", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: {
        run_widget_query: () => ({
          data: [{ dim_1: "2026-08-01T00:00:00", metric_1: 12 }],
          error: null,
        }),
      },
      tables: manualTables([entry()]),
    });

    const data = await runWidget(
      db,
      config({
        dimensions: MES,
        metrics: [
          { field: "manual:emails_replied", agg: "sum" },
          { field: "*", agg: "count" },
        ],
      }),
      AVAILABLE,
      AGOSTO
    );

    for (const call of rpcCalls) {
      expect(payloadText(call.args)).not.toContain("manual:");
    }
    // O RPC recebeu SÓ a contagem; a métrica manual foi resolvida aqui.
    expect(rpcCalls[0].args.p_metrics).toEqual([{ field: "*", agg: "count" }]);
    // E as colunas voltaram na ordem da CONFIG, não na do RPC.
    expect(data.rows[0].metric_1).toBe(35);
    expect(data.rows[0].metric_2).toBe(12);
    // v1.1: o RÓTULO sai do DADO. A série não é AvailableField — sem
    // manualSeriesLabel o eixo exibiria "Soma · manual:emails_replied".
    expect(data.metrics[0].label).toBe("# Emails replied");
  });

  it("operando manual dentro de fórmula também não desce", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: {
        run_widget_query: () => ({
          data: [{ dim_1: "2026-08-01T00:00:00", metric_1: 7 }],
          error: null,
        }),
      },
      tables: manualTables([entry()]),
    });

    await runWidget(
      db,
      config({
        dimensions: MES,
        metrics: [
          {
            field: "calc:formula",
            agg: "sum",
            calc: true,
            formula: {
              tokens: [
                { kind: "field", ref: "agg:count:*" },
                { kind: "op", op: "/" },
                { kind: "field", ref: "manual:emails_replied" },
              ],
            },
          },
        ],
      }),
      AVAILABLE,
      AGOSTO
    );

    for (const call of rpcCalls) {
      expect(payloadText(call.args)).not.toContain("manual:");
    }
  });
});

describe("conversão: registro sincronizado ÷ número digitado", () => {
  const formula = {
    tokens: [
      { kind: "field" as const, ref: "agg:count:*" },
      { kind: "op" as const, op: "/" as const },
      { kind: "field" as const, ref: "manual:emails_replied" },
    ],
  };

  it("resolve por MÊS, com o lançamento caindo no bucket dele", async () => {
    const { db } = fakeSupabase({
      rpc: {
        run_widget_query: () => ({
          data: [
            { dim_1: "2026-07-01T00:00:00", metric_1: 3 },
            { dim_1: "2026-08-01T00:00:00", metric_1: 7 },
          ],
          error: null,
        }),
      },
      tables: manualTables([
        entry(),
        entry({
          id: "e2",
          period_start: "2026-07-01",
          period_end: "2026-07-31",
          value: 20,
        }),
      ]),
    });

    const data = await runWidget(
      db,
      config({
        dimensions: MES,
        metrics: [{ field: "calc:formula", agg: "sum", calc: true, formula }],
      }),
      AVAILABLE,
      { field: "closed_at", from: "2026-07-01", to: "2026-08-31" }
    );

    const byMonth = Object.fromEntries(
      data.rows.map((r) => [String(r.dim_1).slice(0, 7), r.metric_1])
    );
    expect(byMonth["2026-07"]).toBeCloseTo(3 / 20, 9);
    expect(byMonth["2026-08"]).toBeCloseTo(7 / 35, 9);
  });

  it("a basis carrega o valor manual — é o que faz o subtotal somar certo", async () => {
    const { db } = fakeSupabase({
      rpc: {
        run_widget_query: () => ({
          data: [{ dim_1: "2026-08-01T00:00:00", metric_1: 7 }],
          error: null,
        }),
      },
      tables: manualTables([entry()]),
    });

    const data = await runWidget(
      db,
      config({
        dimensions: MES,
        metrics: [{ field: "calc:formula", agg: "sum", calc: true, formula }],
      }),
      AVAILABLE,
      AGOSTO
    );
    expect(data.rows[0].__calcOps?.["manual:emails_replied"]).toBe(35);
  });

  it("sem lançamento no bucket o operando é 0, e a divisão não inventa número", async () => {
    const { db } = fakeSupabase({
      rpc: {
        run_widget_query: () => ({
          data: [{ dim_1: "2026-09-01T00:00:00", metric_1: 4 }],
          error: null,
        }),
      },
      tables: manualTables([entry()]),
    });

    const data = await runWidget(
      db,
      config({
        dimensions: MES,
        metrics: [{ field: "calc:formula", agg: "sum", calc: true, formula }],
      }),
      AVAILABLE,
      { field: "closed_at", from: "2026-09-01", to: "2026-09-30" }
    );
    // Divisão por zero vira null ("—"), nunca Infinity na tela.
    expect(data.rows[0].metric_1).toBeNull();
  });
});

describe("linhas que só existem na Base manual", () => {
  it("widget só-manual desenha barras mesmo sem registro nenhum", async () => {
    const { db } = fakeSupabase({
      rpc: { run_widget_query: () => ({ data: [], error: null }) },
      tables: manualTables([
        entry(),
        entry({ id: "e2", period_start: "2026-07-01", period_end: "2026-07-31", value: 20 }),
      ]),
    });

    const data = await runWidget(
      db,
      config({
        dimensions: MES,
        metrics: [{ field: "manual:emails_replied", agg: "sum" }],
      }),
      AVAILABLE,
      { field: "closed_at", from: "2026-07-01", to: "2026-08-31" }
    );

    expect(data.rows).toHaveLength(2);
    const byMonth = Object.fromEntries(
      data.rows.map((r) => [String(r.dim_1).slice(0, 7), r.metric_1])
    );
    expect(byMonth["2026-07"]).toBe(20);
    expect(byMonth["2026-08"]).toBe(35);
  });

  it("bucket sem registro mas com lançamento entra, com a contagem em 0", async () => {
    const { db } = fakeSupabase({
      rpc: {
        run_widget_query: () => ({
          data: [{ dim_1: "2026-08-01T00:00:00", metric_2: 7 }],
          error: null,
        }),
      },
      tables: manualTables([
        entry(),
        entry({ id: "e2", period_start: "2026-07-01", period_end: "2026-07-31", value: 20 }),
      ]),
    });

    const data = await runWidget(
      db,
      config({
        dimensions: MES,
        metrics: [
          { field: "manual:emails_replied", agg: "sum" },
          { field: "*", agg: "count" },
        ],
      }),
      AVAILABLE,
      { field: "closed_at", from: "2026-07-01", to: "2026-08-31" }
    );

    const julho = data.rows.find((r) => String(r.dim_1).startsWith("2026-07"))!;
    expect(julho.metric_1).toBe(20);
    expect(julho.metric_2).toBe(0);
  });
});

describe("degradação honesta", () => {
  it('dimensão que não sabemos repartir devolve "—", não um rateio inventado', async () => {
    const { db } = fakeSupabase({
      rpc: {
        run_widget_query: () => ({
          data: [
            { dim_1: "Inbound", metric_1: 5 },
            { dim_1: "Outbound", metric_1: 9 },
          ],
          error: null,
        }),
      },
      tables: manualTables([entry()]),
    });

    const data = await runWidget(
      db,
      config({
        dimensions: [{ field: "pipeline" }],
        metrics: [
          { field: "manual:emails_replied", agg: "sum" },
          { field: "*", agg: "count" },
        ],
      }),
      AVAILABLE,
      AGOSTO
    );

    expect(data.rows.map((r) => r.metric_1)).toEqual([null, null]);
    // A métrica de registro segue intacta.
    expect(data.rows.map((r) => r.metric_2)).toEqual([5, 9]);
  });

  it("widget sem ref manual nunca consulta a Base manual", async () => {
    const { db, queries } = fakeSupabase({
      rpc: {
        run_widget_query: () => ({ data: [{ dim_1: "A", metric_1: 1 }], error: null }),
      },
      tables: manualTables([entry()]),
    });

    await runWidget(
      db,
      config({ dimensions: [{ field: "pipeline" }], metrics: [{ field: "*", agg: "count" }] }),
      AVAILABLE,
      AGOSTO
    );

    expect(queries.filter((q) => q.table.startsWith("manual_"))).toHaveLength(0);
  });
});

describe("sem dimensão (KPI/card)", () => {
  it("o valor manual é a soma do PERÍODO", async () => {
    const { db } = fakeSupabase({
      rpc: { run_widget_query: () => ({ data: [{ metric_1: 100 }], error: null }) },
      tables: manualTables([
        entry({ spread: "diario" }),
        entry({ id: "e2", period_start: "2026-07-01", period_end: "2026-07-31", value: 999 }),
      ]),
    });

    const data = await runWidget(
      db,
      config({ dimensions: [], metrics: [{ field: "manual:emails_replied", agg: "sum" }] }),
      AVAILABLE,
      AGOSTO
    );
    // Julho está fora do período; agosto entra inteiro (rateio dentro da janela).
    expect(data.rows[0].metric_1).toBeCloseTo(35, 9);
  });

  // REGRESSÃO (17/09/2026): o RPC ergue `Widget sem dimensões nem métricas`
  // quando p_metrics E p_dimensions chegam vazios — e a métrica manual sai do
  // payload por não ser coluna. Sem dimensão e sem nenhuma métrica de registro,
  // a consulta ia vazia e o card exibia "Não foi possível carregar este widget".
  // O fake não emula a exceção do Postgres, então a asserção é sobre os
  // ARGUMENTOS (doutrina do topo deste arquivo): tem de ir a contagem
  // descartável que a guarda de `computeRows` empurra.
  it("métrica manual ÚNICA sem dimensão não manda SELECT vazio ao RPC", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: { run_widget_query: () => ({ data: [{ metric_1: 0 }], error: null }) },
      tables: manualTables([entry()]),
    });

    const data = await runWidget(
      db,
      config({ dimensions: [], metrics: [{ field: "manual:emails_replied", agg: "sum" }] }),
      AVAILABLE,
      AGOSTO
    );

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args.p_dimensions).toEqual([]);
    // Nem vazio (o RPC recusaria), nem com o ref manual (invariante 1).
    expect(rpcCalls[0].args.p_metrics).toEqual([{ field: "*", agg: "count" }]);
    expect(payloadText(rpcCalls[0].args)).not.toContain("manual:");
    // E o valor digitado chega na linha, por cima da contagem descartável.
    expect(data.rows[0].metric_1).toBe(35);
  });
});

describe("atribuição a operação", () => {
  it("a tupla do lançamento casa com a linha do RPC por operação", async () => {
    const { db } = fakeSupabase({
      rpc: {
        run_widget_query: () => ({
          data: [
            { dim_1: "op-out", metric_1: 6 },
            { dim_1: "op-in", metric_1: 2 },
          ],
          error: null,
        }),
      },
      tables: {
        ...manualTables([
          entry({ operation_id: "op-out", value: 35 }),
          entry({ id: "e2", operation_id: "op-in", value: 4 }),
        ]),
        operations: [
          { id: "op-out", name: "Outbound" },
          { id: "op-in", name: "Inbound" },
        ],
      },
    });

    const data = await runWidget(
      db,
      config({
        dimensions: [{ field: "operation_id" }],
        metrics: [
          { field: "manual:emails_replied", agg: "sum" },
          { field: "*", agg: "count" },
        ],
      }),
      [
        ...AVAILABLE,
        { field: "operation_id", label: "Operação", isNumeric: false, isDate: false, fk: "operation" },
      ],
      AGOSTO
    );

    // dim_1 já vem ROTULADA (fetchFkLabels roda depois da Base manual).
    const byOp = Object.fromEntries(data.rows.map((r) => [r.dim_1, r.metric_1]));
    expect(byOp["Outbound"]).toBe(35);
    expect(byOp["Inbound"]).toBe(4);
  });
});

// ===================== FAMÍLIAS E NÍVEIS (0143) =====================
// A fixture é o pedido literal do usuário: QUATRO leituras do MESMO 1000.
const CANAL = { id: "f-canal", key: "canal", label: "Canal", sort_order: 0 };
const FAM_RESP = { id: "f-resp", key: "vendedor", label: "Vendedor", sort_order: 1 };
const MEMBERS = [
  { id: "m-lig", family_id: "f-canal", key: "ligacao", label: "Ligação", sort_order: 0 },
  { id: "m-mail", family_id: "f-canal", key: "email", label: "E-mail", sort_order: 1 },
  { id: "m-paulo", family_id: "f-resp", key: "paulo", label: "Paulo", sort_order: 0 },
  { id: "m-gabi", family_id: "f-resp", key: "gabriella", label: "Gabriella", sort_order: 1 },
];
const INTER = [
  { id: "s-int", key: "interacoes", label: "Total de interações", default_spread: "ancora", sort_order: 0 },
];
const ent = (value: number, coords: Record<string, string | null>, id: string) => ({
  ...entry({ id, series_id: "s-int", value }),
  coords,
});
const NIVEIS = [
  ent(1000, {}, "n0"),
  ent(500, { canal: "ligacao" }, "c1"),
  ent(500, { canal: "email" }, "c2"),
  ent(600, { vendedor: "paulo" }, "v1"),
  ent(350, { vendedor: "gabriella" }, "v2"),
  ent(50, { vendedor: null }, "v3"),
  ent(100, { canal: "ligacao", vendedor: "paulo" }, "x1"),
  ent(250, { canal: "ligacao", vendedor: "gabriella" }, "x2"),
];
const famTables = (extra: Record<string, unknown> = {}) => ({
  manual_series: INTER,
  manual_entries: NIVEIS,
  manual_families: [CANAL, FAM_RESP],
  manual_family_members: MEMBERS,
  manual_series_families: [],
  ...extra,
});
const INT_METRIC = { field: "manual:interacoes", agg: "sum" as const };

describe("eixo de família (0143)", () => {
  it("manualdim: NUNCA chega ao RPC — e o RPC não é nem chamado", async () => {
    const { db, rpcCalls, queries } = fakeSupabase({ rpc: {}, tables: famTables() });

    const data = await runWidget(
      db,
      config({
        dimensions: [{ field: "manualdim:canal" }],
        metrics: [INT_METRIC],
      }),
      AVAILABLE,
      AGOSTO
    );

    // Sem handler de rpc, o fake LANÇA se alguém chamar — então zero chamadas
    // é o que prova o curto-circuito, e não só a ausência da string.
    expect(rpcCalls).toHaveLength(0);
    expect(queries.some((q) => q.table === "records")).toBe(false);
    expect(data.rows).toHaveLength(2);
  });

  it("destrincha o dado pai pela família, no nível {canal} e não no cruzamento", async () => {
    const { db } = fakeSupabase({ rpc: {}, tables: famTables() });
    const data = await runWidget(
      db,
      config({ dimensions: [{ field: "manualdim:canal" }], metrics: [INT_METRIC] }),
      AVAILABLE,
      AGOSTO
    );
    // Ordem pelo sort_order do MEMBRO, não pela iteração do Map.
    expect(data.rows.map((r) => r.dim_1)).toEqual(["Ligação", "E-mail"]);
    expect(data.rows.map((r) => r.metric_1)).toEqual([500, 500]);
    // O eixo sai rotulado pelo DADO, não pelo ref cru.
    expect(data.dimensions[0].label).toBe("Canal");
  });

  it("o residual é um GRUPO nomeado, nunca '—'", async () => {
    const { db } = fakeSupabase({ rpc: {}, tables: famTables() });
    const data = await runWidget(
      db,
      config({ dimensions: [{ field: "manualdim:vendedor" }], metrics: [INT_METRIC] }),
      AVAILABLE,
      AGOSTO
    );
    const byLabel = Object.fromEntries(data.rows.map((r) => [r.dim_1, r.metric_1]));
    expect(byLabel["Paulo"]).toBe(600);
    expect(byLabel["Gabriella"]).toBe(350);
    expect(byLabel["Sem Vendedor"]).toBe(50);
    expect(byLabel["—"]).toBeUndefined();
  });

  it("tabela cruzada Canal × Vendedor usa o nível cruzado", async () => {
    const { db } = fakeSupabase({ rpc: {}, tables: famTables() });
    const data = await runWidget(
      db,
      config({
        dimensions: [{ field: "manualdim:canal" }, { field: "manualdim:vendedor" }],
        metrics: [INT_METRIC],
      }),
      AVAILABLE,
      AGOSTO
    );
    expect(data.rows).toHaveLength(2);
    const cells = data.rows.map((r) => [r.dim_1, r.dim_2, r.metric_1]);
    expect(cells).toEqual([
      ["Ligação", "Paulo", 100],
      ["Ligação", "Gabriella", 250],
    ]);
  });

  it("métrica de REGISTRO num eixo de família vale null, nunca 0", async () => {
    const { db } = fakeSupabase({ rpc: {}, tables: famTables() });
    const data = await runWidget(
      db,
      config({
        dimensions: [{ field: "manualdim:canal" }],
        metrics: [INT_METRIC, { field: "*", agg: "count" }],
      }),
      AVAILABLE,
      AGOSTO
    );
    // 0 leria como "nenhum registro nesse canal", que é uma afirmação falsa:
    // nenhum registro é atribuível a um canal.
    expect(data.rows.every((r) => r.metric_2 === null)).toBe(true);
  });

  it("eixo de família DESCONHECIDO degrada para '—' em vez de inventar grupo", async () => {
    const { db } = fakeSupabase({ rpc: {}, tables: famTables() });
    const data = await runWidget(
      db,
      config({ dimensions: [{ field: "manualdim:sumiu" }], metrics: [INT_METRIC] }),
      AVAILABLE,
      AGOSTO
    );
    expect(data.rows.every((r) => r.metric_1 == null)).toBe(true);
  });
});

describe("filtro de coordenada (0143)", () => {
  it("card de um membro: o filtro leva ao nível do canal e soma embora", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: { run_widget_query: () => ({ data: [{ metric_1: 0 }], error: null }) },
      tables: famTables(),
    });
    const data = await runWidget(
      db,
      config({
        metrics: [INT_METRIC],
        filters: [{ field: "manualdim:canal", op: "eq", value: "ligacao" }],
      }),
      AVAILABLE,
      AGOSTO
    );
    expect(data.rows[0].metric_1).toBe(500);
    // O filtro de coordenada NÃO desce ao RPC.
    for (const call of rpcCalls) {
      expect(JSON.stringify(call.args.p_filters)).not.toContain("manualdim:");
    }
  });

  it("dois filtros descem à célula do cruzamento", async () => {
    const { db } = fakeSupabase({
      rpc: { run_widget_query: () => ({ data: [{ metric_1: 0 }], error: null }) },
      tables: famTables(),
    });
    const data = await runWidget(
      db,
      config({
        metrics: [INT_METRIC],
        filters: [
          { field: "manualdim:canal", op: "eq", value: "ligacao" },
          { field: "manualdim:vendedor", op: "eq", value: "gabriella" },
        ],
      }),
      AVAILABLE,
      AGOSTO
    );
    expect(data.rows[0].metric_1).toBe(250);
  });

  it("filtro do RESIDUAL seleciona o grupo, não a ausência", async () => {
    const { db } = fakeSupabase({
      rpc: { run_widget_query: () => ({ data: [{ metric_1: 0 }], error: null }) },
      tables: famTables(),
    });
    const data = await runWidget(
      db,
      config({
        metrics: [INT_METRIC],
        filters: [{ field: "manualdim:vendedor", op: "eq", value: "__sem__" }],
      }),
      AVAILABLE,
      AGOSTO
    );
    expect(data.rows[0].metric_1).toBe(50);
  });
});

describe("compatibilidade da 0142 (0143)", () => {
  it("org COM famílias, widget que não as usa: nada muda", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: {
        run_widget_query: () => ({
          data: [{ dim_1: "2026-08-01T00:00:00", metric_1: 12 }],
          error: null,
        }),
      },
      tables: famTables(),
    });
    const data = await runWidget(
      db,
      config({ dimensions: MES, metrics: [INT_METRIC, { field: "*", agg: "count" }] }),
      AVAILABLE,
      AGOSTO
    );
    // Sem família PEDIDA, o dado cai no nível ∅ — o total lançado à mão.
    expect(data.rows[0].metric_1).toBe(1000);
    expect(data.rows[0].metric_2).toBe(12);
    expect(rpcCalls[0].args.p_metrics).toEqual([{ field: "*", agg: "count" }]);
  });

  it("sem o total lançado, um card soma embora a família mais grossa", async () => {
    const { db } = fakeSupabase({
      rpc: { run_widget_query: () => ({ data: [{ metric_1: 0 }], error: null }) },
      tables: famTables({ manual_entries: NIVEIS.filter((e) => e.id !== "n0") }),
    });
    const data = await runWidget(
      db,
      config({ metrics: [INT_METRIC] }),
      AVAILABLE,
      AGOSTO
    );
    // 500 + 500 do nível {canal}, nunca os 3000 de somar todos os níveis.
    expect(data.rows[0].metric_1).toBe(1000);
  });
});
