// Versão: 1.5 | Data: 01/08/2026 (v1.5: regressão do realizado zerado — fator
// money com perna escopada VAZIA soma as pernas preenchidas; a aux monetária
// sem linhas não pode virar operando null)
// Versão: 1.4 | Data: 31/07/2026 (v1.4: apuração sobre o mês anterior —
// @period/goals deslocam p/ M-1 com rollover de janeiro, entry segue no mês
// de pagamento e computed.ref carimba a janela apurada)
// Versão: 1.3 | Data: 31/07/2026 (v1.3: memberField — filtro `in` com o
// CONJUNTO DE NOMES do grupo canônico no lugar do responsible_id, membro sem
// nome isola como erro de célula; targetCurrency — alvo convertido pela taxa
// do trimestre chega ao total gravado; config LEGADO com `commission` objeto
// segue recomputando idêntico via normalização do parse)
// v1.2: membros por operação — 4º arg de memberResponsibles,
// operationMembersFromScopes canonicaliza e o recompute resolve a subárvore
// viva; asserções de QUERY porque loadOperationScopes degrada p/ vazio em erro.
// Testes do engine I/O da remuneração (fake-supabase fail-closed): uma
// consulta runCalculatedWidget por membro×fator com o filtro de responsável
// chegando EXPANDIDO ao RPC (canon no choke point); alvos lidos de `goals`
// em batch e dobrados apelido→canônico (canônico vence); update de entry
// existente NUNCA regrava inputs/base_amount; insert novo carimba org; falha
// de consulta de UM fator isola (errors[fid]) sem derrubar o resto.
import { describe, expect, it } from "vitest";

import type { Formula } from "@/lib/records/formulas";
import { fakeSupabase, type RecordedQuery } from "@/tests/helpers/fake-supabase";

import {
  memberResponsibles,
  operationMembersFromScopes,
  recomputePlanMonth,
} from "./engine";
import { parseCompPlanConfig } from "./model";

const f = (...refs: string[]): Formula => ({
  tokens: refs.map((ref) => ({ kind: "field", ref })),
});

// Ids UUID-shaped (31/07/2026): o filtro `responsible_id` injetado pelo engine
// passa por resolveFkFilterNames no runCalculatedWidget — valor não-UUID agora
// é NOME. Em produção os ids são sempre UUID; "m1"/"m1a"/"m2" dos comentários
// referem-se a estas constantes.
const M1 = "11111111-1111-4111-8111-111111111111"; // m1 (canônico)
const M1A = "1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a"; // m1a (apelido de m1)
const M2 = "22222222-2222-4222-8222-222222222222"; // m2

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
// E a lista completa (select id, display_name, active — o engine filtra os
// ativos p/ membros e usa TODOS os nomes no nameById do memberField).
function responsiblesHandler(q: RecordedQuery) {
  const sel = q.steps.find((s) => s.method === "select");
  if (sel && String(sel.args[0]).includes("canonical_id")) {
    return {
      data: [
        { id: M1, canonical_id: null },
        { id: M1A, canonical_id: M1 },
        { id: M2, canonical_id: null },
      ],
    };
  }
  return {
    data: [
      { id: M1, display_name: "Um", active: true },
      // Apelido INATIVO de propósito: o nome dele ainda entra no conjunto do
      // memberField (nameById cobre o grupo canônico inteiro).
      { id: M1A, display_name: "Um (apelido)", active: false },
      { id: M2, display_name: "Dois", active: true },
    ],
  };
}

const GOALS_ROWS = [
  // Apelido preenche ausência (m1 não tem linha canônica de vendas)…
  { responsible_id: M1A, metric: "comp_vendas", target: 100 },
  // …mas a linha do CANÔNICO vence a do apelido (999 é ignorado).
  { responsible_id: M1A, metric: "comp_reunioes", target: 999 },
  { responsible_id: M1, metric: "comp_reunioes", target: 10 },
  { responsible_id: M2, metric: "comp_vendas", target: 100 },
];

function respFilterOf(args: Record<string, unknown>): unknown {
  const filters = (args.p_filters ?? []) as { field: string; value?: unknown }[];
  return filters.find((x) => x.field === "responsible_id")?.value;
}

