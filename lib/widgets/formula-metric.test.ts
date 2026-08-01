// Versão: 1.1 | Data: 01/08/2026 (v1.1: perna escopada VAZIA no modo moeda
// soma como 0 — a aux monetária sem linhas não pode derrubar a fórmula)
// Versão: 1.0 | Data: 24/07/2026
// Testes de runCalculatedWidget com fake só-rpc — o choke point das métricas
// calculadas de dashboard. O caso duro é o operando com ESCOPO de fonte
// (`agg:…@<fonte>`): a consulta auxiliar roda como perna SÓ da fonte do
// escopo — @period pré-sintetizado re-apontado para a coluna de data DELA
// (patchAuxPeriodByType) e p_correspondences com o membro DELA (nunca o da
// pai — um unified: bucketizaria pela data errada).
import { describe, expect, it } from "vitest";

import type { Formula } from "@/lib/records/formulas";
import { PERIOD_FIELD_SENTINEL, type PeriodBetweenValue } from "@/lib/widgets/period";
import { runCalculatedWidget } from "@/lib/widgets/formula-metric";
import type { WidgetFilter } from "@/lib/widgets/types";
import { fakeSupabase } from "@/tests/helpers/fake-supabase";
import { CATALOG, CORRS } from "@/tests/helpers/engine-fixtures";

const f = (...refs: string[]): Formula => ({
  tokens: refs.map((ref) => ({ kind: "field", ref })),
});

describe("runCalculatedWidget", () => {
  it("fórmula vazia → null sem consultar", async () => {
    const { db, rpcCalls } = fakeSupabase({});
    expect(await runCalculatedWidget(db, { formula: { tokens: [] } })).toEqual({
      value: null,
      currency: null,
    });
    expect(rpcCalls).toHaveLength(0);
  });

  it("operando simples: 1 RPC com o record_type do widget", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: { run_widget_query: () => ({ data: [{ metric_1: 7 }], error: null }) },
    });
    const out = await runCalculatedWidget(db, {
      formula: f("agg:count:*"),
      sources: ["deals"],
    });
    expect(out).toEqual({ value: 7, currency: null });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args.p_metrics).toEqual([{ field: "*", agg: "count" }]);
    expect(rpcCalls[0].args.p_filters).toContainEqual({
      field: "record_type",
      op: "in",
      value: ["negocio"],
    });
  });

  it("operando @sub: aux com período da FONTE do escopo e membro DELA", async () => {
    const { db, rpcCalls } = fakeSupabase({
      rpc: {
        run_widget_query: () => ({ data: [{ metric_1: 42 }], error: null }),
      },
    });
    // @period PRÉ-sintetizado (filtros rápidos): byType aponta a coluna da PAI
    // — a aux do escopo deve re-apontar o record_type "lead" para a coluna da
    // SUB (defaultPeriodField custom:data_lite).
    const presynth = {
      field: PERIOD_FIELD_SENTINEL,
      op: "between",
      value: {
        from: "2026-07-01",
        to: "2026-07-31T23:59:59",
        byType: { lead: "source_created_at", negocio: "closed_at" },
      },
    } as unknown as WidgetFilter;

    const out = await runCalculatedWidget(db, {
      formula: f("agg:sum:value@leads_lite"),
      sources: ["deals"],
      sourceDefs: CATALOG,
      correspondences: CORRS,
      filters: [presynth],
    });
    expect(out.value).toBe(42);
    expect(rpcCalls).toHaveLength(1);
    const args = rpcCalls[0].args;
    expect(args.p_metrics).toEqual([{ field: "value", agg: "sum" }]);

    const filters = args.p_filters as WidgetFilter[];
    // Perna SÓ da fonte do escopo (record_type da pai + predicado da sub).
    expect(filters).toContainEqual({
      field: "record_type",
      op: "in",
      value: ["lead"],
    });
    // Predicado da sub vem também nos condFilters da chave aggif: (eq_ci).
    expect(filters).toContainEqual({
      field: "pipeline",
      op: "eq_ci",
      value: "Lite",
    });
    // @period patched: o record_type do escopo passa a filtrar pela coluna da SUB.
    const period = filters.find((x) => x.field === PERIOD_FIELD_SENTINEL);
    expect((period?.value as PeriodBetweenValue).byType).toEqual({
      lead: "custom:data_lite",
      negocio: "closed_at",
    });
    // Correspondências da aux: o membro da SUB, nunca o da pai.
    expect(args.p_correspondences).toEqual({
      data_venda: ["custom:sub_data"],
    });
  });

  it("perna escopada VAZIA soma como 0 no modo moeda (nunca derruba a fórmula)", async () => {
    // Regressão (01/08/2026): com currencyMode ciente de moeda, a aux
    // monetária substitui o número cru pelo MoneyBreakdown — e a perna sem
    // registros virava breakdown VAZIO ⇒ operando null ⇒ fórmula inteira null
    // (zerava o realizado da Remuneração e os cards fórmula por pessoa).
    const { db } = fakeSupabase({
      rpc: {
        run_widget_query: (args) => {
          const dims = (args.p_dimensions ?? []) as unknown[];
          const sql = JSON.stringify(args.p_filters ?? []).includes("SQL");
          if (dims.length === 0) {
            // Consulta principal: leads_sql sem linhas (sum SQL de 0 linhas).
            return { data: [{ metric_1: sql ? null : 70 }], error: null };
          }
          // Aux monetária: leads_lite tudo em BRL; leads_sql SEM linhas.
          if (sql) return { data: [], error: null };
          return {
            data: [{ dim_1: "BRL", metric_1: 70, metric_2: 2 }],
            error: null,
          };
        },
      },
    });
    const out = await runCalculatedWidget(db, {
      formula: {
        tokens: [
          { kind: "field", ref: "agg:sum:value@leads_lite" },
          { kind: "op", op: "+" },
          { kind: "field", ref: "agg:sum:value@leads_sql" },
        ],
      },
      sourceDefs: CATALOG,
      currencyMode: "fixed",
      currencyCode: "BRL",
    });
    expect(out).toEqual({ value: 70, currency: "BRL" });
  });

  it("falha da aux condicional degrada para null (nunca derruba)", async () => {
    const { db } = fakeSupabase({
      rpc: {
        run_widget_query: () => ({
          data: null,
          error: { message: "operador desconhecido" },
        }),
      },
    });
    const out = await runCalculatedWidget(db, {
      formula: f("agg:sum:value@leads_lite"),
      sourceDefs: CATALOG,
    });
    expect(out).toEqual({ value: null, currency: null });
  });
});

