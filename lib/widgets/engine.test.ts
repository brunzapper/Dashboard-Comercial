// Versão: 1.0 | Data: 24/07/2026
// Testes do ENGINE com cliente fake (tests/helpers/fake-supabase — mesmo shape
// do snapshotClient de produção). Travam os comportamentos que os RPCs não
// podem cobrir sozinhos: pernas por métrica (invariante 9), correspondências
// POR PERNA (membro da sub nunca vaza pro coalesce só-pai), alinhamento por
// dia útil (pernas mensais + businessDayRef), comparação (exclusão mútua com
// o align), fold monetário com fallback do @rate_date e a tradução nome→UUID
// das condições de relação.
import { describe, expect, it } from "vitest";

import {
  aggregateMoneyBreakdowns,
  fetchFkLabels,
  resolveFkCondFilters,
  runWidget,
} from "@/lib/widgets/engine";
import type { WidgetConfig, WidgetFilter } from "@/lib/widgets/types";
import { fakeSupabase } from "@/tests/helpers/fake-supabase";
import { AVAILABLE, CATALOG, CORRS } from "@/tests/helpers/engine-fixtures";

const baseConfig = (over: Partial<WidgetConfig>): WidgetConfig => ({
  source: "records",
  dimensions: [],
  metrics: [],
  filters: [],
  visual_type: "tabela",
  ...over,
});

// Filtro record_type in (...) de uma chamada gravada.
const recordTypesOf = (args: Record<string, unknown>): unknown =>
  (args.p_filters as WidgetFilter[]).find(
    (f) => f.field === "record_type" && f.op === "in"
  )?.value;

describe("pernas por métrica (Metric.sources)", () => {
  it("RPCs separadas com record_type por perna; merge por tupla de dims", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: {
        run_widget_query: (args) => {
          const rts = recordTypesOf(args) as string[];
          // Principal (só Deals) define as LINHAS; a perna (Leads+Deals) só
          // fornece a métrica dela por tupla.
          if (rts.length === 1) {
            return {
              data: [
                { dim_1: "A", metric_1: 2 },
                { dim_1: "C", metric_1: 4 },
              ],
              error: null,
            };
          }
          return {
            data: [
              { dim_1: "A", metric_1: 5 },
              { dim_1: "B", metric_1: 3 },
            ],
            error: null,
          };
        },
      },
    });
    const data = await runWidget(
      db,
      baseConfig({
        sources: ["deals"],
        dimensions: [{ field: "pipeline" }],
        metrics: [
          { field: "*", agg: "count" },
          { field: "*", agg: "count", sources: ["leads", "deals"] },
        ],
      }),
      AVAILABLE
    );

    expect(rpcCalls).toHaveLength(2);
    const main = rpcCalls.find(
      (c) => (recordTypesOf(c.args) as string[]).length === 1
    )!;
    const leg = rpcCalls.find(
      (c) => (recordTypesOf(c.args) as string[]).length === 2
    )!;
    expect(recordTypesOf(main.args)).toEqual(["negocio"]);
    expect(recordTypesOf(leg.args)).toEqual(["lead", "negocio"]);

    // Universo de linhas = consulta principal ("B" da perna não vira linha);
    // tupla presente na perna recebe o valor; ausente → contagem 0.
    expect(data.rows).toEqual([
      { dim_1: "A", metric_1: 2, metric_2: 5 },
      { dim_1: "C", metric_1: 4, metric_2: 0 },
    ]);
  });

  it("p_correspondences POR PERNA: membro da sub não vaza pro coalesce da pai", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: { run_widget_query: () => ({ data: [], error: null }) },
    });
    await runWidget(
      db,
      baseConfig({
        sources: ["leads"],
        dimensions: [{ field: "unified:data_venda" }],
        metrics: [
          { field: "*", agg: "count" },
          { field: "*", agg: "count", sources: ["leads_lite"] },
        ],
      }),
      AVAILABLE,
      null,
      [],
      {},
      { year: 2026, quarter: 0 },
      CATALOG,
      CORRS
    );

    expect(rpcCalls).toHaveLength(2);
    const corrs = rpcCalls.map(
      (c) => c.args.p_correspondences as Record<string, string[]>
    );
    // Perna PAI (widget só-leads): membro da pai. Perna SUB: membro da sub.
    expect(corrs).toContainEqual({ data_venda: ["custom:pai_data"] });
    expect(corrs).toContainEqual({ data_venda: ["custom:sub_data"] });
    // A perna da sub também carrega o predicado dela, scoped ao record_type.
    const legCall = rpcCalls.find(
      (c) =>
        (c.args.p_correspondences as Record<string, string[]>).data_venda[0] ===
        "custom:sub_data"
    )!;
    expect(legCall.args.p_filters).toContainEqual({
      field: "pipeline",
      op: "eq",
      value: "Lite",
      record_types: ["lead"],
    });
  });
});

