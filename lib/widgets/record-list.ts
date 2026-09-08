// Versão: 2.2 | Data: 07/08/2026
// v2.2 (07/08/2026): stage_semantic no RECORD_COLS — paridade da grade núcleo
//   do painel de detalhe (coreDetailRows pula refs ausentes do select; sem a
//   coluna, o kanban não exibia a Situação no card).
// v2.1 (27/07/2026): opts.orgId — escopo EXPLÍCITO de organização na consulta
//   (eq organization_id). Para chamadores com SERVICE ROLE (engine de
//   automações do kanban), onde a RLS não escopa; caminhos de sessão seguem
//   sem o opt (RLS manda), comportamento idêntico.
// v2.0 (26/07/2026): janela incremental do full fetch — runRecordListWindow
//   (offset + teto com count exato; desempate por id p/ janelas estáveis) e
//   runRecordListWithExtras ganha windowOpts: widgets SEM pernas de
//   Metric.sources e sem limit buscam só a 1ª janela (default 1000, env
//   RECORD_LIST_WINDOW; 0 = sem teto) e o cliente carrega as próximas via
//   action. Com pernas, o full fetch segue (basis dos subtotais precisa do
//   conjunto completo). Filtro @bucket (pós-fetch) segue sem janela.
// v1.9 (26/07/2026): agrupamento de responsáveis (0101) — runRecordList e
//   runRecordListPage expandem filtros responsible_id p/ o grupo (apelidos ∪
//   principal) ANTES de montar a query PostgREST (a decisão dos mocks não
//   muda: a expansão não toca refs de Data Reunião). Gate igual ao engine.
// v1.8 (21/07/2026): dia de Brasília (0085) — o ramo @period ancora bounds de
// coluna do núcleo (timestamptz) com -03:00 (anchorCoreDateBound); custom
// (texto) segue naive. Os ops simples já chegam ancorados via resolveFilters.
// v1.7 (20/07/2026): top-up de mocks das pernas COBERTAS — quando as fontes da
//   métrica (Metric.sources) já estão dentro das do widget (inclusive widget em
//   "todas as fontes"), não há fetch extra e a regra dos mocks da EXIBIÇÃO não
//   vê as métricas das pernas → mocks de Data Reunião sumiam da basis. Agora um
//   fetch adicional só de is_mock=true (runCoveredLegMockTopUp; pipeline
//   idêntico via resolveListFilters/recordListIncludesMocks) entra no stream de
//   extras — mocks na basis sem virar linha, paridade com o caminho RPC.
// v1.6 (19/07/2026): attachMatches com chunks em PARALELO (Promise.all) nas
//   duas fases (record_matches e registros parceiros) — antes eram awaits
//   seriais (~2×N/200 round-trips em sequência numa lista grande). Resultado
//   idêntico: a escolha do melhor match por fonte é por rank, indiferente à
//   ordem de chegada dos lotes.
// v1.5 (18/07/2026): fontes por métrica — runRecordListWithExtras busca, além
//   dos registros de EXIBIÇÃO (fontes do widget, intactos), os registros das
//   fontes extras das pernas (Metric.sources) p/ a basis dos subtotais no
//   cliente. O fetch extra NÃO tem rowMode/columns: a regra dos mocks passa a
//   inspecionar as métricas das pernas (mocks entram na basis sem virar linha).
// v1.4 (17/07/2026): paginação server-side — construtor de consulta extraído
//   (buildRecordListQuery) e novo runRecordListPage: widgets elegíveis
//   (ver serverPaginatedList em ./view-filters) buscam SÓ a página visível
//   com count exato, em vez do conjunto completo. Filtros @bucket (pós-fetch)
//   caem no full fetch e paginam após o pós-filtro (total correto).
// v1.3 (16/07/2026): seleciona `is_mock` (o kanban bloqueia arrastar mocks).
// v1.2 (16/07/2026): regra dos mocks alinhada ao RPC — passa a inspecionar
//   dimensões/métricas (caminho "Agrupar período") e a expandir unified: via
//   correspondências (helper compartilhado em ./mock-reuniao).
// v1.1 (15/07/2026): filtros segmentados por fonte — espelha o wrapper
//   pass-through do RPC (0054) com `.or(record_type.not.in...)` do PostgREST.
// Fase 1 (tabela editável de registros): executa um widget de Tabela em modo
// "registros individuais". Ao contrário de runWidget (que agrega via o RPC e
// perde o id), aqui consultamos `records` DIRETO — 1 linha por registro, com id
// — para permitir edição inline das colunas personalizadas na própria tabela do
// dashboard. Reaproveita os helpers de filtro/fonte/período do engine.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import { isCoreDef } from "@/lib/records/core-defs";
import {
  BUILTIN_SOURCES,
  isSubSource,
  planSourceLegs,
  toSourceKey,
  type SourceDef,
} from "@/lib/sources";
import { resolveFilters, resolveFkFilterNames, sourceFilters } from "./engine";
import {
  expandResponsibleFilters,
  filtersReferenceResponsible,
  loadResponsibleCanon,
} from "@/lib/config/responsible-canon";
import { applyFilterSourceTargets } from "./filter-sources";
import { coveredLegSources, partitionMetricLegs } from "./metric-sources";
import { CORE_FIELDS, type AvailableField } from "./fields";
import { includesMockReuniaoRef } from "./mock-reuniao";
import {
  anchorCoreDateBound,
  applyPeriodToFilters,
  CORE_DATE_COLS,
  PERIOD_FIELD_SENTINEL,
  type DashboardPeriod,
  type PeriodBetweenValue,
} from "./period";
import {
  BUCKET_FIELD_SENTINEL,
  bucketFilterValue,
  matchesBucketFilter,
  type BucketFilterValue,
} from "./quick-filters";
import { SEARCH_FIELD_SEP } from "./view-filters";
import type { WidgetConfig, WidgetFilter } from "./types";

