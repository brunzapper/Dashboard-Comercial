// Versão: 1.0 | Data: 24/07/2026
// Cliente Supabase FAKE para testes do engine — espelha o formato que o
// próprio produto usa no snapshotClient (lib/snapshots/db-adapter.ts): um
// objeto plano { rpc, from } com cast `as unknown as SupabaseClient`, já que
// o engine só toca `.rpc()` e `.from(...)` + cadeia PostgREST. Fail-closed
// como o adapter: rpc/tabela sem handler LANÇA (um teste nunca deve consultar
// algo que não previu).
//
// - rpc: handler por nome de função; recebe (args, index) — o index é o nº
//   da chamada DAQUELA função (0-based), para respostas distintas por rodada
//   (ex.: N meses do businessDayAlign).
// - from: builder Proxy encadeável; qualquer método grava { method, args } e
//   devolve o próprio proxy; `await` (thenable) resolve o handler da tabela
//   com a cadeia gravada — dá para responder condicionado a `.eq("is_mock",
//   true)` etc. Handler pode ser um array fixo (vira { data, error: null }).
// - Toda chamada fica registrada em `rpcCalls`/`queries` para asserção.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface RecordedRpc {
  fn: string;
  args: Record<string, unknown>;
}

export interface QueryStep {
  method: string;
  args: unknown[];
}

export interface RecordedQuery {
  table: string;
  steps: QueryStep[];
}

export interface TableResult {
  data?: unknown;
  error?: { message: string } | null;
  count?: number | null;
}

export type RpcHandler = (
  args: Record<string, unknown>,
  index: number
) => { data: unknown; error: null } | { data: null; error: { message: string } };

export type TableHandler = unknown[] | ((q: RecordedQuery) => TableResult);

export interface FakeSupabase {
  db: SupabaseClient;
  rpcCalls: RecordedRpc[];
  queries: RecordedQuery[];
}

/** Atalho: handler de rpc que devolve sempre as mesmas linhas. */
export function rpcRows(rows: unknown[]): RpcHandler {
  return () => ({ data: rows, error: null });
}

/** Atalho: uma resposta POR CHAMADA (índice além do fim → última). */
export function rpcSequence(perCall: unknown[][]): RpcHandler {
  return (_args, index) => ({
    data: perCall[Math.min(index, perCall.length - 1)],
    error: null,
  });
}

/** A cadeia gravada tem o passo `method(args…)`? (compara por JSON). */
export function hasStep(
  q: RecordedQuery,
  method: string,
  ...args: unknown[]
): boolean {
  return q.steps.some(
    (s) =>
      s.method === method &&
      JSON.stringify(s.args) === JSON.stringify(args)
  );
}

export function fakeSupabase(handlers: {
  rpc?: Record<string, RpcHandler>;
  tables?: Record<string, TableHandler>;
}): FakeSupabase {
  const rpcCalls: RecordedRpc[] = [];
  const queries: RecordedQuery[] = [];
  const rpcCountByFn = new Map<string, number>();

  function makeBuilder(table: string) {
    const rec: RecordedQuery = { table, steps: [] };
    queries.push(rec);
    const resolve = (): TableResult => {
      const handler = handlers.tables?.[table];
      if (handler == null) {
        throw new Error(`fakeSupabase: tabela sem handler: ${table}`);
      }
      if (Array.isArray(handler)) {
        return { data: handler, error: null, count: handler.length };
      }
      return handler(rec);
    };
    const proxy: unknown = new Proxy(
      {},
      {
        get(_t, prop: string | symbol) {
          if (prop === "then") {
            // Thenable: `await q` resolve o handler com a cadeia gravada.
            return (
              onFulfilled: (v: {
                data: unknown;
                error: { message: string } | null;
                count: number | null;
              }) => unknown
            ) => {
              const r = resolve();
              return Promise.resolve(
                onFulfilled({
                  data: r.data ?? null,
                  error: r.error ?? null,
                  count: r.count ?? null,
                })
              );
            };
          }
          if (typeof prop === "symbol") return undefined;
          return (...args: unknown[]) => {
            rec.steps.push({ method: prop, args });
            return proxy;
          };
        },
      }
    );
    return proxy;
  }

  const client = {
    rpc(fn: string, args: Record<string, unknown> = {}) {
      const handler = handlers.rpc?.[fn];
      if (!handler) {
        throw new Error(`fakeSupabase: rpc sem handler: ${fn}`);
      }
      rpcCalls.push({ fn, args });
      const index = rpcCountByFn.get(fn) ?? 0;
      rpcCountByFn.set(fn, index + 1);
      return Promise.resolve(handler(args, index));
    },
    from(table: string) {
      return makeBuilder(table);
    },
  };

  return { db: client as unknown as SupabaseClient, rpcCalls, queries };
}