describe("alinhamento por dia útil (businessDayAlign)", () => {
  it("N pernas mensais clipadas no N-ésimo dia útil + businessDayRef; comparação ignorada", async () => {
    const perMonth = [
      [{ dim_1: "2026-05-01", metric_1: 1 }],
      [{ dim_1: "2026-06-01", metric_1: 2 }],
      [{ dim_1: "2026-07-01", metric_1: 3 }],
    ];
    const { db, rpcCalls } = fakeSupabase({
      rpc: {
        run_widget_query: (_args, i) => ({
          data: perMonth[Math.min(i, 2)],
          error: null,
        }),
      },
      tables: { non_working_days: [] },
    });
    const data = await runWidget(
      db,
      baseConfig({
        sources: ["deals"],
        dimensions: [{ field: "closed_at", transform: "month" }],
        metrics: [{ field: "*", agg: "count" }],
        settings: {
          businessDayAlign: { enabled: true, reference: "period_end" },
          // Exclusão mútua: com align ativo, a comparação NÃO roda.
          comparison: { enabled: true, base: "previous_period" },
        },
      }),
      AVAILABLE,
      { field: "closed_at", from: "2026-05-01", to: "2026-07-15" }
    );

    // 15/07/2026 (quarta) é o 11º dia útil de julho → corte N=11 em cada mês.
    expect(rpcCalls).toHaveLength(3);
    const bounds = rpcCalls.map((c) => {
      const fs = c.args.p_filters as WidgetFilter[];
      return [
        fs.find((f) => f.op === "gte")?.value,
        fs.find((f) => f.op === "lte")?.value,
      ];
    });
    expect(bounds).toEqual([
      ["2026-05-01T00:00:00-03:00", "2026-05-15T23:59:59-03:00"],
      ["2026-06-01T00:00:00-03:00", "2026-06-15T23:59:59-03:00"],
      ["2026-07-01T00:00:00-03:00", "2026-07-15T23:59:59-03:00"],
    ]);
    expect(data.rows.map((r) => r.metric_1)).toEqual([1, 2, 3]);
    expect(data.businessDayRef).toEqual({
      n: 11,
      reference: "period_end",
      date: "2026-07-15",
    });
    expect(data.comparison).toBeUndefined();
  });
});