// Mesmas colunas carregadas na página de Registros — satisfaz RecordRow.
// Exportada p/ consultas irmãs que precisam de linhas RecordRow completas
// (ex.: contagem de conectados das automações do kanban).
export const RECORD_COLS =
  "id, record_type, source_system, title, pipeline, stage, stage_semantic, value, mrr, currency, sale_type, channel, closed, closed_at, opened_at, source_created_at, responsible_id, operation_id, related_lead_id, lead_time_days, custom_fields, last_synced_at, locally_modified_at, is_mock";

// Colunas do núcleo que podem ser filtradas com segurança (whitelist).
// ESPELHO: mudanças aqui, em filterColumn ou no ramo ilike abaixo devem ser
// espelhadas em ./record-search.ts (busca textual client-side do modo lista).
const CORE_COLS = new Set<string>([
  ...CORE_FIELDS.map((f) => f.field),
  "record_type",
]);

// Traduz o `field` de um WidgetFilter para a coluna consultável no PostgREST.
// custom:<k> vira o acesso JSON `custom_fields->>k`. Campos fora da whitelist
// retornam null e o filtro é ignorado no modo lista (unified:* é expandido por
// fonte ANTES, no loop de filtros).
function filterColumn(field: string): string | null {
  if (field.startsWith("custom:")) return `custom_fields->>${field.slice(7)}`;
  return CORE_COLS.has(field) ? field : null;
}

/**
 * O modo lista consegue aplicar um filtro NESTE campo? Campo fora da whitelist
 * é descartado em SILÊNCIO por filterColumn — quem usa a listagem como
 * EVIDÊNCIA de um número agregado (detalhamento da Remuneração,
 * lib/comp/detail.ts) precisa saber disso para avisar, em vez de exibir um
 * recorte mais largo que o do cálculo sem explicação. `unified:` conta como
 * suportado: é expandido por fonte ANTES, no loop de filtros.
 */
export function listFilterFieldSupported(field: string): boolean {
  if (field.startsWith("unified:")) return true;
  return filterColumn(field) !== null;
}

// Condição de UMA coluna na sintaxe de `.or()` do PostgREST para um operador do
// widget; null = operador sem tradução (filtro ignorado). Valores são
// higienizados p/ a sintaxe (sem vírgula/parênteses), como na busca textual.
function postgrestCond(col: string, op: string, value: unknown): string | null {
  const safe = (v: unknown) => String(v ?? "").replace(/[,()]/g, " ").trim();
  switch (op) {
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return `${col}.${op}.${safe(value)}`;
    case "in": {
      const list = (Array.isArray(value) ? value : [value]).map(safe).join(",");
      return `${col}.in.(${list})`;
    }
    case "is_null":
      return `${col}.is.null`;
    case "not_null":
      return `${col}.not.is.null`;
    default:
      return null;
  }
}

