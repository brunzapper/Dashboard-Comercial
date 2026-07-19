// Versão: 2.0 | Data: 09/07/2026
// Filtro de período dos dashboards: presets relativos (resolvidos no momento da
// consulta) + intervalo personalizado. Usado em dois lugares:
//  - barra global (searchParams periodo/de/ate/campo);
//  - widget de filtro, com escopo por widget (searchParams pf_<id>/pfd_<id>/
//    pfa_<id>, campo fixo em settings).
// A seleção (URL) cai para um default (config do dashboard/widget) quando
// ausente; o sentinel "all" representa "todo o período" explícito (sobrepõe o
// default). Ao aplicar aos filtros de um widget, substitui os filtros de data
// do próprio widget no mesmo campo.
import type { WidgetFilter } from "./types";
import type { Correspondence } from "@/lib/correspondences";
import {
  BUILTIN_SOURCES,
  recordTypeOf,
  SOURCE_KEYS,
  type SourceDef,
  type SourceKey,
} from "@/lib/sources";

export const PERIOD_PRESETS = {
  hoje: "Hoje",
  ultimos_7: "Últimos 7 dias",
  ultimos_30: "Últimos 30 dias",
  ultimos_90: "Últimos 90 dias",
  esta_semana: "Esta semana",
  semana_passada: "Semana passada",
  este_mes: "Este mês",
  mes_passado: "Mês passado",
  este_trimestre: "Este trimestre",
  este_ano: "Este ano",
  ano_passado: "Ano passado",
} as const;

export type PeriodPresetKey = keyof typeof PERIOD_PRESETS;

export const DEFAULT_PERIOD_FIELD = "closed_at";

// Sentinel de "todo o período" explícito (sobrepõe o default configurado).
export const PERIOD_ALL = "all";

/** Período ativo do dashboard, já resolvido para datas ISO (YYYY-MM-DD). */
export interface DashboardPeriod {
  field: string; // campo PRIMÁRIO (visível/selecionável): 'closed_at' | 'opened_at' | …
  from: string | null;
  to: string | null;
  // Preset de origem (quando a seleção veio de um preset): permite deslocar o
  // período SEMANTICAMENTE na comparação (este_mes → mês anterior cheio, e não
  // "mesma duração em dias"). Ausente = intervalo personalizado.
  preset?: PeriodPresetKey;
  // Campo de data por fonte (já resolvido, com defaults). Quando presente, o
  // período filtra CADA fonte pela sua coluna de data — ex.: negócios por
  // `closed_at` e Estudo por `source_created_at` na mesma seleção. Ausente =
  // usa `field` para todas as fontes (comportamento retrocompatível, também
  // usado quando o usuário troca o campo direto na barra).
  fieldBySource?: Partial<Record<SourceKey, string>>;
}

/** Uma seleção de período crua (vinda da URL ou de um default). */
export interface PeriodSelection {
  preset?: string; // chave de PERIOD_PRESETS, PERIOD_ALL, ou ""
  de?: string;
  ate?: string;
}

/** Último período consultado, salvo por usuário/dashboard (inclui o campo). */
export interface SavedPeriod {
  periodo?: string;
  de?: string;
  ate?: string;
  campo?: string;
}

/** Escopo do filtro de período do dashboard (config em periodBar.scope). */
export type PeriodScope = "global" | "tab";

/**
 * Nomes dos parâmetros de URL da barra de período, conforme o escopo. Escopo
 * "global" (ou aba vazia) usa as chaves fixas `periodo/de/ate/campo`
 * (retrocompatível); "tab" as namespaceia por id da aba (`periodo__<tabId>`…).
 * Fonte única da convenção, usada por cliente e servidor.
 */
