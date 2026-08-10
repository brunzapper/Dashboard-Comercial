// Versão: 1.1 | Data: 26/07/2026
// Testes do ENGINE com cliente fake (tests/helpers/fake-supabase — mesmo shape
// do snapshotClient de produção). Travam os comportamentos que os RPCs não
// podem cobrir sozinhos: pernas por métrica (invariante 9), correspondências
// POR PERNA (membro da sub nunca vaza pro coalesce só-pai), alinhamento por
// dia útil (pernas mensais + businessDayRef), comparação (exclusão mútua com
// o align), fold monetário com fallback do @rate_date e a tradução nome→UUID
// das condições de relação.
// v1.1 (26/07/2026): agrupamento de responsáveis (0101, invariante 20) —
// fusão da dimensão apelido→principal, expansão de filtro p/ o grupo e o gate
// (widget sem referência a responsável não consulta responsibles).
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  aggregateMoneyBreakdowns,
  fetchFkLabels,
  resolveFkFilterNames,
  runWidget,
} from "@/lib/widgets/engine";
import type { WidgetConfig, WidgetFilter } from "@/lib/widgets/types";
import { tokenizeFormulaText } from "@/lib/records/formula-text";
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

  it("período personalizado FECHADO (sem preset): desloca pela duração", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: {
        run_widget_query: (args) => {
          const fs = args.p_filters as WidgetFilter[];
          const from = String(fs.find((f) => f.op === "gte")?.value ?? "");
          return from.startsWith("2026-08")
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
      { field: "closed_at", from: "2026-08-01", to: "2026-08-10" }
    );

    // 10 dias terminando na véspera do início: 22–31/07, ancorado -03:00.
    expect(rpcCalls).toHaveLength(2);
    const cmp = rpcCalls[1].args.p_filters as WidgetFilter[];
    expect(cmp.find((f) => f.op === "gte")?.value).toBe(
      "2026-07-22T00:00:00-03:00"
    );
    expect(cmp.find((f) => f.op === "lte")?.value).toBe(
      "2026-07-31T23:59:59-03:00"
    );
    expect(data.rows).toEqual([
      { dim_1: "A", metric_1: 10, __cmp: { metric_1: 8 } },
    ]);
    expect(data.comparison).toBeDefined();
  });

  describe("período personalizado ABERTO (to null — relógio fake)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("compara com to efetivo = hoje; a principal segue sem lte", async () => {
      // Meio-dia UTC: mesmo dia civil em UTC e em Brasília (padrão do
      // period.test).
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-10T12:00:00Z"));
      const { db, rpcCalls } = fakeSupabase({
        rpc: {
          run_widget_query: (args) => {
            const fs = args.p_filters as WidgetFilter[];
            const from = String(fs.find((f) => f.op === "gte")?.value ?? "");
            return from.startsWith("2026-08")
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
        { field: "closed_at", from: "2026-08-01", to: null }
      );

      expect(rpcCalls).toHaveLength(2);
      // Rodada principal: intervalo aberto de verdade (só gte).
      const main = rpcCalls[0].args.p_filters as WidgetFilter[];
      expect(main.find((f) => f.op === "gte")?.value).toBe(
        "2026-08-01T00:00:00-03:00"
      );
      expect(main.find((f) => f.op === "lte")).toBeUndefined();
      // Comparação: duração 01–10/08 (hoje) → 22–31/07.
      const cmp = rpcCalls[1].args.p_filters as WidgetFilter[];
      expect(cmp.find((f) => f.op === "gte")?.value).toBe(
        "2026-07-22T00:00:00-03:00"
      );
      expect(cmp.find((f) => f.op === "lte")?.value).toBe(
        "2026-07-31T23:59:59-03:00"
      );
      expect(data.rows).toEqual([
        { dim_1: "A", metric_1: 10, __cmp: { metric_1: 8 } },
      ]);
      expect(data.comparison).toBeDefined();
    });

    it("from no futuro: sem comparação (uma rodada só)", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-10T12:00:00Z"));
      const { db, rpcCalls } = fakeSupabase({
        rpc: {
          run_widget_query: () => ({
            data: [{ dim_1: "A", metric_1: 10 }],
            error: null,
          }),
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
        { field: "closed_at", from: "2026-09-01", to: null }
      );

      expect(rpcCalls).toHaveLength(1);
      expect(data.comparison).toBeUndefined();
    });
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
  it("resolveFkFilterNames troca nome→UUID; desconhecido → sentinela", async () => {
    const { db, queries } = fakeSupabase({
      tables: {
        responsibles: [
          { id: "11111111-1111-1111-1111-111111111111", display_name: " PAULO " },
        ],
      },
    });
    const out = await resolveFkFilterNames(db, [
      { field: "responsible_id", op: "eq_ci", value: "paulo" },
      { field: "responsible_id", op: "eq_ci", value: "ninguém" },
      { field: "pipeline", op: "eq_ci", value: "Vendas" },
    ]);
    expect(out[0].value).toBe("11111111-1111-1111-1111-111111111111");
    expect(out[1].value).toBe("00000000-0000-0000-0000-000000000000");
    expect(out[2].value).toBe("Vendas");
    expect(queries).toHaveLength(1); // uma consulta por tabela referenciada
  });

  it("lista (`in`): resolve POR ELEMENTO — nome errado não zera o resto; UUID passa", async () => {
    const { db } = fakeSupabase({
      tables: {
        responsibles: [
          { id: "11111111-1111-1111-1111-111111111111", display_name: "Paulo" },
          { id: "22222222-2222-2222-2222-222222222222", display_name: "Ana" },
        ],
      },
    });
    const out = await resolveFkFilterNames(db, [
      {
        field: "responsible_id",
        op: "in",
        value: ["Paulo", "ninguém", "33333333-3333-3333-3333-333333333333"],
      },
    ]);
    expect(out[0].value).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "00000000-0000-0000-0000-000000000000",
      "33333333-3333-3333-3333-333333333333",
    ]);
  });

  it("homônimos: linha CANÔNICA vence apelido e o id emitido é o PRINCIPAL", async () => {
    const { db } = fakeSupabase({
      tables: {
        responsibles: [
          // Apelido homônimo aparece ANTES; a canônica deve vencer.
          {
            id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
            display_name: "Paulo Vitor",
            canonical_id: "11111111-1111-1111-1111-111111111111",
          },
          {
            id: "11111111-1111-1111-1111-111111111111",
            display_name: "Paulo Vitor",
            canonical_id: null,
          },
          // Apelido com nome PRÓPRIO resolve para o principal DELE.
          {
            id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
            display_name: "PV",
            canonical_id: "11111111-1111-1111-1111-111111111111",
          },
        ],
      },
    });
    const out = await resolveFkFilterNames(db, [
      { field: "responsible_id", op: "eq", value: "Paulo Vitor" },
      { field: "responsible_id", op: "eq", value: "PV" },
    ]);
    expect(out[0].value).toBe("11111111-1111-1111-1111-111111111111");
    expect(out[1].value).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("operações homônimas: a ATIVA vence a inativa", async () => {
    const { db } = fakeSupabase({
      tables: {
        operations: [
          { id: "cccccccc-cccc-4ccc-cccc-cccccccccccc", name: "Inbound", active: false },
          { id: "dddddddd-dddd-4ddd-dddd-dddddddddddd", name: "Inbound", active: true },
        ],
      },
    });
    const out = await resolveFkFilterNames(db, [
      { field: "operation_id", op: "eq", value: "inbound" },
    ]);
    expect(out[0].value).toBe("dddddddd-dddd-4ddd-dddd-dddddddddddd");
  });

  it("fast path: sem literal de nome, retorna a MESMA lista sem consultar", async () => {
    const { db, queries } = fakeSupabase({});
    const filters: WidgetFilter[] = [
      {
        field: "responsible_id",
        op: "eq_ci",
        value: "11111111-1111-1111-1111-111111111111",
      },
      {
        field: "responsible_id",
        op: "in",
        value: ["22222222-2222-2222-2222-222222222222"],
      },
    ];
    expect(await resolveFkFilterNames(db, filters)).toBe(filters);
    expect(queries).toHaveLength(0);
  });

  it("wiring runWidget: filtro por NOME chega ao RPC como GRUPO canônico (nome→id→canon)", async () => {
    const principal = "11111111-1111-1111-1111-111111111111";
    const apelido = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const { db, rpcCalls } = fakeSupabase({
      rpc: {
        run_widget_query: () => ({ data: [{ metric_1: 1 }], error: null }),
      },
      tables: {
        responsibles: [
          { id: principal, display_name: "Paulo Vitor", canonical_id: null },
          { id: apelido, display_name: "Paulo", canonical_id: principal },
        ],
      },
    });
    await runWidget(
      db,
      baseConfig({
        metrics: [{ field: "*", agg: "count" }],
        filters: [{ field: "responsible_id", op: "eq", value: " paulo vitor " }],
      }),
      AVAILABLE
    );
    const sent = (rpcCalls[0].args.p_filters as WidgetFilter[]).find(
      (f) => f.field === "responsible_id"
    )!;
    // Nome resolveu p/ o principal e a expansão canônica virou `in` no grupo.
    expect(sent.op).toBe("in");
    expect(new Set(sent.value as string[])).toEqual(new Set([principal, apelido]));
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

describe("pernas de sub-base (2+ subs da mesma pai) × operandos escopados", () => {
  // Widget do caso real "Fonte SQL": duas subs disjuntas da mesma pai como
  // fontes de LINHA + métrica calculada somando os DOIS escopos. Sem o zeroing
  // por perna, toda perna exibiria o total global (count@a + count@b).
  const scopedSum = {
    tokens: [
      { kind: "field", ref: "agg:count:*@leads_lite" },
      { kind: "op", op: "+" },
      { kind: "field", ref: "agg:count:*@leads_sql" },
    ],
  } as NonNullable<WidgetConfig["metrics"][number]["formula"]>;
  const subsConfig = (over: Partial<WidgetConfig>): WidgetConfig =>
    baseConfig({
      sources: ["leads_lite", "leads_sql"],
      dimensions: [{ field: "pipeline" }],
      metrics: [
        {
          field: "calc:formula",
          agg: "sum",
          calc: true,
          label: "SQLs",
          formula: scopedSum,
        },
      ],
      visual_type: "barra_horizontal",
      ...over,
    });
  // Fake por PREDICADO: aux de escopo carrega os condFilters (eq_ci) e a
  // consulta principal de cada perna carrega o predicado da sub em formato de
  // fio (eq + record_types). Universos: Lite = {GA 50, Meta 10}; SQL = {GA 22,
  // NID 1}.
  const bySubPredicate = () => {
    const has = (
      args: Record<string, unknown>,
      field: string,
      op: string,
      value: unknown
    ) =>
      (args.p_filters as WidgetFilter[]).some(
        (f) => f.field === field && f.op === op && f.value === value
      );
    return fakeSupabase({
      rpc: {
        run_widget_query: (args) => {
          if (has(args, "pipeline", "eq_ci", "Lite")) {
            return {
              data: [
                { dim_1: "GA", metric_1: 50 },
                { dim_1: "Meta", metric_1: 10 },
              ],
              error: null,
            };
          }
          if (has(args, "stage", "eq_ci", "SQL")) {
            return {
              data: [
                { dim_1: "GA", metric_1: 22 },
                { dim_1: "NID", metric_1: 1 },
              ],
              error: null,
            };
          }
          if (has(args, "pipeline", "eq", "Lite")) {
            return { data: [{ dim_1: "GA" }, { dim_1: "Meta" }], error: null };
          }
          if (has(args, "stage", "eq", "SQL")) {
            return { data: [{ dim_1: "GA" }, { dim_1: "NID" }], error: null };
          }
          return { data: null, error: { message: "chamada inesperada" } };
        },
      },
    });
  };

  it("cada perna exibe a PRÓPRIA contribuição (irmã zerada, sem aux da irmã)", async () => {
    const { db, rpcCalls } = bySubPredicate();
    const data = await runWidget(
      db,
      subsConfig({}),
      AVAILABLE,
      null,
      [],
      {},
      { year: 2026, quarter: 0 },
      CATALOG,
      CORRS
    );

    // 2 pernas × (principal + aux do PRÓPRIO escopo) — o aux da irmã sumiu.
    expect(rpcCalls).toHaveLength(4);
    // Nenhuma chamada mistura os dois predicados (interseção seria vazia).
    for (const c of rpcCalls) {
      const fs = c.args.p_filters as WidgetFilter[];
      const lite = fs.some(
        (f) => f.field === "pipeline" && String(f.value) === "Lite"
      );
      const sql = fs.some(
        (f) => f.field === "stage" && String(f.value) === "SQL"
      );
      expect(lite && sql).toBe(false);
    }
    // Base como dimensão líder + valores PRÓPRIOS por perna (50/10 vs 22/1).
    expect(data.dimensions).toEqual([
      { key: "dim_1", label: "Base" },
      { key: "dim_2", label: "Pipeline" },
    ]);
    expect(data.subSeries).toEqual({ mode: "stacked" });
    expect(data.rows.map((r) => [r.dim_1, r.dim_2, r.metric_1])).toEqual([
      ["Leads / Clientes Lite", "GA", 50],
      ["Leads / Clientes Lite", "Meta", 10],
      ["Leads / SQLs", "GA", 22],
      ["Leads / SQLs", "NID", 1],
    ]);
    // Meta da métrica carrega a fórmula ORIGINAL (os dois escopos), nunca a
    // zerada de uma perna.
    const formulaTxt = JSON.stringify(data.metrics[0].calc?.formula);
    expect(formulaTxt).toContain("leads_lite");
    expect(formulaTxt).toContain("leads_sql");
    // Basis da linha: backfill 0 na chave da irmã — o re-eval client-side com
    // a fórmula original bate com o valor plotado e o Total geral soma 72.
    const ops = data.rows[0].__calcOps as Record<string, number>;
    const keys = Object.keys(ops);
    expect(keys).toHaveLength(2);
    expect(ops[keys.find((k) => k.includes("leads_lite"))!]).toBe(50);
    expect(ops[keys.find((k) => k.includes("leads_sql"))!]).toBe(0);
  });

  it('subSeriesMode "total": funde por tupla sem a dim Base; calc reavalia (50+22=72)', async () => {
    const { db } = bySubPredicate();
    const data = await runWidget(
      db,
      subsConfig({ settings: { subSeriesMode: "total" } }),
      AVAILABLE,
      null,
      [],
      {},
      { year: 2026, quarter: 0 },
      CATALOG,
      CORRS
    );

    expect(data.subSeries).toBeUndefined();
    expect(data.dimensions).toEqual([{ key: "dim_1", label: "Pipeline" }]);
    expect(data.rows.map((r) => [r.dim_1, r.metric_1])).toEqual([
      ["GA", 72],
      ["Meta", 10],
      ["NID", 1],
    ]);
  });

  it("pizza com dimensão força o total (uma fatia por categoria, não por perna)", async () => {
    const { db } = bySubPredicate();
    const data = await runWidget(
      db,
      subsConfig({ visual_type: "pizza" }),
      AVAILABLE,
      null,
      [],
      {},
      { year: 2026, quarter: 0 },
      CATALOG,
      CORRS
    );
    expect(data.dimensions).toEqual([{ key: "dim_1", label: "Pipeline" }]);
    expect(data.rows.map((r) => [r.dim_1, r.metric_1])).toEqual([
      ["GA", 72],
      ["Meta", 10],
      ["NID", 1],
    ]);
  });

  it("KPI simples com 2 subs funde numa linha só (antes: só a 1ª perna)", async () => {
    const has = (
      args: Record<string, unknown>,
      field: string,
      value: unknown
    ) =>
      (args.p_filters as WidgetFilter[]).some(
        (f) => f.field === field && f.op === "eq" && f.value === value
      );
    const { db, rpcCalls } = fakeSupabase({
      rpc: {
        run_widget_query: (args) =>
          has(args, "pipeline", "Lite")
            ? { data: [{ metric_1: 60 }], error: null }
            : { data: [{ metric_1: 23 }], error: null },
      },
    });
    const data = await runWidget(
      db,
      subsConfig({
        visual_type: "kpi",
        dimensions: [],
        metrics: [{ field: "*", agg: "count" }],
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
    expect(data.rows).toEqual([{ metric_1: 83 }]);
    expect(data.dimensions).toEqual([]);
  });
});

describe("agrupamento de responsáveis (0101 — canonical_id)", () => {
  const RESPONSIBLES = [
    { id: "11111111-1111-4111-8111-111111111111", display_name: "Ana Paula", canonical_id: null },
    { id: "22222222-2222-4222-8222-222222222222", display_name: "Ana P.", canonical_id: "11111111-1111-4111-8111-111111111111" },
  ];

  it("dimensão responsible_id: linhas do apelido fundem no principal com o nome usado", async () => {
    const { db } = fakeSupabase({
      rpc: {
        run_widget_query: () => ({
          data: [
            { dim_1: "11111111-1111-4111-8111-111111111111", metric_1: 2 },
            { dim_1: "22222222-2222-4222-8222-222222222222", metric_1: 3 },
          ],
          error: null,
        }),
      },
      tables: { responsibles: RESPONSIBLES },
    });
    const data = await runWidget(
      db,
      baseConfig({
        dimensions: [{ field: "responsible_id" }],
        metrics: [{ field: "*", agg: "count" }],
      }),
      AVAILABLE
    );
    // Uma linha só, somada, rotulada pelo display_name do PRINCIPAL.
    expect(data.rows).toEqual([{ dim_1: "Ana Paula", metric_1: 5 }]);
  });

  it("filtro eq no apelido expande para `in` no grupo antes do RPC", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: { run_widget_query: () => ({ data: [{ metric_1: 5 }], error: null }) },
      tables: { responsibles: RESPONSIBLES },
    });
    await runWidget(
      db,
      baseConfig({
        filters: [{ field: "responsible_id", op: "eq", value: "22222222-2222-4222-8222-222222222222" }],
        metrics: [{ field: "*", agg: "count" }],
        visual_type: "kpi",
      }),
      AVAILABLE
    );
    const sent = (rpcCalls[0].args.p_filters as WidgetFilter[]).find(
      (f) => f.field === "responsible_id"
    );
    expect(sent).toEqual({
      field: "responsible_id",
      op: "in",
      value: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
    });
  });

  it("gate: widget sem referência a responsável não consulta responsibles", async () => {
    // Fake SEM handler de tabela: qualquer consulta a responsibles LANÇARIA.
    const { db, queries } = fakeSupabase({
      rpc: { run_widget_query: () => ({ data: [{ metric_1: 1 }], error: null }) },
    });
    const data = await runWidget(
      db,
      baseConfig({
        metrics: [{ field: "*", agg: "count" }],
        visual_type: "kpi",
      }),
      AVAILABLE
    );
    expect(data.rows).toEqual([{ metric_1: 1 }]);
    expect(queries).toHaveLength(0);
  });
});

describe("operando de META em métrica calculada", () => {
  it("abaixa meta: para const (fórmula exportada) e avalia por linha", async () => {
    const { db, rpcCalls, queries } = fakeSupabase({
      rpc: {
        run_widget_query: () => ({
          data: [
            { dim_1: "A", metric_1: 40000 },
            { dim_1: "B", metric_1: 10000 },
          ],
          error: null,
        }),
      },
      tables: {
        goals: (q) => {
          const single = q.steps.some((s) => s.method === "maybeSingle");
          const eqs = Object.fromEntries(
            q.steps
              .filter((s) => s.method === "eq")
              .map((s) => [s.args[0], s.args[1]])
          );
          if (single && eqs.scope === "global" && eqs.metric === "mrr")
            return { data: { target: "50000" }, error: null };
          return { data: single ? null : [], error: null };
        },
      },
    });
    const data = await runWidget(
      db,
      baseConfig({
        sources: ["deals"],
        dimensions: [{ field: "pipeline" }],
        metrics: [
          {
            field: "calc:formula",
            agg: "sum",
            calc: true,
            formula: {
              tokens: [
                { kind: "field", ref: "agg:sum:value" },
                { kind: "op", op: "/" },
                { kind: "field", ref: "meta:mrr" },
              ],
            },
          },
        ],
      }),
      AVAILABLE,
      { field: "closed_at", from: "2026-03-01", to: "2026-03-31" }
    );
    expect(queries.some((q) => q.table === "goals")).toBe(true);
    expect(rpcCalls.length).toBeGreaterThan(0);
    // Cada linha divide pela MESMA meta (constante por rodada — nunca somada).
    expect(data.rows.map((r) => r.metric_1)).toEqual([0.8, 0.2]);
    // A fórmula RESOLVIDA exportada ao cliente carrega o const embutido — o
    // re-eval de subtotais usa a mesma meta, sem fold aditivo.
    const calcFormula = data.metrics[0]?.calc?.formula;
    expect(calcFormula?.tokens).toContainEqual({ kind: "const", value: 50000 });
  });
});

describe("Semana Fechada (Dimension.closedWeek)", () => {
  it("seg_dom: período snapado p/ semanas completas + weekMode 'full' no payload", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: { run_widget_query: () => ({ data: [], error: null }) },
    });
    await runWidget(
      db,
      baseConfig({
        sources: ["deals"],
        dimensions: [
          { field: "closed_at", transform: "week_month", closedWeek: "seg_dom" },
        ],
        metrics: [{ field: "*", agg: "count" }],
      }),
      AVAILABLE,
      { field: "closed_at", from: "2026-07-01", to: "2026-07-31", preset: "este_mes" }
    );
    expect(rpcCalls).toHaveLength(1);
    const args = rpcCalls[0].args;
    // Julho/26 seg–dom: 29/06–02/08 (bounds core ancorados em -03:00).
    expect(args.p_filters).toContainEqual({
      field: "closed_at",
      op: "gte",
      value: "2026-06-29T00:00:00-03:00",
    });
    expect(args.p_filters).toContainEqual({
      field: "closed_at",
      op: "lte",
      value: "2026-08-02T23:59:59-03:00",
    });
    // Payload da dim desce weekMode "full" (mata o recorte na virada do mês).
    const dim = (args.p_dimensions as Record<string, unknown>[])[0];
    expect(dim.weekMode).toBe("full");
    expect(dim.transform).toBe("week_month");
  });

  it("sab_sex: dim desce como 'day' e as linhas fundem em semanas de sábado rotuladas", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: {
        run_widget_query: () => ({
          // Buckets 'day' (timestamp) de duas semanas sáb–sex de julho/26:
          // 04/07–10/07 e 11/07–17/07.
          data: [
            { dim_1: "2026-07-04T00:00:00", metric_1: 1 },
            { dim_1: "2026-07-06T00:00:00", metric_1: 2 },
            { dim_1: "2026-07-10T00:00:00", metric_1: 4 },
            { dim_1: "2026-07-15T00:00:00", metric_1: 8 },
          ],
          error: null,
        }),
      },
    });
    const data = await runWidget(
      db,
      baseConfig({
        sources: ["deals"],
        dimensions: [
          { field: "closed_at", transform: "week_month", closedWeek: "sab_sex" },
        ],
        metrics: [{ field: "*", agg: "count" }],
      }),
      AVAILABLE,
      { field: "closed_at", from: "2026-07-01", to: "2026-07-31", preset: "este_mes" }
    );
    const args = rpcCalls[0].args;
    // O RPC não produz semana de sábado: a dim desce como 'day'…
    expect((args.p_dimensions as Record<string, unknown>[])[0].transform).toBe(
      "day"
    );
    // …e o período snapa p/ 04/07–31/07 (a semana 27/06–03/07 tem só 3 dias
    // em julho — fica com junho).
    expect(args.p_filters).toContainEqual({
      field: "closed_at",
      op: "gte",
      value: "2026-07-04T00:00:00-03:00",
    });
    expect(args.p_filters).toContainEqual({
      field: "closed_at",
      op: "lte",
      value: "2026-07-31T23:59:59-03:00",
    });
    // Fusão client-side + rótulo pela âncora de sábado (mês da terça).
    expect(data.rows).toHaveLength(2);
    expect(data.rows[0].dim_1).toBe("1ª semana de Julho");
    expect(data.rows[0].metric_1).toBe(7);
    expect(data.rows[1].dim_1).toBe("2ª semana de Julho");
    expect(data.rows[1].metric_1).toBe(8);
  });

  it("comparação previous_period também compara semanas fechadas", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: { run_widget_query: () => ({ data: [], error: null }) },
    });
    const data = await runWidget(
      db,
      baseConfig({
        sources: ["deals"],
        dimensions: [
          { field: "closed_at", transform: "week_month", closedWeek: "seg_dom" },
        ],
        metrics: [{ field: "*", agg: "count" }],
        settings: { comparison: { enabled: true, base: "previous_period" } },
      }),
      AVAILABLE,
      { field: "closed_at", from: "2026-07-01", to: "2026-07-31", preset: "este_mes" }
    );
    // Junho/26 em semanas fechadas seg–dom: 01/06–28/06 (a semana 29/06–05/07
    // é de julho).
    const cmpCall = rpcCalls.find((c) =>
      (c.args.p_filters as WidgetFilter[]).some(
        (f) => f.op === "gte" && String(f.value).startsWith("2026-06-01")
      )
    );
    expect(cmpCall).toBeDefined();
    expect(cmpCall!.args.p_filters).toContainEqual({
      field: "closed_at",
      op: "lte",
      value: "2026-06-28T23:59:59-03:00",
    });
    expect(data.comparison?.from).toBe("2026-06-01");
    expect(data.comparison?.to).toBe("2026-06-28");
  });
});

