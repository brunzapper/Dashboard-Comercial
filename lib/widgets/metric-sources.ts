// Versão: 1.1 | Data: 19/07/2026
// Fontes por MÉTRICA (`Metric.sources`): uma métrica pode ser calculada sobre
// um conjunto de fontes DIFERENTE do widget (super/subconjunto ou disjunto) —
// ex.: widget com linhas só de Deals e métrica de conversão contando Leads E
// Deals. O universo de LINHAS/registros continua sendo `widgets.sources`; o
// override vale só para o cálculo daquela métrica.
//
// Espelho conceitual de ./filter-sources.ts (fontes-alvo de filtro, 0054): o
// formato persistido é `sources: SourceKey[]` no jsonb `widgets.metrics`, e a
// conversão fonte→record_type acontece no engine (filtro `record_type in`),
// NUNCA no RPC — métricas com fontes próprias viram chamadas RPC separadas
// ("pernas") mescladas por tupla de dimensões (ver lib/widgets/engine.ts).
// Nenhuma migração é necessária; run_widget_query fica intocado.
//
// v1.1 (19/07/2026): operandos com ESCOPO DE FONTE (`agg:…@<fonte>`) contam
// como fonte da métrica para o planejamento: formulaScopedSources/
// metricScopedSources somam o escopo às pernas (metricLegSources) e à
// cobertura do @period (widgetQuerySources) — sem isso, um operando @leads num
// widget só de Deals leria zero em silêncio (invariante 9).
//
// Módulo puro/client-safe: importado pelo engine (server), pelas páginas (RSC)
// e pelos componentes de tabela (client).
import { formulaRefs, type Formula } from "@/lib/records/formulas";
import { expandAggFormula } from "@/lib/records/formula-deps";
import type { FieldDefinition } from "@/lib/records/types";
import type { SourceKey } from "@/lib/sources";
import { parseAggRef } from "./calc-metrics";
import type { Metric } from "./types";

// Fontes-alvo deduplicadas de uma métrica ([] = herda as fontes do widget).
// Mesma higiene de filterTargetSources (qualquer key não-vazia vale — fontes
// dinâmicas; alvo órfão é inofensivo: nenhum record_type casa).
export function metricTargetSources(m: Metric): SourceKey[] {
  return [
    ...new Set(
      (m.sources ?? []).filter(
        (s): s is SourceKey => typeof s === "string" && s.trim() !== ""
      )
    ),
  ];
}

// Chave canônica de um conjunto de fontes (ordem-insensível) — agrupa métricas
// na mesma "perna" de consulta e detecta conjunto idêntico ao do widget.
export function metricSourcesKey(sources: SourceKey[]): string {
  return [...sources].sort().join(",");
}

/** Fontes referenciadas por operandos com escopo (`agg:…@<fonte>`) na fórmula. */
export function formulaScopedSources(
  formula: Formula | null | undefined
): SourceKey[] {
  if (!formula || formula.tokens.length === 0) return [];
  const out = new Set<SourceKey>();
  for (const ref of formulaRefs(formula)) {
    if (!ref.startsWith("agg:")) continue;
    const { source } = parseAggRef(ref);
    if (source) out.add(source);
  }
  return [...out];
}

/**
 * Fontes com escopo de uma MÉTRICA calculada: fórmula ad-hoc (m.formula) ou a
 * do campo 'calculado_agg' salvo (via fieldByKey), expandida
 * (expandAggFormula) para enxergar escopos em fórmulas ANINHADAS. Sem
 * fieldByKey, cobre só a fórmula ad-hoc.
 */
export function metricScopedSources(
  m: Metric,
  fieldByKey?: Map<string, FieldDefinition>
): SourceKey[] {
  let formula: Formula | null | undefined = m.formula;
  if (
    (!formula || formula.tokens.length === 0) &&
    m.field.startsWith("custom:") &&
    fieldByKey
  ) {
    const def = fieldByKey.get(m.field.slice(7));
    formula = def?.data_type === "calculado_agg" ? def.formula : null;
  }
  if (!formula || formula.tokens.length === 0) return [];
  const expanded = fieldByKey
    ? expandAggFormula(formula, (k) => fieldByKey.get(k))
    : formula;
  return formulaScopedSources(expanded);
}