export function periodKeys(scope: PeriodScope | undefined, tabId: string) {
  const suffix = scope === "tab" && tabId ? `__${tabId}` : "";
  return {
    preset: `periodo${suffix}`,
    de: `de${suffix}`,
    ate: `ate${suffix}`,
    campo: `campo${suffix}`,
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function presetRange(
  preset: PeriodPresetKey,
  now = new Date()
): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const dow = now.getDay(); // 0=domingo
  const mondayOffset = (dow + 6) % 7; // dias desde a última segunda
  switch (preset) {
    case "hoje":
      return { from: iso(now), to: iso(now) };
    case "ultimos_7":
      return { from: iso(new Date(y, m, d - 6)), to: iso(now) };
    case "ultimos_30":
      return { from: iso(new Date(y, m, d - 29)), to: iso(now) };
    case "ultimos_90":
      return { from: iso(new Date(y, m, d - 89)), to: iso(now) };
    case "esta_semana":
      return {
        from: iso(new Date(y, m, d - mondayOffset)),
        to: iso(new Date(y, m, d - mondayOffset + 6)),
      };
    case "semana_passada":
      return {
        from: iso(new Date(y, m, d - mondayOffset - 7)),
        to: iso(new Date(y, m, d - mondayOffset - 1)),
      };
    case "este_mes":
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case "mes_passado":
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "este_trimestre": {
      const q = Math.floor(m / 3) * 3;
      return { from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) };
    }
    case "este_ano":
      return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
    case "ano_passado":
      return {
        from: iso(new Date(y - 1, 0, 1)),
        to: iso(new Date(y - 1, 11, 31)),
      };
  }
}

/** Uma seleção tem algum valor efetivo (preset ou datas)? */
export function hasSelection(sel: PeriodSelection): boolean {
  return Boolean(sel.preset || sel.de || sel.ate);
}

/**
 * Resolve uma seleção (URL) para um período concreto. Cai para `defaults`
 * quando a seleção está vazia. Preset tem prioridade sobre de/ate. O sentinel
 * PERIOD_ALL (ou nenhum valor sem default) resulta em `null` (sem filtro).
 */
export function resolvePeriodSelection(
  sel: PeriodSelection,
  field: string,
  defaults?: PeriodSelection
): DashboardPeriod | null {
  const eff = hasSelection(sel) ? sel : (defaults ?? {});
  const preset = eff.preset ?? "";
  if (preset === PERIOD_ALL) return null;
  if (preset in PERIOD_PRESETS) {
    const { from, to } = presetRange(preset as PeriodPresetKey);
    return { field, from, to, preset: preset as PeriodPresetKey };
  }
  const de = eff.de && DATE_RE.test(eff.de) ? eff.de : null;
  const ate = eff.ate && DATE_RE.test(eff.ate) ? eff.ate : null;
  if (!de && !ate) return null;
  return { field, from: de, to: ate };
}

// Operadores que delimitam o período dentro dos filtros do widget — são os
// que o filtro (global ou por widget) substitui quando atua sobre o mesmo
// campo.
const RANGE_OPS = new Set(["eq", "gt", "gte", "lt", "lte"]);

// Campo sintético do filtro de período por fonte: o valor carrega os limites e o
// mapa record_type → coluna de data. Resolvido pelo RPC (run_widget_query, ramo
// '@period'/'between') e pelo modo lista (record-list.ts, via PostgREST .or()).
export const PERIOD_FIELD_SENTINEL = "@period";

/** Valor do filtro sintético `@period`: limites + coluna de data por record_type. */
export interface PeriodBetweenValue {
  from: string | null;
  to: string | null; // já com o limite superior inclusivo do dia (…T23:59:59)
  byType: Record<string, string>; // record_type → coluna de data
}

/**
 * Resolve um campo de período para o ref CONCRETO de uma fonte:
 * 'unified:<k>' → field_ref do membro cujo record_type é o da fonte (null se a
 * correspondência não tem membro para ela); demais campos voltam como estão.
 * O RPC/modo lista só entendem coluna do núcleo ou custom:<k> no `@period`,
 * então o unificado precisa ser desdobrado por fonte ANTES de chegar lá.
 */
export function resolveUnifiedPeriodField(
  field: string,
  source: SourceKey,
  correspondences: Correspondence[]
): string | null {
  if (!field.startsWith("unified:")) return field;
  const key = field.slice("unified:".length);
  // Casa pela SOURCE-KEY (0077): uma sub-fonte tem membro próprio, distinto do
  // da pai, ainda que compartilhem o record_type (ex.: Leads→reunião,
  // Leads/Clientes Lite→mudança de etapa).
  const member = correspondences
    .find((c) => c.key === key)
    ?.members.find((m) => m.source_key === source);
  return member?.field_ref || null;
}

