// Versão: 1.0 | Data: 24/07/2026
// PARIDADE EXECUTADA das RPCs de widget (complemento da guarda estática
// tests/rpc-parity.test.ts — fecha o item 1 da §6 do manual): roda a MESMA
// config em `run_widget_query` (dados vivos) e `run_widget_query_snapshot`
// (cópia congelada SEM restrições) e exige resultados IDÊNTICOS. Com
// `allowed_*` null o predicado interno do snapshot reduz ao comportamento
// base, então QUALQUER divergência é bug real de espelhamento.
//
// Exige banco (stack local do CI/dev: `npm run db:start` + `npm run db:seed`,
// env de `supabase status -o env`). Sem env, a suíte é PULADA — `npm test`
// segue sem dependências. Roda como SERVICE ROLE: as funções de snapshot são
// service-role-only (invariante de acesso público).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import {
  DASHBOARD_ID,
  EXPECTED,
  PARITY_SNAPSHOT_ID,
  REUNIAO_KEY,
} from "@/tests/helpers/e2e-fixtures";
import { hashToken } from "@/lib/snapshots/token";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface RpcArgs {
  p_source: string;
  p_dimensions?: unknown[];
  p_metrics?: unknown[];
  p_filters?: unknown[];
  p_correspondences?: Record<string, string[]>;
}

// Ordenação canônica (o RPC não tem ORDER BY) p/ comparação estável.
function canon(rows: unknown): unknown[] {
  return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
    const ka = JSON.stringify(a);
    const kb = JSON.stringify(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

describe.skipIf(!URL || !KEY)("paridade RPC executada (banco vivo)", () => {
  let db: SupabaseClient;

  beforeAll(async () => {
    db = createClient(URL!, KEY!, { auth: { persistSession: false } });
    // Snapshot PRÓPRIO da suíte (id distinto do e2e), sem NENHUMA restrição, e
    // recongelado a cada run — o dataset do snapshot espelha o vivo.
    const { error: upErr } = await db.from("snapshots").upsert(
      {
        id: PARITY_SNAPSHOT_ID,
        dashboard_id: DASHBOARD_ID,
        tab_id: "",
        name: "Paridade viva",
        token_hash: hashToken("PARIDADE_viva_token_0123456789_ABCDEFGHIJKL"),
        status: "active",
        refresh_mode: "manual",
      },
      { onConflict: "id" }
    );
    if (upErr) throw new Error(`snapshots upsert: ${upErr.message}`);
    const { error: copyErr } = await db.rpc("snapshot_refresh_copy", {
      p_snapshot_id: PARITY_SNAPSHOT_ID,
    });
    if (copyErr) throw new Error(`snapshot_refresh_copy: ${copyErr.message}`);
  }, 30_000);

  async function bothSides(args: RpcArgs): Promise<{
    live: unknown[];
    snap: unknown[];
  }> {
    const [live, snap] = await Promise.all([
      db.rpc("run_widget_query", args as never),
      db.rpc("run_widget_query_snapshot", {
        p_snapshot_id: PARITY_SNAPSHOT_ID,
        ...args,
      } as never),
    ]);
    if (live.error) throw new Error(`run_widget_query: ${live.error.message}`);
    if (snap.error) {
      throw new Error(`run_widget_query_snapshot: ${snap.error.message}`);
    }
    return { live: canon(live.data), snap: canon(snap.data) };
  }

  // A matriz cobre os ramos principais do corpo compartilhado: agregação
  // simples, dims, @period byType, unificados (p_correspondences), operadores
  // normalizados (0050) e o gate mock-aware (0052/0057).
  const MATRIX: { name: string; args: RpcArgs }[] = [
    {
      name: "contagem pura, sem dims",
      args: { p_source: "records", p_metrics: [{ field: "*", agg: "count" }] },
    },
    {
      name: "soma por dimensão (pipeline × Σ valor, só negócios)",
      args: {
        p_source: "records",
        p_dimensions: [{ field: "pipeline" }],
        p_metrics: [
          { field: "value", agg: "sum" },
          { field: "*", agg: "count" },
        ],
        p_filters: [{ field: "record_type", op: "in", value: ["negocio"] }],
      },
    },
    {
      name: "filtro sintético @period com byType por record_type",
      args: {
        p_source: "records",
        p_metrics: [{ field: "*", agg: "count" }],
        p_filters: [
          {
            field: "@period",
            op: "between",
            value: {
              from: "2026-07-01",
              to: "2026-07-31T23:59:59",
              byType: {
                negocio: "closed_at",
                lead: "source_created_at",
              },
            },
          },
        ],
      },
    },
    {
      name: "campo unificado via p_correspondences (bucket por mês)",
      args: {
        p_source: "records",
        p_dimensions: [{ field: "unified:data_ref", transform: "month" }],
        p_metrics: [{ field: "*", agg: "count" }],
        p_correspondences: {
          data_ref: ["closed_at", "source_created_at"],
        },
      },
    },
    {
      name: "operadores normalizados da 0050 (eq_ci + gt_num)",
      args: {
        p_source: "records",
        p_metrics: [{ field: "value", agg: "sum" }],
        p_filters: [
          { field: "pipeline", op: "eq_ci", value: " INBOUND " },
          { field: "value", op: "gt_num", value: 999 },
        ],
      },
    },
    {
      name: "gate mock-aware: consulta referencia Data Reunião (0052)",
      args: {
        p_source: "records",
        p_metrics: [{ field: `custom:${REUNIAO_KEY}`, agg: "count" }],
        p_filters: [{ field: "record_type", op: "in", value: ["lead"] }],
      },
    },
    {
      name: "sem Data Reunião: mock fica FORA dos dois lados",
      args: {
        p_source: "records",
        p_metrics: [{ field: "*", agg: "count" }],
        p_filters: [{ field: "record_type", op: "in", value: ["lead"] }],
      },
    },
  ];

  for (const { name, args } of MATRIX) {
    it(name, async () => {
      const { live, snap } = await bothSides(args);
      expect(snap).toEqual(live);
    });
  }

  it("sanidade do seed: os agregados esperados batem (fixtures)", async () => {
    const { live } = await bothSides({
      p_source: "records",
      p_metrics: [
        { field: "*", agg: "count" },
        { field: "value", agg: "sum" },
      ],
      p_filters: [{ field: "record_type", op: "in", value: ["negocio"] }],
    });
    expect(live[0]).toMatchObject({
      metric_1: EXPECTED.dealsCount,
      metric_2: EXPECTED.dealsSumValue,
    });
    const { live: leads } = await bothSides({
      p_source: "records",
      p_metrics: [{ field: "*", agg: "count" }],
      p_filters: [{ field: "record_type", op: "in", value: ["lead"] }],
    });
    expect(leads[0]).toMatchObject({ metric_1: EXPECTED.leadsCount });
  });
});