describe("memberResponsibles", () => {
  it("sem memberIds = ativos canônicos; com memberIds = interseção ordenada", () => {
    const config = parseCompPlanConfig(JSON.parse(JSON.stringify(CONFIG)))!;
    const canon = {
      canonicalById: new Map([[M1A, M1]]),
      groupById: new Map([[M1, [M1, M1A]]]),
    };
    const all = [
      { id: M1, display_name: "Um" },
      { id: M1A, display_name: "Apelido" },
      { id: M2, display_name: "Dois" },
    ];
    expect(memberResponsibles(all, canon, config).map((r) => r.id)).toEqual([
      M1,
      M2,
    ]);
    expect(
      memberResponsibles(all, canon, {
        ...config,
        memberIds: [M2, "sumido"],
      }).map((r) => r.id)
    ).toEqual([M2]);
  });

  it("4º arg soma membros de operação (dedup, manual primeiro); op-only vazio ⇒ []", () => {
    const config = parseCompPlanConfig(JSON.parse(JSON.stringify(CONFIG)))!;
    const canon = {
      canonicalById: new Map([[M1A, M1]]),
      groupById: new Map([[M1, [M1, M1A]]]),
    };
    const all = [
      { id: M1, display_name: "Um" },
      { id: M1A, display_name: "Apelido" },
      { id: M2, display_name: "Dois" },
    ];
    // Operação traz m1 além do manual m2 — manual primeiro, dedup.
    expect(
      memberResponsibles(
        all,
        canon,
        { ...config, memberIds: [M2], memberOperationIds: ["opA"] },
        [M1, M2]
      ).map((r) => r.id)
    ).toEqual([M2, M1]);
    // Só operações com resolução vazia ⇒ NENHUM membro (nunca "todos").
    expect(
      memberResponsibles(
        all,
        canon,
        { ...config, memberOperationIds: ["opA"] },
        []
      )
    ).toEqual([]);
    // Apelido que escapasse da canonicalização nunca vira linha.
    expect(
      memberResponsibles(
        all,
        canon,
        { ...config, memberOperationIds: ["opA"] },
        [M1A, M2]
      ).map((r) => r.id)
    ).toEqual([M2]);
  });
});

