// Versão: 1.0 | Data: 10/07/2026
// Fase 1 (tabela editável de registros): executa um widget de Tabela em modo
// "registros individuais". Ao contrário de runWidget (que agrega via o RPC e
// perde o id), aqui consultamos `records` DIRETO — 1 linha por registro, com id
// — para permitir edição inline das colunas personalizadas na própria tabela do
// dashboard. Reaproveita os helpers de filtro/fonte/período do engine.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { RecordRow } from "@/lib/records/types";
import { RECORD_TYPE_SOURCE } from "@/lib/sources";
import { resolveFilters, sourceFilters } from "./engine";
import { CORE_FIELDS } from "./fields";
import {
  applyPeriodToFilters,
  PERIOD_FIELD_SENTINEL,
  type DashboardPeriod,
  type PeriodBetweenValue,
} from "./period";
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
  if (period) filters = applyPeriodToFilters(filters, period, config.sources);
  filters = [...sourceFilters(config.sources), ...filters];

  // Filtros primeiro (FilterBuilder), depois order/limit (TransformBuilder).
  let q = supabase.from("records").select(RECORD_COLS);
  for (const f of filters as WidgetFilter[]) {
    // Período por fonte: filtro sintético `@period` — cada record_type filtra
    // pela sua própria coluna de data. Vira um OR de grupos AND no PostgREST.
    if (f.field === PERIOD_FIELD_SENTINEL) {
      const v = f.value as PeriodBetweenValue | undefined;
      if (!v?.byType) continue;
      const groups: string[] = [];
      for (const [rt, dateCol] of Object.entries(v.byType)) {
        // Coluna de data da fonte: núcleo ou custom (acesso JSON). Os valores
        // de data em custom_fields são ISO → a comparação textual do PostgREST
        // ordena certo. Ref desconhecido → não filtra por data esta fonte
        // (defensivo; o servidor já resolve unified:/match: antes de chegar aqui).
        const col = dateCol.startsWith("custom:")
          ? `custom_fields->>${dateCol.slice(7)}`
          : CORE_COLS.has(dateCol)
            ? dateCol
            : null;
        const conds = [`record_type.eq.${rt}`];
        if (col && v.from) conds.push(`${col}.gte.${v.from}`);
        if (col && v.to) conds.push(`${col}.lte.${v.to}`);
        groups.push(`and(${conds.join(",")})`);
      }
      if (groups.length > 0) q = q.or(groups.join(","));
      continue;
    }
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
    const records = (data ?? []) as unknown as RecordRow[];
    await attachMatches(supabase, records);
    return records;
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
  await attachMatches(supabase, all);
  return all;
}

// Preenche `__match` de cada registro (Fase 2): registro casado por fonte, para
// resolver colunas `match:<fonte>:<campo>` no modo lista. Espelha a resolução do
// RPC (migração 0042): prioriza match manual > mais recente; para a fonte leads,
// cai no `related_lead_id` quando não há match genérico.
async function attachMatches(
  supabase: SupabaseClient,
  records: RecordRow[]
): Promise<void> {
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);

  // Matches que envolvem os registros carregados (qualquer direção).
  type MatchRow = {
    record_a_id: string;
    record_b_id: string;
    mode: "auto" | "manual";
    created_at: string;
  };
  const matches: MatchRow[] = [];
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data } = await supabase
      .from("record_matches")
      .select("record_a_id, record_b_id, mode, created_at")
      .or(
        `record_a_id.in.(${slice.join(",")}),record_b_id.in.(${slice.join(",")})`
      );
    for (const m of (data ?? []) as MatchRow[]) matches.push(m);
  }

  // Ids dos registros casados + leads relacionados (fallback).
  const partnerOf = (m: MatchRow, self: string) =>
    m.record_a_id === self ? m.record_b_id : m.record_a_id;
  const wanted = new Set<string>();
  for (const m of matches) {
    wanted.add(m.record_a_id);
    wanted.add(m.record_b_id);
  }
  for (const r of records) if (r.related_lead_id) wanted.add(r.related_lead_id);
  for (const id of ids) wanted.delete(id); // já temos os próprios

  const partnerById = new Map<string, RecordRow>();
  const wantedIds = [...wanted];
  for (let i = 0; i < wantedIds.length; i += CHUNK) {
    const slice = wantedIds.slice(i, i + CHUNK);
    if (slice.length === 0) continue;
    const { data } = await supabase
      .from("records")
      .select(RECORD_COLS)
      .in("id", slice);
    for (const p of (data ?? []) as unknown as RecordRow[]) partnerById.set(p.id, p);
  }

  // Matches por registro (para escolher o melhor por fonte).
  const byRecord = new Map<string, MatchRow[]>();
  for (const m of matches) {
    for (const self of [m.record_a_id, m.record_b_id]) {
      if (!byRecord.has(self)) byRecord.set(self, []);
      byRecord.get(self)!.push(m);
    }
  }
  const rank = (m: MatchRow) =>
    (m.mode === "manual" ? 1 : 0) * 1e13 + Date.parse(m.created_at || "");

  for (const r of records) {
    const map: Record<string, RecordRow | undefined> = {};
    const own = (byRecord.get(r.id) ?? [])
      .slice()
      .sort((a, b) => rank(b) - rank(a));
    for (const m of own) {
      const partner = partnerById.get(partnerOf(m, r.id));
      if (!partner) continue;
      const src = RECORD_TYPE_SOURCE[partner.record_type];
      if (src && !map[src]) map[src] = partner; // melhor (manual/recente) vence
    }
    // Fallback do lead gêmeo (só quando não há match genérico p/ leads).
    if (!map.leads && r.related_lead_id) {
      const lead = partnerById.get(r.related_lead_id);
      if (lead) map.leads = lead;
    }
    if (Object.keys(map).length > 0) r.__match = map;
  }
}
