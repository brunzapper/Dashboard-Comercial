// Versão: 1.0 | Data: 10/10/2026
// v1.0 (10/10/2026): o filtro "Tem tarefa" chegando às consultas.
//
// Dois caminhos, UM predicado (`taskFilterWindow`, ./task-filter.ts):
//
// 1. AGREGADO (RPC `run_widget_query`): o RPC não conhece tarefas, e a regra do
//    projeto é resolver no ENGINE. `resolveTaskFilters` troca cada filtro
//    `task:` por `id in (<registros que casam>)` — a 0153 só acrescentou `id` à
//    whitelist de colunas do RPC, nada mais. Nenhum registro casa ⇒ o
//    uuid-zero (`FK_NO_MATCH`): o resultado fica VAZIO, nunca sem filtro.
//
// 2. MODO LISTA / kanban / /registros (PostgREST direto): uma lista longa de
//    ids estouraria a URL do GET. Ali o filtro vira um EMBUTIDO
//    `tfN:tasks!inner()` com os mesmos predicados (`taskEmbedSelect` +
//    `applyTaskEmbedFilters`) — o banco faz o "existe tarefa que…".
//
// A leitura de `tasks` usa o client de quem consulta: a RLS (0091) vale, então
// o vendedor enxerga só as tarefas que pode ver. É comportamento, não defeito.
import type { SupabaseClient } from "@supabase/supabase-js";

import { todayBrasiliaIso } from "@/lib/date/today";
import type { WidgetFilter } from "@/lib/widgets/types";

import {
  isTaskFilterField,
  parseTaskFilter,
  taskFilterWindow,
  type TaskFilterSpec,
  type TaskFilterWindow,
} from "./task-filter";

/** uuid-zero: casa com nenhum registro (o mesmo sentinela do engine). */
const NO_MATCH_ID = "00000000-0000-0000-0000-000000000000";

/** Página de leitura de `tasks` (teto padrão do PostgREST). */
const PAGE = 1000;

/**
 * Teto de registros distintos que um filtro de tarefa pode devolver ao RPC.
 * Acima disso a consulta falha ALTO — recortar em silêncio mostraria um número
 * menor que o real sem ninguém saber.
 */
export const MAX_TASK_FILTER_RECORDS = 20_000;

export class TaskFilterTooBroadError extends Error {
  constructor() {
    super(
      `O filtro "Tem tarefa" alcança mais de ${MAX_TASK_FILTER_RECORDS.toLocaleString("pt-BR")} registros. Estreite o estado ou a janela de dias.`
    );
  }
}

/** Separa os filtros de tarefa VÁLIDOS dos demais (inválido some, como no 0143). */
export function splitTaskFilters(filters: WidgetFilter[]): {
  record: WidgetFilter[];
  tasks: TaskFilterSpec[];
} {
  const record: WidgetFilter[] = [];
  const tasks: TaskFilterSpec[] = [];
  for (const f of filters) {
    if (!isTaskFilterField(f.field)) {
      record.push(f);
      continue;
    }
    const spec = parseTaskFilter(f);
    if (spec) tasks.push(spec);
  }
  return { record, tasks };
}

/** Há algum filtro de tarefa (válido ou não) na lista? Gate barato. */
export function hasTaskFilters(filters: WidgetFilter[] | undefined): boolean {
  return (filters ?? []).some((f) => isTaskFilterField(f.field));
}

// Construtor de consulta mínimo que as duas formas usam (tipagem frouxa de
// propósito: o PostgrestFilterBuilder genérico não se deixa estreitar aqui).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;

function applyWindow(q: Q, w: TaskFilterWindow, prefix: string): Q {
  const col = (c: string) => (prefix ? `${prefix}.${c}` : c);
  if (w.completed === "open") q = q.is(col("completed_at"), null);
  else if (w.completed === "done") q = q.not(col("completed_at"), "is", null);
  if (w.dueFrom) q = q.gte(col("due_date"), w.dueFrom);
  if (w.dueTo) q = q.lte(col("due_date"), w.dueTo);
  return q;
}

/** Ids distintos dos registros com ao menos uma tarefa que casa com o spec. */
export async function taskFilterRecordIds(
  db: SupabaseClient,
  spec: TaskFilterSpec,
  todayIso: string = todayBrasiliaIso()
): Promise<Set<string>> {
  const w = taskFilterWindow(spec, todayIso);
  const ids = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    let q: Q = db.from("tasks").select("record_id").not("record_id", "is", null);
    q = applyWindow(q, w, "");
    const { data, error } = await q.order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`Falha ao ler tarefas: ${error.message}`);
    const rows = (data ?? []) as { record_id: string | null }[];
    for (const r of rows) {
      if (r.record_id) ids.add(r.record_id);
      if (ids.size > MAX_TASK_FILTER_RECORDS) throw new TaskFilterTooBroadError();
    }
    if (rows.length < PAGE) break;
  }
  return ids;
}

/**
 * Caminho AGREGADO: cada filtro `task:` vira `id in (...)`. Vários filtros de
 * tarefa somam como E (interseção), igual a qualquer filtro do widget. Sem
 * filtro de tarefa, devolve a MESMA lista (fast path, sem consulta).
 */
export async function resolveTaskFilters(
  db: SupabaseClient,
  filters: WidgetFilter[],
  todayIso: string = todayBrasiliaIso()
): Promise<WidgetFilter[]> {
  if (!hasTaskFilters(filters)) return filters;
  const { record, tasks } = splitTaskFilters(filters);
  if (tasks.length === 0) return record;
  let acc: Set<string> | undefined;
  for (const spec of tasks) {
    const ids = await taskFilterRecordIds(db, spec, todayIso);
    const prev: Set<string> | undefined = acc;
    acc = prev ? new Set([...prev].filter((id: string) => ids.has(id))) : ids;
    if (acc.size === 0) break;
  }
  const list = acc && acc.size > 0 ? [...acc] : [NO_MATCH_ID];
  return [...record, { field: "id", op: "in", value: list }];
}

/**
 * Modo lista: trecho do `select` com um embutido VAZIO (`tasks!inner()`) por
 * filtro de tarefa — o PostgREST usa o embutido só para filtrar o registro pai
 * e não devolve nada dele (nenhuma tarefa atravessa para o payload).
 */
export function taskEmbedSelect(specs: TaskFilterSpec[]): string {
  return specs.map((_, i) => `, tf${i}:tasks!inner()`).join("");
}

/** Modo lista: os predicados de cada embutido (mesma janela do agregado). */
export function applyTaskEmbedFilters<T>(
  q: T,
  specs: TaskFilterSpec[],
  todayIso: string = todayBrasiliaIso()
): T {
  let out: Q = q;
  specs.forEach((spec, i) => {
    out = applyWindow(out, taskFilterWindow(spec, todayIso), `tf${i}`);
  });
  return out as T;
}