/**
 * Pipeline de filtros efetivos do modo lista + regra dos mocks (0052) — o
 * ÚNICO ponto client-side que decide se uma config "referencia Data Reunião"
 * (paridade com o RPC; ver ./mock-reuniao). Compartilhado por
 * buildRecordListQuery e recordListIncludesMocks — não duplique esta decisão.
 */
function resolveListFilters(
  config: WidgetConfig,
  period: DashboardPeriod | null | undefined,
  available: AvailableField[],
  catalog: SourceDef[]
) {
  // SUB-FONTES: fontes efetivas da consulta (uma por record_type). Ativa só
  // quando há sub selecionada — senão usa config.sources cru (legado).
  const involvesSub =
    catalog.some((s) => s.parentKey) &&
    (config.sources ?? []).some((s) => isSubSource(s, catalog));
  const plan = planSourceLegs(config.sources, config.settings?.coexistSubSources, catalog);
  const effSources = involvesSub
    ? plan.allMain
      ? undefined
      : plan.mainSources
    : config.sources;

  // Segmentação por fonte antes dos filtros sintéticos (mesma ordem do engine).
  let filters = applyFilterSourceTargets(
    resolveFilters(config.filters ?? []),
    effSources,
    catalog
  );
  if (period) filters = applyPeriodToFilters(filters, period, effSources, catalog);
  filters = [...sourceFilters(effSources, catalog), ...filters];

  // Fase 12: leads MOCK de "Data Reunião" (records.is_mock) só são servidos
  // quando o widget referencia o campo (regra do RPC run_widget_query,
  // 0052/0054/0057 — ver ./mock-reuniao). As partes inspecionadas espelham o
  // que o RPC "veria" em cada caminho: no modo lista, filtros (inclui o byType
  // do @period) + colunas; no caminho agregado "Agrupar período" (chamado por
  // runWidgetByPeriod), filtros + dimensões + métricas — é aqui que "Data
  // Reunião" como dimensão de data passa a ligar os mocks.
  const refParts =
    config.settings?.rowMode === "records"
      ? [filters, config.settings?.columns ?? []]
      : [filters, config.dimensions ?? [], config.metrics ?? []];
  const includeMocks = includesMockReuniaoRef(refParts, available);
  return { filters, includeMocks };
}

/**
 * Regra dos mocks (0052) de uma config de modo lista SEM executar a consulta:
 * true = o fetch serviria os mocks de Data Reunião. Usada nos gates do top-up
 * das pernas cobertas (runCoveredLegMockTopUp).
 */
export function recordListIncludesMocks(
  config: WidgetConfig,
  period: DashboardPeriod | null | undefined,
  available: AvailableField[],
  catalog: SourceDef[] = BUILTIN_SOURCES
): boolean {
  return resolveListFilters(config, period, available, catalog).includeMocks;
}

/**
 * Constrói a consulta de registros de um widget em modo lista (fontes/período/
 * filtros — mesma semântica de runWidget) SEM executá-la. Compartilhado por
 * runRecordList (conjunto completo) e runRecordListPage (página + count).
 */
