// Versão: 1.0 | Data: 30/07/2026
// Testes do engine I/O da remuneração (fake-supabase fail-closed): uma
// consulta runCalculatedWidget por membro×fator com o filtro de responsável
// chegando EXPANDIDO ao RPC (canon no choke point); alvos lidos de `goals`
// em batch e dobrados apelido→canônico (canônico vence); update de entry
// existente NUNCA regrava inputs/base_amount; insert novo carimba org; falha
// de consulta de UM fator isola (errors[fid]) sem derrubar o resto.
import { describe, expect, it } from "vitest";

import type { Formula } from "@/lib/records/formulas";
import { fakeSupabase, type RecordedQuery } from "@/tests/helpers/fake-supabase";

import { memberResponsibles, recomputePlanMonth } from "./engine";
import { parseCompPlanConfig } from "./model";

const f = (...refs: string[]): Formula => ({
  tokens: refs.map((ref) => ({ kind: "field", ref })),
});

const CONFIG = {
  v: 1,
  factors: [
    {
      id: "f_v",
      label: "Vendas",
      weightPct: 60,
      metricKey: "comp_vendas",
      formula: f("agg:sum:value"),
      sources: [],
    },
    {
      id: "f_r",
      label: "Reuniões",
      weightPct: 40,
      metricKey: "comp_reunioes",
      money: false,
      formula: f("agg:count:*"),
      sources: [],
    },
  ],
};

const PLAN = {
  id: "plan-1",
  name: "Comercial",
  active: true,
  base_amount_default: 1000,
  config: CONFIG,
};

// Handler de responsibles que serve o loader do canon (select id, canonical_id)
// E a lista de membros ativos (select id, display_name).
function responsiblesHandler(q: RecordedQuery) {
  const sel = q.steps.find((s) => s.method === "select");
  if (sel && String(sel.args[0]).includes("canonical_id")) {
    return {
      data: [
        { id: "m1", canonical_id: null },
        { id: "m1a", canonical_id: "m1" },
        { id: "m2", canonical_id: null },
      ],
    };
  }
  return {
    data: [
      { id: "m1", display_name: "Um" },
      { id: "m1a", display_name: "Um (apelido)" },
      { id: "m2", display_name: "Dois" },
    ],
  };
}

const GOALS_ROWS = [
  // Apelido preenche ausência (m1 não tem linha canônica de vendas)…
  { responsible_id: "m1a", metric: "comp_vendas", target: 100 },
  // …mas a linha do CANÔNICO vence a do apelido (999 é ignorado).
  { responsible_id: "m1a", metric: "comp_reunioes", target: 999 },
  { responsible_id: "m1", metric: "comp_reunioes", target: 10 },
  { responsible_id: "m2", metric: "comp_vendas", target: 100 },
];

function respFilterOf(args: Record<string, unknown>): unknown {
  const filters = (args.p_filters ?? []) as { field: string; value?: unknown }[];
  return filters.find((x) => x.field === "responsible_id")?.value;
}

describe("memberResponsibles", () => {
  it("sem memberIds = ativos canônicos; com memberIds = interseção ordenada", () => {
    const config = parseCompPlanConfig(JSON.parse(JSON.stringify(CONFIG)))!;
    const canon = {
      canonicalById: new Map([["m1a", "m1"]]),
      groupById: new Map([["m1", ["m1", "m1a"]]]),
    };
    const all = [
      { id: "m1", display_name: "Um" },
      { id: "m1a", display_name: "Apelido" },
      { id: "m2", display_name: "Dois" },
    ];
    expect(memberResponsibles(all, canon, config).map((r) => r.id)).toEqual([
      "m1",
      "m2",
    ]);
    expect(
      memberResponsibles(all, canon, {
        ...config,
        memberIds: ["m2", "sumido"],
      }).map((r) => r.id)
    ).toEqual(["m2"]);
  });
});