describe("sub-base que ignora o período (ignore_period, 0116)", () => {
  const ATIVOS = {
    key: "leads_ativos",
    recordType: "lead",
    label: "Leads / Ativos",
    shortLabel: "Ativos",
    defaultPeriodField: "source_created_at",
    builtin: false,
    manualEntry: false,
    parentKey: "leads",
    filter: [{ field: "stage", op: "eq" as const, value: "Ativo" }],
    ignorePeriod: true,
  };
  const CAT = [...CATALOG, ATIVOS];
  const period = {
    field: "closed_at",
    from: "2026-07-01",
    to: "2026-07-31",
    fieldBySource: {
      deals: "closed_at",
      leads: "source_created_at",
      leads_ativos: "source_created_at",
    },
  };

  it("misto: @period sai com record_types SÓ de quem respeita (pass-through)", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: { run_widget_query: () => ({ data: [], error: null }) },
    });
    await runWidget(
      db,
      baseConfig({
        sources: ["deals", "leads_ativos"],
        metrics: [{ field: "*", agg: "count" }],
      }),
      AVAILABLE,
      period,
      [],
      {},
      { year: 2026, quarter: 0 },
      CAT
    );
    expect(rpcCalls).toHaveLength(1);
    const filters = rpcCalls[0].args.p_filters as WidgetFilter[];
    const synth = filters.find((f) => f.field === "@period")!;
    expect(synth).toBeDefined();
    expect(
      (synth.value as { byType: Record<string, string> }).byType
    ).toEqual({ negocio: "closed_at" });
    expect(synth.record_types).toEqual(["negocio"]);
    // O universo segue restrito às fontes (a isenção é SÓ de data).
    expect(recordTypesOf(rpcCalls[0].args)).toEqual(["negocio", "lead"]);
  });

  it("só a sub isenta: nenhum filtro de período desce ao RPC", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: { run_widget_query: () => ({ data: [], error: null }) },
    });
    await runWidget(
      db,
      baseConfig({
        sources: ["leads_ativos"],
        metrics: [{ field: "*", agg: "count" }],
      }),
      AVAILABLE,
      period,
      [],
      {},
      { year: 2026, quarter: 0 },
      CAT
    );
    const filters = rpcCalls[0].args.p_filters as WidgetFilter[];
    expect(filters.some((f) => f.field === "@period")).toBe(false);
    expect(filters.some((f) => f.op === "gte" || f.op === "lte")).toBe(false);
    // O predicado da sub segue aplicado (a isenção não derruba o recorte).
    expect(filters).toContainEqual({
      field: "stage",
      op: "eq",
      value: "Ativo",
      record_types: ["lead"],
    });
  });

  it("pai + sub-ignorante: perna extra com o MESMO período — mas sem recorte na sub", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: { run_widget_query: () => ({ data: [], error: null }) },
    });
    await runWidget(
      db,
      baseConfig({
        sources: ["leads", "leads_ativos"],
        dimensions: [{ field: "pipeline" }],
        metrics: [{ field: "*", agg: "count" }],
        visual_type: "barra_horizontal",
      }),
      AVAILABLE,
      period,
      [],
      {},
      { year: 2026, quarter: 0 },
      CAT
    );
    // Principal (pai) + perna extra (sub) = 2 RPCs.
    expect(rpcCalls).toHaveLength(2);
    const main = rpcCalls.find((c) =>
      (c.args.p_filters as WidgetFilter[]).every((f) => f.field !== "stage")
    )!;
    const leg = rpcCalls.find((c) =>
      (c.args.p_filters as WidgetFilter[]).some((f) => f.field === "stage")
    )!;
    // Pai: período normal (campo único → uniforme com bounds ancorados).
    expect(main.args.p_filters).toContainEqual({
      field: "source_created_at",
      op: "gte",
      value: "2026-07-01T00:00:00-03:00",
    });
    // Sub: nenhum recorte de data.
    expect(
      (leg.args.p_filters as WidgetFilter[]).some(
        (f) => f.field === "@period" || f.op === "gte" || f.op === "lte"
      )
    ).toBe(false);
  });
});