/**
 * Fontes efetivas da PERNA de uma métrica: null = herda (sem alvos, ou o
 * conjunto é idêntico ao do widget — evita uma chamada RPC redundante).
 * Widget em "todas as fontes" (sem seleção) com métrica restrita → perna.
 * Com `fieldByKey` (v1.1), os operandos com escopo (`agg:…@<fonte>`) somam suas
 * fontes ao conjunto — um escopo fora do universo do widget força a perna, para
 * o `record_type in (...)` base não zerar o operando.
 */
export function metricLegSources(
  m: Metric,
  widgetSources?: SourceKey[],
  fieldByKey?: Map<string, FieldDefinition>
): SourceKey[] | null {
  const targets = metricTargetSources(m);
  const scoped = fieldByKey ? metricScopedSources(m, fieldByKey) : [];
  // Base do universo da métrica: alvos explícitos, senão as fontes do widget.
  const base = targets.length > 0 ? targets : (widgetSources ?? []);
  const eff = [...new Set([...base, ...scoped])];
  if (targets.length === 0 && (!widgetSources || widgetSources.length === 0)) {
    // Widget "todas as fontes" sem alvos: nenhum record_type in (...) — os
    // escopos já enxergam suas linhas na consulta principal.
    return null;
  }
  if (eff.length === 0) return null;
  if (
    widgetSources &&
    widgetSources.length > 0 &&
    metricSourcesKey(eff) === metricSourcesKey(widgetSources)
  ) {
    return null;
  }
  return eff;
}

/**
 * Particiona as métricas do widget entre a consulta principal (índices em
 * `defaultIdx` — fontes do widget) e as pernas extras (uma por conjunto
 * DISTINTO de fontes, com os índices das métricas daquele conjunto). Índices
 * referem-se a `config.metrics` (ordem de exibição).
 */
export function partitionMetricLegs(
  metrics: Metric[],
  widgetSources?: SourceKey[],
  fieldByKey?: Map<string, FieldDefinition>
): {
  defaultIdx: number[];
  legs: { sources: SourceKey[]; idx: number[] }[];
} {
  const defaultIdx: number[] = [];
  const byKey = new Map<string, { sources: SourceKey[]; idx: number[] }>();
  metrics.forEach((m, i) => {
    const srcs = metricLegSources(m, widgetSources, fieldByKey);
    if (!srcs) {
      defaultIdx.push(i);
      return;
    }
    const key = metricSourcesKey(srcs);
    const leg = byKey.get(key) ?? { sources: srcs, idx: [] };
    leg.idx.push(i);
    byKey.set(key, leg);
  });
  return { defaultIdx, legs: [...byKey.values()] };
}

/**
 * Fontes que a CONSULTA do widget pode tocar: fontes do widget ∪ fontes das
 * métricas. Usada onde o `@period` é pré-sintetizado por fonte (filtros
 * rápidos de período) — o byType do RPC EXCLUI record_types fora do mapa,
 * então as fontes extras das métricas precisam de cobertura. Widget em "todas
 * as fontes" → [] (todas; as fontes das métricas já estão contidas).
 */
export function widgetQuerySources(
  widgetSources: SourceKey[] | undefined,
  metrics: Metric[] | undefined,
  // v1.1: com fieldByKey, os operandos com escopo (`agg:…@<fonte>`) também
  // entram na cobertura — o @period byType exclui record_types fora do mapa.
  fieldByKey?: Map<string, FieldDefinition>
): SourceKey[] {
  if (!widgetSources || widgetSources.length === 0) return [];
  const all = new Set<SourceKey>(widgetSources);
  for (const m of metrics ?? []) {
    for (const s of metricTargetSources(m)) all.add(s);
    for (const s of metricScopedSources(m, fieldByKey)) all.add(s);
  }
  return [...all];
}

/**
 * Normalização no SALVAMENTO (espelho do bloco de `sources` em
 * cleanFilters, lib/widgets/filter-ops.ts): valida/deduplica e só persiste
 * quando não-vazio (ausente = fontes do widget).
 */
export function cleanMetricSources<T extends Metric>(m: T): T {
  const sources = metricTargetSources(m);
  const { sources: _drop, ...rest } = m;
  return (sources.length > 0 ? { ...rest, sources } : rest) as T;
}