/** Coluna de data que uma fonte usa no período (override por fonte → primário). */
export function periodFieldForSource(
  period: DashboardPeriod,
  source: SourceKey
): string {
  return period.fieldBySource?.[source] ?? period.field;
}

// Fontes cobertas por um widget: as selecionadas; vazio = todas. "Todas" =
// builtins ∪ chaves do mapa por fonte do período — o resolver
// (period-resolve) monta fieldBySource a partir do CATÁLOGO, então as fontes
// dinâmicas chegam aqui por ele, sem precisar passar o catálogo pelo engine.
// SUB-FONTES (0077): em "todas as fontes" cobrimos só as RAIZ — subs
// compartilham o record_type da pai, então incluí-las sobrescreveria o `byType`
// da pai (mesma chave record_type). Subs só entram quando explicitamente
// selecionadas (a lista `sources` já vem resolvida pelo engine nesse caso).
function coveredSources(
  sources: SourceKey[] | undefined,
  fieldBySource: Partial<Record<SourceKey, string>> | undefined,
  catalog: SourceDef[]
): SourceKey[] {
  if (sources && sources.length > 0) return sources;
  const isSub = (k: string) =>
    Boolean(catalog.find((s) => s.key === k)?.parentKey);
  const rootMapKeys = Object.keys(fieldBySource ?? {}).filter((k) => !isSub(k));
  const catalogRoots = catalog.filter((s) => !s.parentKey).map((s) => s.key);
  // SOURCE_KEYS (builtins) são sempre raiz; une com as raiz do catálogo e as
  // chaves-raiz do mapa por fonte (fontes dinâmicas).
  return [...new Set([...SOURCE_KEYS, ...catalogRoots, ...rootMapKeys])];
}

/**
 * Aplica o período aos filtros de um widget. Sem mapa por fonte (ou quando todas
 * as fontes cobertas resolvem para o MESMO campo), remove os intervalos do widget
 * sobre esse campo e anexa os limites — comportamento retrocompatível, sem exigir
 * a migração do RPC. Quando as fontes cobertas usam campos DIFERENTES (ex.: split
 * negócios+Estudo), empurra um filtro sintético `@period` que o RPC/modo lista
 * expandem num OR por record_type. O limite superior inclui o dia inteiro.
 */
export function applyPeriodToFilters(
  filters: WidgetFilter[],
  period: DashboardPeriod,
  sources?: SourceKey[],
  catalog: SourceDef[] = BUILTIN_SOURCES
): WidgetFilter[] {
  const to = period.to ? `${period.to}T23:59:59` : null;

  // Mapa por fonte → campo de data das fontes cobertas por este widget.
  // record_type ciente do catálogo (sub-fonte → record_type da pai).
  const covered = coveredSources(sources, period.fieldBySource, catalog);
  const byType: Record<string, string> = {};
  const distinct = new Set<string>();
  for (const s of covered) {
    const col = periodFieldForSource(period, s);
    byType[recordTypeOf(s, catalog)] = col;
    distinct.add(col);
  }

  // Caminho uniforme: 1 único campo entre as fontes cobertas (ou sem mapa por
  // fonte). Filtro simples de intervalo — não depende da migração 0040.
  if (!period.fieldBySource || distinct.size <= 1) {
    const field = distinct.size === 1 ? [...distinct][0] : period.field;
    const next = filters.filter(
      (f) => !(f.field === field && RANGE_OPS.has(f.op))
    );
    if (period.from) next.push({ field, op: "gte", value: period.from });
    if (to) next.push({ field, op: "lte", value: to });
    return next;
  }

  // Caminho misto: fontes cobertas usam campos diferentes → filtro sintético.
  if (!period.from && !to) return filters;
  const value: PeriodBetweenValue = { from: period.from, to, byType };
  // `between` é um operador interno (não faz parte de FilterOp/da UI); só o RPC
  // e o modo lista o reconhecem para o campo sintético `@period`.
  const synthetic = {
    field: PERIOD_FIELD_SENTINEL,
    op: "between",
    value,
  } as unknown as WidgetFilter;
  return [...filters, synthetic];
}
