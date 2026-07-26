// Versão: 1.0 | Data: 26/07/2026
// Testes do cache TTL de run_widget_query entre requisições (rpc-cache):
// hit/miss por chave, isolamento por scopeKey (segurança — RLS por usuário),
// expiração por TTL, erro nunca em cache, clone na leitura (o engine muta
// rows) e compartilhamento de promise em voo. Client fake mínimo: o wrapper
// só consome .rpc()/.from().
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { clearWidgetRpcCache, withRpcTtlCache } from "./rpc-cache";

type RpcImpl = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

function fakeClient(impl: RpcImpl) {
  const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  const client = {
    rpc(fn: string, args?: Record<string, unknown>) {
      calls.push({ fn, args });
      return impl(fn, args);
    },
    from(table: string) {
      return { table };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const okImpl: RpcImpl = async (_fn, args) => ({
  data: [{ metric_1: 10, echo: args?.p_marker ?? null }],
  error: null,
});

beforeEach(() => {
  clearWidgetRpcCache();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.WIDGET_RPC_CACHE_TTL_MS;
});

describe("withRpcTtlCache", () => {
  it("mesma chave dentro do TTL usa 1 chamada; resultados idênticos", async () => {
    const { client, calls } = fakeClient(okImpl);
    const db = withRpcTtlCache(client, "u:1");
    const a = await db.rpc("run_widget_query", { p_marker: "x" });
    const b = await db.rpc("run_widget_query", { p_marker: "x" });
    expect(calls).toHaveLength(1);
    expect(b.data).toEqual(a.data);
  });

  it("clona na leitura: mutar um resultado não vaza para o próximo", async () => {
    const { client } = fakeClient(okImpl);
    const db = withRpcTtlCache(client, "u:1");
    const a = await db.rpc("run_widget_query", {});
    (a.data as Array<Record<string, unknown>>)[0].metric_1 = 999;
    const b = await db.rpc("run_widget_query", {});
    expect((b.data as Array<Record<string, unknown>>)[0].metric_1).toBe(10);
  });

  it("expira pelo TTL e reconsulta", async () => {
    process.env.WIDGET_RPC_CACHE_TTL_MS = "1000";
    const { client, calls } = fakeClient(okImpl);
    const db = withRpcTtlCache(client, "u:1");
    await db.rpc("run_widget_query", {});
    vi.advanceTimersByTime(1001);
    await db.rpc("run_widget_query", {});
    expect(calls).toHaveLength(2);
  });

  it("scopeKeys diferentes NUNCA compartilham entradas (RLS por usuário)", async () => {
    const { client, calls } = fakeClient(okImpl);
    const a = withRpcTtlCache(client, "u:1");
    const b = withRpcTtlCache(client, "u:2");
    await a.rpc("run_widget_query", { p_marker: "x" });
    await b.rpc("run_widget_query", { p_marker: "x" });
    expect(calls).toHaveLength(2);
  });

  it("erro não fica em cache: a chamada seguinte reconsulta", async () => {
    let fail = true;
    const { client, calls } = fakeClient(async () =>
      fail
        ? { data: null, error: { message: "timeout" } }
        : { data: [{ metric_1: 1 }], error: null }
    );
    const db = withRpcTtlCache(client, "u:1");
    const first = await db.rpc("run_widget_query", {});
    expect(first.error?.message).toBe("timeout");
    fail = false;
    const second = await db.rpc("run_widget_query", {});
    expect(second.error).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("chamadas concorrentes em voo compartilham a MESMA execução", async () => {
    let resolve!: (v: { data: unknown; error: null }) => void;
    const pending = new Promise<{ data: unknown; error: null }>((r) => {
      resolve = r;
    });
    const { client, calls } = fakeClient(() => pending);
    const db = withRpcTtlCache(client, "u:1");
    const p1 = db.rpc("run_widget_query", {});
    const p2 = db.rpc("run_widget_query", {});
    resolve({ data: [{ metric_1: 5 }], error: null });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(calls).toHaveLength(1);
    expect(r1.data).toEqual(r2.data);
    // Clones independentes, não o mesmo objeto (o engine muta in place).
    expect(r1.data).not.toBe(r2.data);
  });

  it("TTL 0 desliga o cache (client original, sem wrapper)", async () => {
    process.env.WIDGET_RPC_CACHE_TTL_MS = "0";
    const { client, calls } = fakeClient(okImpl);
    const db = withRpcTtlCache(client, "u:1");
    expect(db).toBe(client);
    await db.rpc("run_widget_query", {});
    await db.rpc("run_widget_query", {});
    expect(calls).toHaveLength(2);
  });

  it("outros RPCs e .from passam direto, sem cache", async () => {
    const { client, calls } = fakeClient(okImpl);
    const db = withRpcTtlCache(client, "u:1");
    await db.rpc("operation_subtree", { p_root: "a" });
    await db.rpc("operation_subtree", { p_root: "a" });
    expect(calls).toHaveLength(2);
    expect((db.from("records") as unknown as { table: string }).table).toBe(
      "records"
    );
  });
});