describe("operationMembersFromScopes", () => {
  it("canonicaliza apelidos e deduplica por operação", () => {
    const canon = {
      canonicalById: new Map([[M1A, M1]]),
      groupById: new Map([[M1, [M1, M1A]]]),
    };
    const scopes = new Map([
      [
        "opA",
        { responsibleIds: [M1A, M1, M2], profile: [], subtreeProfiles: [] },
      ],
      ["opB", { responsibleIds: [], profile: [], subtreeProfiles: [] }],
    ]);
    expect(operationMembersFromScopes(scopes, canon)).toEqual({
      opA: [M1, M2],
      opB: [],
    });
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
          const m1 = resp.includes(M1);
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
                responsible_id: M1,
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
      JSON.stringify(respFilterOf(c.args)).includes(M1A)
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
      new Set([M1, M1A, M2])
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
    expect(insertPayload.responsible_id).toBe(M2);
    expect(insertPayload.plan_id).toBe("plan-1");
    expect(insertPayload.period_year).toBe(2026);
    expect(insertPayload.period_month).toBe(7);
    expect(insertPayload.total).toBe(240);
  });

  it("memberOperationIds: subárvore viva resolve membros (apelido → canônico) e o recompute os processa", async () => {
    const writes: Record<string, unknown>[] = [];
    const fake = fakeSupabase({
      rpc: {
        run_widget_query: (args) => {
          const metric = (args.p_metrics as { field: string }[])[0].field;
          const m1 = JSON.stringify(respFilterOf(args) ?? "").includes(M1);
          if (metric === "value")
            return { data: [{ metric_1: m1 ? 80 : 40 }], error: null };
          return { data: [{ metric_1: m1 ? 10 : 5 }], error: null };
        },
      },
      tables: {
        responsibles: responsiblesHandler,
        field_definitions: [],
        field_correspondences: [],
        currency_rates: [],
        goals: GOALS_ROWS,
        // Catálogo de operações: opA raiz com filha opB (subárvore conta).
        operations: [
          { id: "opA", parent_operation_id: null, filter: [], active: true },
          { id: "opB", parent_operation_id: "opA", filter: [], active: true },
        ],
        // Vínculos: apelido m1a na raiz; m2 na FILHA (entra pela subárvore).
        responsible_operations: [
          { responsible_id: M1A, operation_id: "opA" },
          { responsible_id: M2, operation_id: "opB" },
        ],
        comp_entries: (q) => {
          const ins = q.steps.find((s) => s.method === "insert");
          if (ins) {
            writes.push(ins.args[0] as Record<string, unknown>);
            return { data: null };
          }
          return { data: [] };
        },
      },
    });
    const out = await recomputePlanMonth(fake.db, fake.db, {
      plan: { ...PLAN, config: { ...CONFIG, memberOperationIds: ["opA"] } },
      year: 2026,
      month: 7,
      orgId: "org-1",
    });
    expect(out).toEqual({ ok: true, members: 2, factors: 2, queryErrors: 0 });
    // Guarda contra o degrade silencioso do loadOperationScopes (catch ⇒
    // vazio): as DUAS queries do resolver precisam ter acontecido.
    expect(fake.queries.some((q) => q.table === "operations")).toBe(true);
    expect(fake.queries.some((q) => q.table === "responsible_operations")).toBe(true);
    // Apelido m1a canonicalizado ⇒ entry no m1; m2 veio da sub-operação.
    expect(writes.map((w) => w.responsible_id).sort()).toEqual([M1, M2]);
  });

  it("memberField: filtro `in` com os NOMES do grupo canônico; sem responsible_id; membro sem nome isola", async () => {
    const writes: Record<string, unknown>[] = [];
    const seen: { metric: string; filters: { field: string; op: string; value?: unknown }[] }[] = [];
    const fake = fakeSupabase({
      rpc: {
        run_widget_query: (args) => {
          seen.push({
            metric: (args.p_metrics as { field: string }[])[0].field,
            filters: (args.p_filters ?? []) as {
              field: string;
              op: string;
              value?: unknown;
            }[],
          });
          return { data: [{ metric_1: 7 }], error: null };
        },
      },
      tables: {
        responsibles: (q: RecordedQuery) => {
          const sel = q.steps.find((s) => s.method === "select");
          if (sel && String(sel.args[0]).includes("canonical_id")) {
            return {
              data: [
                { id: M1, canonical_id: null },
                { id: M1A, canonical_id: M1 },
                { id: "m3", canonical_id: null },
              ],
            };
          }
          return {
            data: [
              { id: M1, display_name: "Um", active: true },
              { id: M1A, display_name: "Um (apelido)", active: false },
              // m3 SEM nome: fator com memberField vira erro de célula.
              { id: "m3", display_name: "  ", active: true },
            ],
          };
        },
        field_definitions: [],
        field_correspondences: [],
        currency_rates: [],
        goals: [],
        comp_entries: (q) => {
          const ins = q.steps.find((s) => s.method === "insert");
          if (ins) {
            writes.push(ins.args[0] as Record<string, unknown>);
            return { data: null };
          }
          return { data: [] };
        },
      },
    });
    const config = {
      ...CONFIG,
      factors: [
        CONFIG.factors[0], // f_v sem memberField (clássico responsible_id eq)
        { ...CONFIG.factors[1], memberField: "custom:sdr_reuniao" },
      ],
    };
    const out = await recomputePlanMonth(fake.db, fake.db, {
      plan: { ...PLAN, config },
      year: 2026,
      month: 7,
      orgId: "org-1",
    });
    // m3 sem nome: SÓ o fator com memberField falha (1 erro por membro sem nome).
    expect(out.ok).toBe(true);
    expect(out.queryErrors).toBe(1);
    // f_r de m1: filtro no CAMPO com os nomes canônico+apelido; NENHUM
    // responsible_id nessa consulta.
    const reunioes = seen.filter((c) => c.metric === "*");
    const m1Call = reunioes.find((c) =>
      JSON.stringify(c.filters).includes("sdr_reuniao")
    )!;
    const mf = m1Call.filters.find((x) => x.field === "custom:sdr_reuniao")!;
    expect(mf.op).toBe("in");
    expect(mf.value).toEqual(["Um", "Um (apelido)"]);
    expect(m1Call.filters.some((x) => x.field === "responsible_id")).toBe(false);
    // f_v segue com responsible_id (expandido pelo choke point).
    const vendas = seen.filter((c) => c.metric === "value");
    expect(
      vendas.every((c) => c.filters.some((x) => x.field === "responsible_id"))
    ).toBe(true);
    // O erro do m3 ficou registrado no computed.
    const m3 = writes.find((w) => w.responsible_id === "m3") as {
      computed: { realized: Record<string, number | null>; errors?: Record<string, string> };
    };
    expect(m3.computed.realized.f_r).toBeNull();
    expect(m3.computed.errors?.f_r).toContain("memberField");
    expect(m3.computed.realized.f_v).toBe(7);
  });

  it("targetCurrency: alvo digitado em USD converte pela taxa do trimestre; sem taxa ⇒ atingimento null", async () => {
    const writes: Record<string, unknown>[] = [];
    const fake = fakeSupabase({
      rpc: {
        run_widget_query: () => ({ data: [{ metric_1: 100 }], error: null }),
      },
      tables: {
        responsibles: responsiblesHandler,
        field_definitions: [],
        field_correspondences: [],
        // Q3/2026 = 5 R$/US$ (o mês 7 cai no trimestre 3).
        currency_rates: [{ code: "USD", year: 2026, quarter: 3, rate: 5 }],
        // Alvo digitado em DÓLARES (10) — vale p/ os dois membros.
        goals: [
          { responsible_id: M1, metric: "comp_vendas", target: 10 },
          { responsible_id: M2, metric: "comp_vendas", target: 10 },
        ],
        comp_entries: (q) => {
          const ins = q.steps.find((s) => s.method === "insert");
          if (ins) {
            writes.push(ins.args[0] as Record<string, unknown>);
            return { data: null };
          }
          return { data: [] };
        },
      },
    });
    const config = {
      ...CONFIG,
      factors: [
        { ...CONFIG.factors[0], targetCurrency: "USD" },
        // 2º fator em EUR SEM taxa cadastrada: atingimento null ⇒ payout 0.
        { ...CONFIG.factors[1], targetCurrency: "EUR", defaultTarget: 4 },
      ],
    };
    const out = await recomputePlanMonth(fake.db, fake.db, {
      plan: { ...PLAN, config },
      year: 2026,
      month: 7,
      orgId: "org-1",
    });
    expect(out.ok).toBe(true);
    // Vendas: realizado 100 / (10 US$ × 5) = 200% ⇒ 1000×60%×200% = 1200.
    // Reuniões: EUR sem taxa ⇒ atingimento null ⇒ 0. Total 1200.
    const m1 = writes.find((w) => w.responsible_id === M1)!;
    expect(m1.total).toBe(1200);
  });

  it("comissão por faixas: total gravado reflete a tabela do MEMBRO (member.id chega ao computeEntry)", async () => {
    const writes: Record<string, unknown>[] = [];
    const fake = fakeSupabase({
      rpc: {
        run_widget_query: (args) => {
          const metric = (args.p_metrics as { field: string }[])[0].field;
          const m1 = JSON.stringify(respFilterOf(args) ?? "").includes(M1);
          if (metric === "value")
            return { data: [{ metric_1: m1 ? 80 : 40 }], error: null };
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
          const ins = q.steps.find((s) => s.method === "insert");
          if (ins) {
            writes.push(ins.args[0] as Record<string, unknown>);
            return { data: null };
          }
          return { data: [] };
        },
      },
    });
    const out = await recomputePlanMonth(fake.db, fake.db, {
      plan: {
        ...PLAN,
        config: {
          ...CONFIG,
          commission: {
            triggerFactorId: "f_r",
            basisKind: "factor",
            basisFactorId: "f_v",
            tiers: [{ fromPct: 100, ratePct: 10 }],
            memberTiers: { [M1]: [{ fromPct: 0, ratePct: 50 }] },
          },
        },
      },
      year: 2026,
      month: 7,
      orgId: "org-1",
    });
    expect(out.ok).toBe(true);
    // m1: fatores 880 + comissão pela tabela do MEMBRO (50% de 80 = 40) — a do
    // plano (10% ⇒ 8) daria 888. m2: gatilho sem alvo ⇒ comissão 0 ⇒ 240.
    const m1 = writes.find((w) => w.responsible_id === M1)!;
    expect(m1.total).toBe(920);
    const m2 = writes.find((w) => w.responsible_id === M2)!;
    expect(m2.total).toBe(240);
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

  it("fator money com perna escopada VAZIA: realized = soma das pernas preenchidas (nunca null)", async () => {
    // Regressão (01/08/2026, shape de produção): fórmula de operandos com
    // escopo de sub-base + modo moeda fixa BRL. A perna @vendas_site não tem
    // linhas p/ o membro (venda do site sem responsável AE) — a aux monetária
    // devolvia breakdown VAZIO ⇒ operando null ⇒ realized null ⇒ tudo zerado,
    // SEM erro registrado (não é falha de consulta).
    const writes: Record<string, unknown>[] = [];
    const fake = fakeSupabase({
      rpc: {
        run_widget_query: (args) => {
          const dims = (args.p_dimensions as unknown[]) ?? [];
          const site = JSON.stringify(args.p_filters ?? []).includes(
            "venda_site"
          );
          if (dims.length === 0) {
            // Principal: vendas_site sem linhas (sum SQL de 0 linhas = null).
            return { data: [{ metric_1: site ? null : 14510 }], error: null };
          }
          // Aux monetária: vendas_assinadas tudo BRL; vendas_site SEM linhas.
          if (site) return { data: [], error: null };
          return {
            data: [{ dim_1: "BRL", metric_1: 14510, metric_2: 2 }],
            error: null,
          };
        },
      },
      tables: {
        responsibles: responsiblesHandler,
        data_sources: [
          { key: "deals", record_type: "negocio", label: "Negócios", short_label: "Negócios", default_period_field: "closed_at", builtin: true, manual_entry: false, timezone: "Europe/Moscow", folder_id: null, sort_order: 0 },
          { key: "estudo", record_type: "venda_site", label: "Estudo", short_label: "Estudo", default_period_field: "source_created_at", builtin: true, manual_entry: false, timezone: null, folder_id: null, sort_order: 0 },
        ],
        sub_sources: [
          { key: "vendas_assinadas", parent_key: "deals", label: "Vendas Assinadas", short_label: "Vendas", default_period_field: "custom:data_assinatura", filter: [{ op: "eq", field: "stage", value: "Contrato assinado" }], sort_order: 0 },
          { key: "vendas_site", parent_key: "estudo", label: "Vendas do Site", short_label: "Site", default_period_field: "source_created_at", filter: [{ op: "gt", field: "mrr", value: 0 }], sort_order: 0 },
        ],
        field_definitions: [
          { field_key: "mrr_contrato", label: "MRR do contrato", data_type: "calculado", formula: { tokens: [] }, applies_to: ["negocio"], currency_code: null, currency_mode: "inherit", allow_negative: true, show_as_percent: false },
        ],
        field_correspondences: [],
        currency_rates: [],
        goals: [],
        comp_entries: (q) => {
          const ins = q.steps.find((s) => s.method === "insert");
          if (ins) {
            writes.push(ins.args[0] as Record<string, unknown>);
            return { data: null };
          }
          return { data: [] };
        },
      },
    });
    const out = await recomputePlanMonth(fake.db, fake.db, {
      plan: {
        ...PLAN,
        config: {
          v: 1,
          memberIds: [M2],
          factors: [
            {
              id: "valor",
              label: "Valor gerado",
              weightPct: 100,
              metricKey: "comp_valor",
              money: true,
              formula: {
                tokens: [
                  { kind: "field", ref: "agg:sum:custom:mrr_contrato@vendas_assinadas" },
                  { kind: "op", op: "+" },
                  { kind: "field", ref: "agg:sum:mrr@vendas_site" },
                ],
              },
              sources: [],
            },
          ],
        },
      },
      year: 2026,
      month: 7,
      orgId: "org-1",
    });
    expect(out).toEqual({ ok: true, members: 1, factors: 1, queryErrors: 0 });
    const entry = writes.find((w) => w.responsible_id === M2)!;
    const computed = entry.computed as {
      realized: Record<string, number | null>;
      errors?: Record<string, string>;
    };
    expect(computed.errors).toBeUndefined();
    expect(computed.realized.valor).toBe(14510);
  });

  // Fábrica do cenário de apuração M-1: um membro (m2), asserta @period das
  // consultas, mês da query de goals e entry/computed.ref gravados.
  async function runApuracao(year: number, month: number) {
    const writes: Record<string, unknown>[] = [];
    const fake = fakeSupabase({
      rpc: {
        run_widget_query: () => ({ data: [{ metric_1: 100 }], error: null }),
      },
      tables: {
        responsibles: responsiblesHandler,
        field_definitions: [],
        field_correspondences: [],
        currency_rates: [],
        goals: [{ responsible_id: M2, metric: "comp_vendas", target: 100 }],
        comp_entries: (q) => {
          const ins = q.steps.find((s) => s.method === "insert");
          if (ins) {
            writes.push(ins.args[0] as Record<string, unknown>);
            return { data: null };
          }
          return { data: [] };
        },
      },
    });
    const out = await recomputePlanMonth(fake.db, fake.db, {
      plan: {
        ...PLAN,
        config: { ...CONFIG, memberIds: [M2], apuracao: "mes_anterior" },
      },
      year,
      month,
      orgId: "org-1",
    });
    expect(out.ok).toBe(true);
    const goalsQuery = fake.queries.find((q) => q.table === "goals")!;
    const goalsEq = (field: string) =>
      goalsQuery.steps.find((s) => s.method === "eq" && s.args[0] === field)!
        .args[1];
    const mains = fake.rpcCalls.filter(
      (c) => ((c.args.p_dimensions as unknown[]) ?? []).length === 0
    );
    expect(mains.length).toBeGreaterThan(0);
    const periods = mains.map(
      (c) =>
        ((c.args.p_filters ?? []) as { field: string; value?: unknown }[]).find(
          (x) => x.field === "@period"
        )!.value as { from: string; to: string }
    );
    return { writes, goalsEq, periods };
  }

  it("apuracao mes_anterior: realizado/metas de M-1; entry no mês de pagamento com computed.ref apurado", async () => {
    const { writes, goalsEq, periods } = await runApuracao(2026, 7);
    // Metas do mês APURADO (Junho), não do lançamento.
    expect(goalsEq("period_year")).toBe(2026);
    expect(goalsEq("period_month")).toBe(6);
    // @period de TODAS as consultas principais cobre Junho inteiro.
    for (const p of periods) {
      expect(p.from.startsWith("2026-06-01")).toBe(true);
      expect(p.to.startsWith("2026-06-30")).toBe(true);
    }
    // Entry segue chaveada no mês de PAGAMENTO; ref carimba a janela apurada.
    const entry = writes.find((w) => w.responsible_id === M2)!;
    expect(entry.period_year).toBe(2026);
    expect(entry.period_month).toBe(7);
    expect((entry.computed as { ref?: unknown }).ref).toEqual({
      year: 2026,
      month: 6,
    });
    // Alvo de Junho encontrado ⇒ 100/100 = 100% ⇒ 1000×60% = 600 (f_r sem alvo).
    expect(entry.total).toBe(600);
  });

  it("apuracao mes_anterior: lançamento de janeiro apura dezembro do ano anterior", async () => {
    const { writes, goalsEq, periods } = await runApuracao(2026, 1);
    expect(goalsEq("period_year")).toBe(2025);
    expect(goalsEq("period_month")).toBe(12);
    for (const p of periods) {
      expect(p.from.startsWith("2025-12-01")).toBe(true);
      expect(p.to.startsWith("2025-12-31")).toBe(true);
    }
    const entry = writes.find((w) => w.responsible_id === M2)!;
    expect(entry.period_year).toBe(2026);
    expect(entry.period_month).toBe(1);
    expect((entry.computed as { ref?: unknown }).ref).toEqual({
      year: 2025,
      month: 12,
    });
  });
});
