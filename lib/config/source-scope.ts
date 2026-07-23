// Versão: 1.0 | Data: 23/07/2026
// Escopo de BASES por board (menu ⋮ → "Bases"): recorta o catálogo de fontes
// EFETIVO de um dashboard/kanban (`DashboardSettings.sourceScope`). O recorte
// vale para as OFERTAS (pickers de base/sub-base dentro do board) e para o
// universo dos widgets em "todas as bases" — mas NUNCA remove uma fonte já
// referenciada pela config de um widget existente (senão widget legado
// quebraria em silêncio). Pais de subs mantidas também ficam (agrupamento na
// UI e resolvers RAIZ-primeiro dos unificados).
//
// Módulo puro/client-safe: usado pelas pages (RSC), pelo widget-scope
// (server actions deferidas — invariante 12) e pelo dialog do kebab (client).
import type { Formula } from "@/lib/records/formulas";
import { expandAggFormula } from "@/lib/records/formula-deps";
import type { FieldDefinition } from "@/lib/records/types";
import type { SourceDef, SourceKey } from "@/lib/sources";
import {
  formulaScopedSources,
  metricScopedSources,
  metricTargetSources,
} from "@/lib/widgets/metric-sources";
import type {
  DashboardSettings,
  Metric,
  Widget,
  WidgetFilter,
  WidgetSettings,
} from "@/lib/widgets/types";

/** Shape persistido em DashboardSettings.sourceScope. */
export interface SourceScope {
  keys: SourceKey[];
}

// Subconjunto de Widget que o coletor consome (as pages têm Widget completo;
// o widget-scope carrega colunas equivalentes).
export type ScopeWidgetLike = Pick<Widget, "sources" | "metrics" | "filters"> & {
  settings?: WidgetSettings;
};

function addAll(out: Set<SourceKey>, keys: Iterable<SourceKey> | undefined) {
  for (const k of keys ?? []) {
    if (typeof k === "string" && k.trim() !== "") out.add(k);
  }
}

function addMetric(
  out: Set<SourceKey>,
  m: Metric | undefined,
  fieldByKey?: Map<string, FieldDefinition>
) {
  if (!m) return;
  addAll(out, metricTargetSources(m));
  addAll(out, metricScopedSources(m, fieldByKey));
}

// Fórmula solta (calculado/card/calculadora/nota): escopos `agg:…@<fonte>`,
// expandindo refs de campos 'calculado_agg' salvos (mesmo trato do
// metricScopedSources).
function addFormula(
  out: Set<SourceKey>,
  formula: Formula | null | undefined,
  fieldByKey?: Map<string, FieldDefinition>
) {
  if (!formula || formula.tokens.length === 0) return;
  const expanded = fieldByKey
    ? expandAggFormula(formula, (k) => fieldByKey.get(k))
    : formula;
  addAll(out, formulaScopedSources(expanded));
}

/**
 * Todas as fontes REFERENCIADAS pela config dos widgets + settings do board.
 * É o conjunto que `applySourceScope` preserva mesmo fora do escopo escolhido.
 */
export function collectBoardSourceKeys(
  widgets: ScopeWidgetLike[],
  dashSettings?: DashboardSettings | null,
  fieldByKey?: Map<string, FieldDefinition>
): Set<SourceKey> {
  const out = new Set<SourceKey>();
  for (const w of widgets) {
    addAll(out, w.sources);
    for (const m of w.metrics ?? []) addMetric(out, m, fieldByKey);
    for (const f of (w.filters ?? []) as WidgetFilter[]) addAll(out, f.sources);
    const s = w.settings;
    if (!s) continue;
    if (s.kanban?.source) out.add(s.kanban.source);
    if (s.agenda?.source) out.add(s.agenda.source);
    addAll(out, s.coexistSubSources);
    // Modo lista: colunas 'unified:' com hierarquia de fontes própria.
    for (const c of s.columns ?? []) addAll(out, c.unifiedSources);
    // Tabela Livre: colunas BI kind="metric".
    for (const c of s.quickTable?.columns ?? []) {
      addMetric(out, c.metric, fieldByKey);
    }
    // Widget "calculado": fórmula local OU campo 'calculado_agg' salvo.
    addFormula(out, s.formula, fieldByKey);
    if (s.calcField?.startsWith("custom:") && fieldByKey) {
      addFormula(out, fieldByKey.get(s.calcField.slice(7))?.formula, fieldByKey);
    }
    addMetric(out, s.card?.metric, fieldByKey);
    addFormula(out, s.card?.formula, fieldByKey);
    for (const v of s.calculator?.variables ?? []) {
      addFormula(out, v.formula, fieldByKey);
    }
    for (const e of s.note?.exprs ?? []) addFormula(out, e, fieldByKey);
  }
  if (dashSettings?.kanban?.source) out.add(dashSettings.kanban.source);
  addAll(
    out,
    Object.keys(dashSettings?.periodBar?.fieldBySource ?? {}) as SourceKey[]
  );
  return out;
}

/**
 * Aplica o escopo de bases ao catálogo: mantém as keys do escopo ∪ as
 * referenciadas ∪ os pais de subs mantidas, preservando a ordem do catálogo.
 * Escopo ausente/vazio = catálogo inteiro (comportamento atual).
 */
export function applySourceScope(
  catalog: SourceDef[],
  scope: SourceScope | undefined | null,
  referenced?: Iterable<SourceKey>
): SourceDef[] {
  const scopeKeys = (scope?.keys ?? []).filter(
    (k): k is SourceKey => typeof k === "string" && k.trim() !== ""
  );
  if (scopeKeys.length === 0) return catalog;
  const keep = new Set<SourceKey>(scopeKeys);
  addAll(keep, referenced);
  // Pais de subs mantidas entram sempre (a sub compartilha o record_type da
  // pai; UI agrupa sob a pai e o coalesce dos unificados é RAIZ-primeiro).
  for (const def of catalog) {
    if (keep.has(def.key) && def.parentKey) keep.add(def.parentKey);
  }
  const kept = catalog.filter((def) => keep.has(def.key));
  // Escopo que não casa com NENHUMA fonte (catálogo mudou/keys órfãs): melhor
  // catálogo inteiro do que board vazio.
  return kept.length > 0 ? kept : catalog;
}

/** Escopo efetivamente configurado? (p/ badges/estado do dialog) */
export function hasSourceScope(
  settings: DashboardSettings | null | undefined
): boolean {
  return (settings?.sourceScope?.keys ?? []).length > 0;
}