describe("operando de META (meta:<chave>)", () => {
  const op = (o: "/"): { kind: "op"; op: "/" } => ({ kind: "op", op: o });

  it("resolve a meta do período (year/month da regra do card) e divide", async () => {
    const { db, rpcCalls, queries } = fakeSupabase({
      rpc: {
        run_widget_query: () => ({ data: [{ metric_1: 40000 }], error: null }),
      },
      tables: {
        goals: (q) => {
          // Escopo GLOBAL mensal: period_year 2026 / period_month 3 (o período
          // 01–31/03 cabe num mês — regra extraída do card).
          const eqs = Object.fromEntries(
            q.steps
              .filter((s) => s.method === "eq")
              .map((s) => [s.args[0], s.args[1]])
          );
          const single = q.steps.some((s) => s.method === "maybeSingle");
          if (
            single &&
            eqs.period_year === 2026 &&
            eqs.period_month === 3 &&
            eqs.scope === "global" &&
            eqs.metric === "mrr"
          ) {
            return { data: { target: "50000" }, error: null };
          }
          return { data: single ? null : [], error: null };
        },
      },
    });
    const out = await runCalculatedWidget(db, {
      formula: {
        tokens: [
          { kind: "field", ref: "agg:sum:value" },
          op("/"),
          { kind: "field", ref: "meta:mrr" },
        ],
      },
      sources: ["deals"],
      period: { field: "closed_at", from: "2026-03-01", to: "2026-03-31" },
    });
    expect(out.value).toBeCloseTo(0.8);
    expect(rpcCalls).toHaveLength(1);
    expect(queries.some((q) => q.table === "goals")).toBe(true);
  });

  it("meta ausente ⇒ valor null (nunca 0); falha da tabela idem", async () => {
    const semMeta = fakeSupabase({
      rpc: {
        run_widget_query: () => ({ data: [{ metric_1: 40000 }], error: null }),
      },
      tables: {
        goals: (q) => ({
          data: q.steps.some((s) => s.method === "maybeSingle") ? null : [],
          error: null,
        }),
      },
    });
    const out = await runCalculatedWidget(semMeta.db, {
      formula: {
        tokens: [
          { kind: "field", ref: "agg:sum:value" },
          op("/"),
          { kind: "field", ref: "meta:mrr" },
        ],
      },
      sources: ["deals"],
      period: { field: "closed_at", from: "2026-03-01", to: "2026-03-31" },
    });
    expect(out.value).toBeNull();
    // Handler de goals que LANÇA: degrade por chave, widget não derruba.
    const quebrado = fakeSupabase({
      rpc: {
        run_widget_query: () => ({ data: [{ metric_1: 1 }], error: null }),
      },
      tables: {
        goals: () => {
          throw new Error("boom");
        },
      },
    });
    const out2 = await runCalculatedWidget(quebrado.db, {
      formula: { tokens: [{ kind: "field", ref: "meta:mrr" }] },
      sources: ["deals"],
      period: null,
    });
    expect(out2.value).toBeNull();
  });

  it("fórmula SÓ de meta vira const puro — zero RPCs de widget", async () => {
    const { db, rpcCalls } = fakeSupabase({
      tables: {
        goals: (q) => {
          const single = q.steps.some((s) => s.method === "maybeSingle");
          return { data: single ? { target: "1234" } : [], error: null };
        },
      },
    });
    const out = await runCalculatedWidget(db, {
      formula: { tokens: [{ kind: "field", ref: "meta:mrr" }] },
      sources: ["deals"],
      period: { field: "closed_at", from: "2026-03-01", to: "2026-03-31" },
    });
    expect(out.value).toBe(1234);
    expect(rpcCalls).toHaveLength(0);
  });
});
