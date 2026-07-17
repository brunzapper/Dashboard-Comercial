// Versão: 1.0 | Data: 17/07/2026
// Dedup de RPCs run_widget_query dentro de UM render do dashboard: cada widget
// dispara 1-4 chamadas (base + breakdowns de moeda + bases condicionais) e
// widgets duplicados / notas / calculadoras com o mesmo escopo geram chamadas
// IDÊNTICAS — cada uma um scan agregado da tabela records. Este wrapper memoiza
// por argumentos (JSON estável na prática: os args são construídos sempre na
// mesma ordem pelo engine), compartilhando UMA promise por chave.
//
// structuredClone no resultado é OBRIGATÓRIO: o engine muta os rows in place
// (remap de métricas, attachMoney, reescrita de rótulos) — compartilhar o mesmo
// objeto entre widgets corromperia os dados.
//
// Mesmo precedente de shape do lib/snapshots/db-adapter.ts: o engine só usa
// .rpc() e .from() do client injetado. Demais RPCs e .from passam direto.
// NÃO altera o RPC em si (regra do projeto: run_widget_query intocado).
import type { SupabaseClient } from "@supabase/supabase-js";

type RpcResult = { data: unknown; error: { message: string } | null };

export function withRpcMemo(client: SupabaseClient): SupabaseClient {
  const memo = new Map<string, Promise<RpcResult>>();
  const wrapper = {
    rpc(fn: string, args?: Record<string, unknown>) {
      if (fn !== "run_widget_query") return client.rpc(fn, args);
      const key = JSON.stringify(args ?? {});
      let p = memo.get(key);
      if (!p) {
        p = Promise.resolve(client.rpc(fn, args)).then(
          ({ data, error }: RpcResult) => ({ data, error })
        );
        memo.set(key, p);
      }
      return p.then(({ data, error }) => ({
        data: data == null ? data : structuredClone(data),
        error,
      }));
    },
    from(table: string) {
      return client.from(table);
    },
  };
  return wrapper as unknown as SupabaseClient;
}