function buildRecordListQuery(
  supabase: SupabaseClient,
  config: WidgetConfig,
  period: DashboardPeriod | null | undefined,
  // Catálogo de campos: usado só p/ resolver filtros unified:* (membros por
  // record_type). Ausente = filtros unificados são ignorados (compat).
  available: AvailableField[],
  // onlyMocks: SÓ is_mock=true (top-up das pernas cobertas) — o chamador
  // (runCoveredLegMockTopUp) garante que a config referencia Data Reunião.
  // orgId: escopo explícito de org (chamadores service-role — v2.1).
  opts?: { count?: boolean; onlyMocks?: boolean; orgId?: string },
  // Catálogo de FONTES (0078): resolve a fonte efetiva por record_type (subs
  // absorvidas somem; sub avulsa recorta as linhas da pai). Ausente = builtins
  // (sem sub-fontes → comportamento legado idêntico).
  catalog: SourceDef[] = BUILTIN_SOURCES
) {
  const { filters, includeMocks } = resolveListFilters(
    config,
    period,
    available,
    catalog
  );

  const unifiedMembersOf = (field: string) =>
    available.find((a) => a.field === field)?.unifiedMembers;

  // Filtro rápido por bucket de data (`@bucket`, quick-filters): o PostgREST
  // não sabe bucketizar, então esses filtros saem da consulta e são aplicados
  // DEPOIS do fetch (pós-filtro em JS com a mesma chave canônica do RPC) —
  // inclusive sobre match:%, que só existe após attachMatches.
  const bucketFilters: BucketFilterValue[] = [];

  // Segmentação por fonte (pass-through), espelho do wrapper do RPC (0054):
  // `(record_type not in (alvos)) OR (<condição>)` — linhas de fontes fora do
  // alvo passam sem restrição. Chamadas `.or()` separadas são ANDadas entre si
  // pelo PostgREST (mesmo padrão dos ramos @period/unified: abaixo).
  const rtsOf = (f: WidgetFilter) =>
    f.record_types && f.record_types.length > 0 ? f.record_types : null;
  const passThrough = (rts: string[]) => `record_type.not.in.(${rts.join(",")})`;

  // Filtros primeiro (FilterBuilder), depois order/limit (TransformBuilder).
  let q = supabase
    .from("records")
    .select(RECORD_COLS, opts?.count ? { count: "exact" } : undefined);
  // Lixeira (0121): soft delete fora de TODO modo lista/kanban/agenda/card.
  // No viewer de snapshot o predicado é no-op (snapshot_records.deleted_at é
  // o espelho morto sempre-null da 0121).
  q = q.is("deleted_at", null);
  if (opts?.orgId) q = q.eq("organization_id", opts.orgId);
  if (opts?.onlyMocks) q = q.eq("is_mock", true);
  else if (!includeMocks) q = q.eq("is_mock", false);
  for (const f of filters as WidgetFilter[]) {
    if (f.field === BUCKET_FIELD_SENTINEL) {
      const bf = bucketFilterValue(f);
      if (bf && bf.keys.length > 0) bucketFilters.push(bf);
      continue;
    }
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
        // Coluna do núcleo (timestamptz): bound ancorado no dia de Brasília
        // (0085) — sem offset o PostgREST casta o literal em UTC e desloca o
        // limite do dia em 3h. Custom (texto): bounds naive verbatim.
        const core = CORE_DATE_COLS.has(dateCol);
        const conds = [`record_type.eq.${rt}`];
        if (col && v.from)
          conds.push(
            `${col}.gte.${core ? anchorCoreDateBound(v.from, "from") : v.from}`
          );
        if (col && v.to)
          conds.push(
            `${col}.lte.${core ? anchorCoreDateBound(v.to, "to") : v.to}`
          );
        groups.push(`and(${conds.join(",")})`);
      }
      // ignore_period (0116): espelho do wrapper do RPC — record_types no
      // sentinela = record_types que RESPEITAM o período; os demais (fontes
      // isentas) passam sem recorte de data.
      const prts = rtsOf(f);
      if (prts) groups.push(passThrough(prts));
      if (groups.length > 0) q = q.or(groups.join(","));
      continue;
    }
    // Busca textual (ilike): o field pode unir vários campos com '|' → OR entre
    // colunas. O valor é o termo cru; aqui envolvemos com curingas.
    if (f.op === "ilike") {
      const term = String(f.value ?? "").trim();
      if (!term) continue;
      // unified:* expande nos membros (a busca vale em qualquer fonte; colunas
      // de outra fonte simplesmente não casam).
      const cols = [
        ...new Set(
          f.field
            .split(SEARCH_FIELD_SEP)
            .flatMap((sub) =>
              sub.startsWith("unified:")
                ? Object.values(unifiedMembersOf(sub) ?? {})
                : [sub]
            )
            .map(filterColumn)
            .filter((c): c is string => Boolean(c))
        ),
      ];
      if (cols.length === 0) continue;
      // Curingas/valor seguros para a sintaxe de .or() do PostgREST (sem vírgula/parênteses).
      const safe = term.replace(/[,()]/g, " ").trim();
      const rts = rtsOf(f);
      if (rts) {
        // OR associativo: (rt∉alvos) or col1 or col2 ≡ (rt∉alvos or (col1 or col2)).
        q = q.or(
          [passThrough(rts), ...cols.map((c) => `${c}.ilike.*${safe}*`)].join(",")
        );
      } else if (cols.length === 1) {
        q = q.ilike(cols[0], `%${safe}%`);
      } else {
        q = q.or(cols.map((c) => `${c}.ilike.*${safe}*`).join(","));
      }
      continue;
    }
    // Filtro sobre campo unificado: OR por fonte — cada record_type filtra pela
    // coluna do SEU membro (espelha o coalesce do RPC). Fonte sem membro fica
    // fora do OR (não casa o filtro); sem membros conhecidos, ignora (compat).
    if (f.field.startsWith("unified:")) {
      const members = unifiedMembersOf(f.field);
      if (!members) continue;
      const rts = rtsOf(f);
      const groups: string[] = [];
      for (const [rt, ref] of Object.entries(members)) {
        // Com alvo, só as fontes-alvo entram no OR; as demais caem no
        // pass-through. Fonte-alvo SEM membro fica sem grupo e sem pass-through
        // → excluída (espelha o coalesce(...)≈NULL do RPC).
        if (rts && !rts.includes(rt)) continue;
        const memberCol = filterColumn(ref);
        if (!memberCol) continue;
        const cond = postgrestCond(memberCol, f.op, f.value);
        if (cond) groups.push(`and(record_type.eq.${rt},${cond})`);
      }
      if (rts) groups.unshift(passThrough(rts));
      if (groups.length > 0) q = q.or(groups.join(","));
      continue;
    }
    const col = filterColumn(f.field);
    if (!col) continue;
    {
      // Filtro simples com alvo: vira `.or(pass-through, condição)`. Limitação
      // herdada da sintaxe de .or(): o valor é higienizado (vírgula/parênteses
      // viram espaço), como no ramo unificado acima.
      const rts = rtsOf(f);
      if (rts) {
        const cond = postgrestCond(col, f.op, f.value);
        if (cond) q = q.or(`${passThrough(rts)},${cond}`);
        continue;
      }
    }
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

  // Pós-filtro dos buckets (AND entre filtros): roda após attachMatches para
  // os campos match:% terem o registro casado resolvido.
  const applyBucketFilters = (rs: RecordRow[]): RecordRow[] =>
    bucketFilters.length === 0
      ? rs
      : rs.filter((r) =>
          bucketFilters.every((bf) => matchesBucketFilter(r, bf, available))
        );

  return { q, hasBucketFilters: bucketFilters.length > 0, applyBucketFilters };
}

