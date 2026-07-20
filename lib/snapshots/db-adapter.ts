// Versão: 1.0 | Data: 15/07/2026
// A costura entre o engine de widgets e o dataset CONGELADO de um snapshot,
// sem mudar nada em lib/widgets/*: todas as funções de computação (runWidget,
// runRecordList, runEntityList, runCalculatedWidget, fetchFkLabels,
// attachMatches, resolveGoal) já recebem um SupabaseClient injetado e só usam
// .rpc() e .from(). Este client:
//  * redireciona `run_widget_query` → `run_widget_query_snapshot` (com o
//    p_snapshot_id) e `records`/`record_matches` → as tabelas congeladas,
//    sempre escopadas pelo snapshot;
//  * deixa passar apenas as tabelas/RPCs de apoio (nomes de entidades, metas)
//    cujos ids consultados vêm SEMPRE das linhas congeladas;
//  * FALHA FECHADO: qualquer outra tabela/RPC lança — código novo que tente
//    ler dados vivos pelo caminho público quebra em vez de vazar.
// Recebe o client de service role (o viewer público não tem sessão/RLS), por
// isso este módulo é servidor-apenas e o chamador PRECISA ter validado o token
// antes (app/s/[token]) ou estar num contexto autenticado (refresh).
import type { SupabaseClient } from "@supabase/supabase-js";

// Tabelas de apoio permitidas como estão: nomes/valores de entidades e metas.
// Os ids pesquisados vêm das linhas congeladas; ler o rótulo/meta AO VIVO é
// desejável (renomear um responsável não exige refresh do snapshot).
const PASSTHROUGH_TABLES = new Set([
  "responsibles",
  "operations",
  "responsible_operations",
  "goals",
  "entity_custom_values",
  // Dias não úteis (0081): cálculo de dia útil (goalLine 'pace',
  // businessDayAlign, previous_period_bd) usa o calendário AO VIVO, como as
  // metas — cadastrar um feriado não exige refresh do snapshot.
  "non_working_days",
]);

// RPCs de apoio: subárvore de operações (resolução de metas, lib/metas).
const PASSTHROUGH_RPCS = new Set(["operation_subtree"]);

/**
 * SupabaseClient "de snapshot": mesma interface consumida pelo engine, mas
 * toda leitura de registros sai do dataset congelado do snapshot.
 */
export function snapshotClient(
  service: SupabaseClient,
  snapshotId: string
): SupabaseClient {
  const client = {
    rpc(fn: string, args?: Record<string, unknown>) {
      if (fn === "run_widget_query") {
        return service.rpc("run_widget_query_snapshot", {
          p_snapshot_id: snapshotId,
          ...(args ?? {}),
        });
      }
      if (PASSTHROUGH_RPCS.has(fn)) return service.rpc(fn, args);
      throw new Error(`snapshotClient: rpc não permitida: ${fn}`);
    },
    from(table: string) {
      // O .eq(snapshot_id) entra logo após o .select(), então o retorno segue
      // sendo um FilterBuilder do PostgREST — os encadeamentos usados pelo
      // engine (.eq/.in/.or/.order/.range/.limit) continuam válidos.
      if (table === "records") {
        return {
          select: (cols: string) =>
            service
              .from("snapshot_records")
              .select(cols)
              .eq("snapshot_id", snapshotId),
        };
      }
      if (table === "record_matches") {
        return {
          select: (cols: string) =>
            service
              .from("snapshot_record_matches")
              .select(cols)
              .eq("snapshot_id", snapshotId),
        };
      }
      if (PASSTHROUGH_TABLES.has(table)) return service.from(table);
      throw new Error(`snapshotClient: tabela não permitida: ${table}`);
    },
  };
  return client as unknown as SupabaseClient;
}
