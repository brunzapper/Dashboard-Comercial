// Versão: 1.0 | Data: 10/07/2026
// Fase 1 (tabela editável de registros): executa um widget de Tabela em modo
// "registros individuais". Ao contrário de runWidget (que agrega via o RPC e
// perde o id), aqui consultamos `records` DIRETO — 1 linha por registro, com id
// — para permitir edição inline das colunas personalizadas na própria tabela do
// dashboard. Reaproveita os helpers de filtro/fonte/período do engine.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { RecordRow } from "@/lib/records/types";
import { resolveFilters, sourceFilters } from "./engine";
import { CORE_FIELDS } from "./fields";
import { applyPeriodToFilters, type DashboardPeriod } from "./period";
import { SEARCH_FIELD_SEP } from "./view-filters";
import type { WidgetConfig, WidgetFilter } from "./types";

// Mesmas colunas carregadas na página de Registros — satisfaz RecordRow.
const RECORD_COLS =
  "id, record_type, source_system, title, pipeline, stage, value, mrr, currency, sale_type, channel, closed, closed_at, opened_at, source_created_at, responsible_id, operation_id, related_lead_id, lead_time_days, custom_fields, last_synced_at, locally_modified_at";

// Colunas do núcleo que podem ser filtradas com segurança (whitelist).
const CORE_COLS = new Set<string>([
  ...CORE_FIELDS.map((f) => f.field),
  "record_type",
]);

// Traduz o `field` de um WidgetFilter para a coluna consultável no PostgREST.
// custom:<k> vira o acesso JSON `custom_fields->>k`. Campos fora da whitelist
// (ex.: unified:*) retornam null e o filtro é ignorado no modo lista.
function filterColumn(field: string): string | null {
  if (field.startsWith("custom:")) return `custom_fields->>${field.slice(7)}`;
  return CORE_COLS.has(field) ? field : null;
}

/**
 * Lista os registros de um widget de Tabela em modo "registros individuais",
 * aplicando fontes/período/filtros do widget (mesma semântica de runWidget).
 */
export async function runRecordList(
  supabase: SupabaseClient,
  config: WidgetConfig,
  period?: DashboardPeriod | null
): Promise<RecordRow[]> {
  let filters = resolveFilters(config.filters ?? []);
  if (period) filters = applyPeriodToFilters(filters, period);
  filters = [...sourceFilters(config.sources), ...filters];

  // Filtros primeiro (FilterBuilder), depois order/limit (TransformBuilder).
  let q = supabase.from("records").select(RECORD_COLS);
  for (const f of filters as WidgetFilter[]) {
    // Busca textual (ilike): o field pode unir vários campos com '|' → OR entre
    // colunas. O valor é o termo cru; aqui envolvemos com curingas.
    if (f.op === "ilike") {
      const term = String(f.value ?? "").trim();
      if (!term) continue;
      const cols = f.field
        .split(SEARCH_FIELD_SEP)
        .map(filterColumn)
        .filter((c): c is string => Boolean(c));
      if (cols.length === 0) continue;
      // Curingas/valor seguros para a sintaxe de .or() do PostgREST (sem vírgula/parênteses).
      const safe = term.replace(/[,()]/g, " ").trim();
      if (cols.length === 1) {
        q = q.ilike(cols[0], `%${safe}%`);
      } else {
        q = q.or(cols.map((c) => `${c}.ilike.*${safe}*`).join(","));
      }
      continue;
    }
    const col = filterColumn(f.field);
    if (!col) continue;
    switch (f.op) {
      case "eq":
        q = q.eq(col, f.value as never);
        break;
      case "neq":
        q = q.neq(col, f.value as never);
        break;
      case "gt":
        q = q.gt(col, f.value as never);
        break;
      case "gte":
        q = q.gte(col, f.value as never);
        break;
      case "lt":
        q = q.lt(col, f.value as never);
        break;
      case "lte":
        q = q.lte(col, f.value as never);
        break;
      case "in":
        q = q.in(col, (Array.isArray(f.value) ? f.value : [f.value]) as never[]);
        break;
      case "is_null":
        q = q.is(col, null);
        break;
      case "not_null":
        q = q.not(col, "is", null);
        break;
    }
  }

  // Sem limite por padrão (o usuário pediu p/ remover o teto); só aplica quando
  // o widget define settings.limit explicitamente.
  const tq = q.order("source_created_at", { ascending: false, nullsFirst: false });
  const limit = config.settings?.limit;
  if (typeof limit === "number" && limit > 0) {
    const { data, error } = await tq.limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as RecordRow[];
  }

  // Busca paginada p/ driblar o teto server-side do PostgREST ("Max Rows"), que
  // trunca respostas sem .range() (ex.: 100 ou 1000 linhas). Avança pelo total
  // REALMENTE lido (não por um passo fixo) e para só quando o lote vem vazio —
  // assim funciona seja o cap 100, 1000 ou qualquer outro, mesmo < BATCH.
  const BATCH = 1000;
  const all: RecordRow[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await tq.range(from, from + BATCH - 1);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as unknown as RecordRow[];
    if (chunk.length === 0) break;
    all.push(...chunk);
    from += chunk.length;
  }
  return all;
}
