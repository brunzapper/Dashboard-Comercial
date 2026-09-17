// Versão: 1.0 | Data: 17/09/2026
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

const manualTables = (entries: unknown[]): Record<string, TableHandler> => ({
  manual_series: SERIES,
  manual_entries: entries,
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