describe("dimensão condicional (Dimension.caseFormula)", () => {
  const caseCatalog = [
    { ref: "pipeline", label: "Pipeline" },
    { ref: "stage", label: "Etapa" },
  ];
  const tokens = (src: string) => {
    const res = tokenizeFormulaText(src, caseCatalog);
    if (!res.ok) throw new Error(res.error);
    return res.formula;
  };

  it("campo único: RPC agrupa pelo cru e o engine funde valor→rótulo", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: {
        run_widget_query: () => ({
          data: [
            { dim_1: "Inbound", metric_1: 4 },
            { dim_1: "Outbound", metric_1: 3 },
            { dim_1: "Parceria", metric_1: 2 },
          ],
          error: null,
        }),
      },
    });
    const data = await runWidget(
      db,
      baseConfig({
        dimensions: [
          {
            field: "pipeline",
            caseFormula: tokens(
              'SE(OU([Pipeline] = "Inbound"; [Pipeline] = "Outbound"); "Vendas"; "Canais")'
            ),
          },
        ],
        metrics: [{ field: "*", agg: "count" }],
      }),
      AVAILABLE
    );
    // Payload segue com UMA dim (a expressão viaja inerte no jsonb).
    expect(rpcCalls).toHaveLength(1);
    expect(
      (rpcCalls[0].args.p_dimensions as { field: string }[]).map((d) => d.field)
    ).toEqual(["pipeline"]);
    expect(data.rows).toEqual([
      { dim_1: "Vendas", metric_1: 7 },
      { dim_1: "Canais", metric_1: 2 },
    ]);
  });

  it("multi-campo: refs viram dims extras no RPC e o engine contrai/funde", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: {
        run_widget_query: () => ({
          data: [
            { dim_1: "Inbound", dim_2: "Ganho", metric_1: 4 },
            { dim_1: "Inbound", dim_2: "Perdido", metric_1: 3 },
            { dim_1: "Outbound", dim_2: "Ganho", metric_1: 5 },
          ],
          error: null,
        }),
      },
    });
    const data = await runWidget(
      db,
      baseConfig({
        dimensions: [
          {
            field: "pipeline",
            caseFormula: tokens(
              'SE(E([Pipeline] = "Inbound"; [Etapa] = "Ganho"); "Inbound ganho"; "Resto")'
            ),
          },
        ],
        metrics: [{ field: "*", agg: "count" }],
      }),
      AVAILABLE
    );
    // Payload EXPANDIDO: o campo da dim + a ref extra, como dims cruas.
    expect(
      (rpcCalls[0].args.p_dimensions as { field: string }[]).map((d) => d.field)
    ).toEqual(["pipeline", "stage"]);
    // Contração de volta a UMA dim, com fold dos grupos no mesmo rótulo.
    expect(data.rows).toEqual([
      { dim_1: "Inbound ganho", metric_1: 4 },
      { dim_1: "Resto", metric_1: 8 },
    ]);
    expect(data.dimensions).toHaveLength(1);
  });
});