describe("comparação com período anterior", () => {
  it("segunda rodada com o range da comparação; metadados anexados", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: {
        run_widget_query: (args) => {
          const fs = args.p_filters as WidgetFilter[];
          const from = String(fs.find((f) => f.op === "gte")?.value ?? "");
          return from.startsWith("2026-07")
            ? { data: [{ dim_1: "A", metric_1: 10 }], error: null }
            : { data: [{ dim_1: "A", metric_1: 8 }], error: null };
        },
      },
    });
    const data = await runWidget(
      db,
      baseConfig({
        sources: ["deals"],
        dimensions: [{ field: "pipeline" }],
        metrics: [{ field: "*", agg: "count" }],
        settings: { comparison: { enabled: true, base: "previous_period" } },
      }),
      AVAILABLE,
      {
        field: "closed_at",
        from: "2026-07-01",
        to: "2026-07-31",
        preset: "este_mes",
      }
    );

    expect(rpcCalls).toHaveLength(2);
    const cmp = rpcCalls[1].args.p_filters as WidgetFilter[];
    // Preset "este_mes" desloca SEMANTICAMENTE: mês anterior CHEIO.
    expect(cmp.find((f) => f.op === "gte")?.value).toBe(
      "2026-06-01T00:00:00-03:00"
    );
    expect(cmp.find((f) => f.op === "lte")?.value).toBe(
      "2026-06-30T23:59:59-03:00"
    );
    // O valor comparado viaja por linha em __cmp, casado por tupla de dims.
    expect(data.rows).toEqual([
      { dim_1: "A", metric_1: 10, __cmp: { metric_1: 8 } },
    ]);
    expect(data.comparison).toBeDefined();
  });
});

describe("aggregateMoneyBreakdowns (fold por moeda + fallback @rate_date)", () => {
  it("aux com @rate_date falha (0039 ausente) → retry só por moeda", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: {
        run_widget_query: (args) => {
          const dims = args.p_dimensions as { field: string }[];
          if (dims.some((d) => d.field === "@rate_date")) {
            return { data: null, error: { message: "coluna desconhecida" } };
          }
          return {
            data: [
              { dim_1: "USD", metric_1: 100, metric_2: 2 },
              { dim_1: "BRL", metric_1: 50, metric_2: 1 },
            ],
            error: null,
          };
        },
      },
    });
    const out = await aggregateMoneyBreakdowns(
      db,
      [{ field: "value", agg: "sum" }],
      [],
      {},
      new Map(),
      { "USD:2026:0": 5 },
      { year: 2026, quarter: 0 }
    );
    expect(rpcCalls).toHaveLength(2); // 1ª com @rate_date (falha) + retry sem
    expect(out).not.toBeNull();
    const bd = out![0];
    expect(bd.perCurrency).toEqual({ USD: 100, BRL: 50 });
    expect(bd.brl).toBe(550); // 100×5 (taxa do período do dashboard) + 50
    expect(bd.count).toBe(3);
  });
});

describe("relações por nome (FK)", () => {
  it("resolveFkCondFilters troca nome→UUID; desconhecido → sentinela", async () => {
    const { db, queries } = fakeSupabase({
      tables: {
        responsibles: [
          { id: "11111111-1111-1111-1111-111111111111", display_name: " PAULO " },
        ],
      },
    });
    const out = await resolveFkCondFilters(db, [
      { field: "responsible_id", op: "eq_ci", value: "paulo" },
      { field: "responsible_id", op: "eq_ci", value: "ninguém" },
      { field: "pipeline", op: "eq_ci", value: "Vendas" },
    ]);
    expect(out[0].value).toBe("11111111-1111-1111-1111-111111111111");
    expect(out[1].value).toBe("00000000-0000-0000-0000-000000000000");
    expect(out[2].value).toBe("Vendas");
    expect(queries).toHaveLength(1); // uma consulta por tabela referenciada
  });

  it("fast path: sem literal de nome, retorna a MESMA lista sem consultar", async () => {
    const { db, queries } = fakeSupabase({});
    const filters: WidgetFilter[] = [
      {
        field: "responsible_id",
        op: "eq_ci",
        value: "11111111-1111-1111-1111-111111111111",
      },
    ];
    expect(await resolveFkCondFilters(db, filters)).toBe(filters);
    expect(queries).toHaveLength(0);
  });

  it("fetchFkLabels: ids vazios não consultam; responsável mapeia display_name", async () => {
    const { db, queries } = fakeSupabase({
      tables: { responsibles: [{ id: "r1", display_name: "Ana" }] },
    });
    expect(await fetchFkLabels(db, "responsible", [])).toEqual({});
    expect(queries).toHaveLength(0);
    expect(await fetchFkLabels(db, "responsible", ["r1"])).toEqual({
      r1: "Ana",
    });
  });
});