describe("recomputePlanMonth", () => {
  it("config inválido falha fechado sem tocar o banco", async () => {
    const fake = fakeSupabase({});
    const out = await recomputePlanMonth(fake.db, fake.db, {
      plan: { ...PLAN, config: { v: 99 } },
      year: 2026,
      month: 7,
      orgId: "org-1",
    });
    expect(out.ok).toBe(false);
    expect(fake.queries).toHaveLength(0);
  });

  it("1 RPC por membro×fator, filtro de responsável expandido, alvos de goals dobrados, escritas corretas", async () => {
    const writes: { table: string; q: RecordedQuery }[] = [];
    const fake = fakeSupabase({
      rpc: {
        run_widget_query: (args) => {
          const metric = (args.p_metrics as { field: string }[])[0].field;
          const resp = JSON.stringify(respFilterOf(args) ?? "");
          const m1 = resp.includes("m1");
          if (metric === "value") {
            return { data: [{ metric_1: m1 ? 80 : 40 }], error: null };
          }
          return { data: [{ metric_1: m1 ? 10 : 5 }], error: null };
        },
      },
      tables: {
        responsibles: responsiblesHandler,
        field_definitions: [],
        field_correspondences: [],
        currency_rates: [],
        goals: GOALS_ROWS,
        comp_entries: (q) => {
          if (q.steps.some((s) => s.method === "update" || s.method === "insert")) {
            writes.push({ table: "comp_entries", q });
            return { data: null };
          }
          return {
            data: [
              {
                id: "e1",
                responsible_id: "m1",
                base_amount: null,
                // Override de payout de Vendas sobrevive ao recompute.
                inputs: { overrides: { factors: { f_v: { payout: 111 } } } },
                computed: null,
                total: null,
                mirror_record_id: null,
                published_at: null,
              },
            ],
          };
        },
      },
    });

    const out = await recomputePlanMonth(fake.db, fake.db, {
      plan: PLAN,
      year: 2026,
      month: 7,
      orgId: "org-1",
    });
    expect(out).toEqual({ ok: true, members: 2, factors: 2, queryErrors: 0 });

    // 2 membros × 2 fatores = 4 consultas PRINCIPAIS (o operando monetário em
    // modo fixed dispara ainda a auxiliar de moeda — dims currency/@rate_date —
    // que ignoramos aqui); as de m1 chegam com o grupo canônico EXPANDIDO
    // (apelido m1a incluso) — canon no choke point.
    const mains = fake.rpcCalls.filter(
      (c) => ((c.args.p_dimensions as unknown[]) ?? []).length === 0
    );
    expect(mains).toHaveLength(4);
    const m1Calls = mains.filter((c) =>
      JSON.stringify(respFilterOf(c.args)).includes("m1a")
    );
    expect(m1Calls.length).toBe(2);

    // Batch de goals: métricas dos fatores + responsáveis expandidos.
    const goalsQuery = fake.queries.find((q) => q.table === "goals")!;
    const inMetric = goalsQuery.steps.find(
      (s) => s.method === "in" && s.args[0] === "metric"
    )!;
    expect(inMetric.args[1]).toEqual(["comp_vendas", "comp_reunioes"]);
    const inResp = goalsQuery.steps.find(
      (s) => s.method === "in" && s.args[0] === "responsible_id"
    )!;
    expect(new Set(inResp.args[1] as string[])).toEqual(
      new Set(["m1", "m1a", "m2"])
    );

    // m1 (entry existente): UPDATE só {computed, total} — inputs/base intactos.
    const update = writes.find((w) =>
      w.q.steps.some((s) => s.method === "update")
    )!;
    const updatePayload = update.q.steps.find((s) => s.method === "update")!
      .args[0] as Record<string, unknown>;
    expect(Object.keys(updatePayload).sort()).toEqual(["computed", "total"]);
    const computed = updatePayload.computed as {
      realized: Record<string, number | null>;
    };
    expect(computed.realized).toEqual({ f_v: 80, f_r: 10 });
    // Vendas: override 111 vence (não 1000×60%×80%=480); Reuniões: alvo 10 do
    // CANÔNICO (999 do apelido ignorado) ⇒ 10/10 = 100% ⇒ 400. Total 511.
    expect(updatePayload.total).toBe(511);

    // m2 (sem entry): INSERT com carimbo de org; sem alvo de Reuniões ⇒
    // payout 0; Vendas 40% ⇒ 240.
    const insert = writes.find((w) =>
      w.q.steps.some((s) => s.method === "insert")
    )!;
    const insertPayload = insert.q.steps.find((s) => s.method === "insert")!
      .args[0] as Record<string, unknown>;
    expect(insertPayload.organization_id).toBe("org-1");
    expect(insertPayload.responsible_id).toBe("m2");
    expect(insertPayload.plan_id).toBe("plan-1");
    expect(insertPayload.period_year).toBe(2026);
    expect(insertPayload.period_month).toBe(7);
    expect(insertPayload.total).toBe(240);
  });

  it("falha de consulta de UM fator isola: realized null + errors[fid]", async () => {
    const fake = fakeSupabase({
      rpc: {
        run_widget_query: (args) => {
          const metric = (args.p_metrics as { field: string }[])[0].field;
          if (metric === "*") return { data: null, error: { message: "boom" } };
          return { data: [{ metric_1: 50 }], error: null };
        },
      },
      tables: {
        responsibles: responsiblesHandler,
        field_definitions: [],
        field_correspondences: [],
        currency_rates: [],
        goals: GOALS_ROWS,
        comp_entries: (q) => {
          if (q.steps.some((s) => s.method === "insert")) return { data: null };
          return { data: [] };
        },
      },
    });
    const out = await recomputePlanMonth(fake.db, fake.db, {
      plan: PLAN,
      year: 2026,
      month: 7,
      orgId: null,
    });
    expect(out.ok).toBe(true);
    expect(out.queryErrors).toBe(2); // Reuniões falhou p/ os 2 membros
    const insert = fake.queries.find((q) =>
      q.steps.some((s) => s.method === "insert")
    )!;
    const payload = insert.steps.find((s) => s.method === "insert")!
      .args[0] as {
      computed: { realized: Record<string, number | null>; errors?: Record<string, string> };
    };
    expect(payload.computed.realized.f_r).toBeNull();
    expect(payload.computed.realized.f_v).toBe(50);
    expect(payload.computed.errors?.f_r).toContain("boom");
  });
});