// Busca paginada p/ driblar o teto server-side do PostgREST ("Max Rows"), que
// trunca respostas sem .range() (ex.: 100 ou 1000 linhas). Avança pelo total
// REALMENTE lido (não por um passo fixo) e para só quando o lote vem vazio —
// assim funciona seja o cap 100, 1000 ou qualquer outro, mesmo < BATCH.
async function fetchAll(
  tq: ReturnType<typeof buildRecordListQuery>["q"]
): Promise<RecordRow[]> {
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

/**
 * Agrupamento de responsáveis (0101): expande filtros responsible_id da config
 * para o grupo ANTES de montar a query. Gate barato (sem referência → mesma
 * config, nenhuma consulta extra); a regra dos mocks não muda — a expansão não
 * toca refs de Data Reunião (recordListIncludesMocks segue com a config crua).
 * Filtro por NOME em relação (31/07/2026): resolvido ANTES da expansão
 * (nome → id principal → grupo) — mesmo choke point p/ lista/kanban/export.
 */
async function expandConfigResponsibles(
  supabase: SupabaseClient,
  config: WidgetConfig
): Promise<WidgetConfig> {
  const named = await resolveFkFilterNames(supabase, config.filters ?? []);
  let filters = named;
  if (filtersReferenceResponsible(named)) {
    const canon = await loadResponsibleCanon(supabase);
    filters = expandResponsibleFilters(named, canon);
  }
  return filters === config.filters ? config : { ...config, filters };
}

/**
 * Lista os registros de um widget de Tabela em modo "registros individuais",
 * aplicando fontes/período/filtros do widget (mesma semântica de runWidget).
 */
export async function runRecordList(
  supabase: SupabaseClient,
  config: WidgetConfig,
  period?: DashboardPeriod | null,
  available: AvailableField[] = [],
  catalog: SourceDef[] = BUILTIN_SOURCES,
  opts?: { onlyMocks?: boolean; orgId?: string }
): Promise<RecordRow[]> {
  config = await expandConfigResponsibles(supabase, config);
  const { q, applyBucketFilters } = buildRecordListQuery(
    supabase,
    config,
    period,
    available,
    opts,
    catalog
  );

  // Sem limite por padrão (o usuário pediu p/ remover o teto); só aplica quando
  // o widget define settings.limit explicitamente.
  const tq = q.order("source_created_at", { ascending: false, nullsFirst: false });
  const limit = config.settings?.limit;
  if (typeof limit === "number" && limit > 0) {
    const { data, error } = await tq.limit(limit);
    if (error) throw new Error(error.message);
    const records = (data ?? []) as unknown as RecordRow[];
    await attachMatches(supabase, records);
    return applyBucketFilters(records);
  }

  const all = await fetchAll(tq);
  await attachMatches(supabase, all);
  return applyBucketFilters(all);
}

// ===================== Janela incremental do full fetch =====================

/** Teto default de linhas por carga do modo lista full-fetch. */
export const RECORD_LIST_WINDOW_DEFAULT = 1000;

/**
 * Tamanho da janela do full fetch — env RECORD_LIST_WINDOW (0 = sem teto,
 * comportamento antigo; ausente = 1000).
 */
export function recordListWindowSize(): number {
  const raw = process.env.RECORD_LIST_WINDOW;
  if (raw == null || raw === "") return RECORD_LIST_WINDOW_DEFAULT;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0
    ? Math.floor(n)
    : RECORD_LIST_WINDOW_DEFAULT;
}

/**
 * Uma JANELA do conjunto do modo lista (offset + teto) com count exato do
 * recorte — mesma consulta de runRecordList, paginada. Desempate estável por
 * `id` (como runRecordListPage): janelas subsequentes continuam do offset sem
 * repetir/perder linha. Filtros @bucket são pós-fetch: offset/count do
 * servidor não valem — cai no conjunto completo e devolve windowed=false (o
 * chamador não oferece "Carregar mais").
 */
export async function runRecordListWindow(
  supabase: SupabaseClient,
  config: WidgetConfig,
  period: DashboardPeriod | null | undefined,
  available: AvailableField[],
  catalog: SourceDef[] = BUILTIN_SOURCES,
  opts: { offset: number; maxRows: number } = {
    offset: 0,
    maxRows: RECORD_LIST_WINDOW_DEFAULT,
  }
): Promise<{ rows: RecordRow[]; total: number; windowed: boolean }> {
  config = await expandConfigResponsibles(supabase, config);
  const { q, hasBucketFilters, applyBucketFilters } = buildRecordListQuery(
    supabase,
    config,
    period,
    available,
    { count: true },
    catalog
  );
  const ordered = q
    .order("source_created_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true });

  if (hasBucketFilters) {
    const all = await fetchAll(ordered);
    await attachMatches(supabase, all);
    const filtered = applyBucketFilters(all);
    return { rows: filtered, total: filtered.length, windowed: false };
  }

  const { data, error, count } = await ordered.range(
    Math.max(0, opts.offset),
    Math.max(0, opts.offset) + opts.maxRows - 1
  );
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as RecordRow[];
  await attachMatches(supabase, rows);
  return { rows, total: count ?? opts.offset + rows.length, windowed: true };
}

/**
 * TOP-UP de mocks das pernas COBERTAS (fontes da métrica dentro das do widget,
 * inclusive widget em "todas as fontes"): pernas cobertas reusam os registros
 * de EXIBIÇÃO, cuja regra dos mocks nunca inspeciona as métricas das pernas
 * (paridade com o RPC) — sem isto, mocks de Data Reunião somem da basis. Busca
 * SÓ is_mock=true com o mesmo pipeline (topUpConfig = a config do fetch extra
 * do chamador, com as fontes cobertas) quando:
 *  (a) a config das pernas referenciaria Data Reunião (0052) — inspeção em
 *      CONJUNTO das métricas das pernas, a mesma aproximação do fetch extra; e
 *  (b) a config de EXIBIÇÃO não referenciou — senão os mocks já estão nos
 *      registros de exibição e duplicariam.
 * Mocks seguem sem virar linha: entram só pelos streams de extras.
 */
export async function runCoveredLegMockTopUp(
  supabase: SupabaseClient,
  displayConfig: WidgetConfig,
  topUpConfig: WidgetConfig,
  period: DashboardPeriod | null | undefined,
  available: AvailableField[],
  catalog: SourceDef[] = BUILTIN_SOURCES
): Promise<RecordRow[]> {
  if (!topUpConfig.sources || topUpConfig.sources.length === 0) return [];
  if (!recordListIncludesMocks(topUpConfig, period, available, catalog))
    return [];
  if (recordListIncludesMocks(displayConfig, period, available, catalog))
    return [];
  return runRecordList(supabase, topUpConfig, period, available, catalog, {
    onlyMocks: true,
  });
}

/**
 * Mescla extras + top-up sem duplicar por id: com sub-fontes, fontes distintas
 * compartilham record_type e um mock poderia vir nos dois fetches.
 */
export function dedupeById(a: RecordRow[], b: RecordRow[]): RecordRow[] {
  if (b.length === 0) return a;
  const seen = new Set(a.map((r) => r.id));
  return [...a, ...b.filter((r) => !seen.has(r.id))];
}

/**
 * runRecordList + registros EXTRAS das fontes das pernas (Metric.sources):
 * o conjunto de exibição fica INTACTO (fontes do widget, mesma regra dos
 * mocks de sempre — filtros + colunas); `extra` traz os registros das fontes
 * das métricas que o widget não cobre, para os subtotais/Total geral do
 * cliente comporem a basis das métricas com fontes próprias. O fetch extra
 * remove rowMode/columns/limit: sem rowMode, a regra dos mocks inspeciona
 * filtros + dimensões + MÉTRICAS (as das pernas) — mocks de Data Reunião
 * entram na basis sem nunca virar linha. Fontes de perna já cobertas pelo
 * widget reusam os registros de exibição (o cliente filtra por record_type ao
 * compor o escopo) e recebem só o top-up de mocks (runCoveredLegMockTopUp),
 * mesclado em `extra`.
 */
export async function runRecordListWithExtras(
  supabase: SupabaseClient,
  config: WidgetConfig,
  period?: DashboardPeriod | null,
  available: AvailableField[] = [],
  catalog: SourceDef[] = BUILTIN_SOURCES,
  // Defs de campo p/ as pernas enxergarem operandos com escopo (`agg:…@<fonte>`)
  // em fórmulas de 'calculado_agg' salvas (metricScopedSources).
  fields: FieldDefinition[] = [],
  // Janela incremental (v2.0): teto da 1ª carga do full fetch. Só se aplica
  // sem pernas de Metric.sources (a basis dos subtotais precisa do conjunto
  // completo) e sem settings.limit. `total` volta APENAS quando a janela foi
  // aplicada (count exato do recorte; o chamador compara com records.length).
  windowOpts?: { maxRows: number } | null
): Promise<{ records: RecordRow[]; extra: RecordRow[]; total?: number }> {
  // Linhas core (0086) fora: refs custom:<key> nunca apontam p/ coluna núcleo.
  const fieldByKey = new Map(
    fields.filter((f) => !isCoreDef(f)).map((f) => [f.field_key, f])
  );
  const { legs } = partitionMetricLegs(
    config.metrics ?? [],
    config.sources,
    fieldByKey
  );
  const hasLimit =
    typeof config.settings?.limit === "number" && config.settings.limit > 0;
  if (windowOpts && windowOpts.maxRows > 0 && legs.length === 0 && !hasLimit) {
    const { rows, total, windowed } = await runRecordListWindow(
      supabase,
      config,
      period,
      available,
      catalog,
      { offset: 0, maxRows: windowOpts.maxRows }
    );
    return { records: rows, extra: [], total: windowed ? total : undefined };
  }
  const extraSources =
    config.sources && config.sources.length > 0
      ? [...new Set(legs.flatMap((l) => l.sources))].filter(
          (s) => !config.sources!.includes(s)
        )
      : [];
  const covered = coveredLegSources(legs, config.sources);
  // Config dos fetches auxiliares: sem rowMode/columns a regra dos mocks
  // inspeciona filtros + dimensões + MÉTRICAS (as das pernas).
  const auxConfig = (sources: typeof extraSources): WidgetConfig => ({
    ...config,
    sources,
    dimensions: [],
    metrics: legs.flatMap((l) => l.idx.map((i) => config.metrics[i])),
    settings: {
      ...config.settings,
      rowMode: undefined,
      columns: undefined,
      limit: undefined,
    },
  });
  const [records, extra, topUp] = await Promise.all([
    runRecordList(supabase, config, period, available, catalog),
    extraSources.length > 0
      ? runRecordList(supabase, auxConfig(extraSources), period, available, catalog)
      : Promise.resolve([] as RecordRow[]),
    covered.length > 0
      ? runCoveredLegMockTopUp(
          supabase,
          config,
          auxConfig(covered),
          period,
          available,
          catalog
        )
      : Promise.resolve([] as RecordRow[]),
  ]);
  return { records, extra: dedupeById(extra, topUp) };
}

/**
 * Versão PAGINADA de runRecordList (widgets elegíveis — serverPaginatedList):
 * busca só a página pedida com count exato e ordenação no servidor (a
 * ordenação vem de settings.appearance.table.sort quando traduzível; default =
 * source_created_at desc, como sempre; `id` como desempate estável entre
 * páginas). Filtros @bucket são pós-fetch: nesse caso cai no conjunto completo
 * e pagina APÓS o pós-filtro (total correto, menos dados ao cliente).
 */
export async function runRecordListPage(
  supabase: SupabaseClient,
  config: WidgetConfig,
  period: DashboardPeriod | null | undefined,
  available: AvailableField[],
  opts: { pageIndex: number; pageSize: number },
  catalog: SourceDef[] = BUILTIN_SOURCES
): Promise<{ rows: RecordRow[]; total: number }> {
  config = await expandConfigResponsibles(supabase, config);
  const { q, hasBucketFilters, applyBucketFilters } = buildRecordListQuery(
    supabase,
    config,
    period,
    available,
    { count: true },
    catalog
  );
  const sort = config.settings?.appearance?.table?.sort;
  const sortable =
    sort?.column && (sort.dir === "asc" || sort.dir === "desc") ? sort : null;
  // Espelha o sort do cliente: null/vazio primeiro no asc (String(v ?? "")).
  const ordered = (
    sortable
      ? q.order(sortable.column, {
          ascending: sortable.dir === "asc",
          nullsFirst: sortable.dir === "asc",
        })
      : q.order("source_created_at", { ascending: false, nullsFirst: false })
  ).order("id", { ascending: true });

  const start = Math.max(0, opts.pageIndex) * opts.pageSize;

  if (hasBucketFilters) {
    const all = await fetchAll(ordered);
    await attachMatches(supabase, all);
    const filtered = applyBucketFilters(all);
    return {
      rows: filtered.slice(start, start + opts.pageSize),
      total: filtered.length,
    };
  }

  const { data, error, count } = await ordered.range(
    start,
    start + opts.pageSize - 1
  );
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as RecordRow[];
  await attachMatches(supabase, rows);
  return { rows, total: count ?? rows.length };
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
  // Chunks em PARALELO (antes eram awaits seriais: ~2×N/200 round-trips em
  // sequência numa lista grande — custo real de latência no load). A ordem de
  // chegada não importa: o melhor match por fonte é escolhido por `rank`.
  const CHUNK = 200;
  const chunksOf = (list: string[]): string[][] => {
    const out: string[][] = [];
    for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
    return out;
  };
  const matches: MatchRow[] = (
    await Promise.all(
      chunksOf(ids).map(async (slice) => {
        const { data } = await supabase
          .from("record_matches")
          .select("record_a_id, record_b_id, mode, created_at")
          .or(
            `record_a_id.in.(${slice.join(",")}),record_b_id.in.(${slice.join(",")})`
          );
        return (data ?? []) as MatchRow[];
      })
    )
  ).flat();

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
  const partnerChunks = await Promise.all(
    chunksOf([...wanted]).map(async (slice) => {
      const { data } = await supabase
        .from("records")
        .select(RECORD_COLS)
        .in("id", slice);
      return (data ?? []) as unknown as RecordRow[];
    })
  );
  for (const chunk of partnerChunks) {
    for (const p of chunk) partnerById.set(p.id, p);
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
      const src = toSourceKey(partner.record_type);
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
