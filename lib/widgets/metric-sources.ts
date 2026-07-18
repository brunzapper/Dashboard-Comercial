// Versão: 1.0 | Data: 18/07/2026
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
// Módulo puro/client-safe: importado pelo engine (server), pelas páginas (RSC)
// e pelos componentes de tabela (client).
import type { SourceKey } from "@/lib/sources";
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

/**
 * Fontes efetivas da PERNA de uma métrica: null = herda (sem alvos, ou o
 * conjunto é idêntico ao do widget — evita uma chamada RPC redundante).
 * Widget em "todas as fontes" (sem seleção) com métrica restrita → perna.
 */
export function metricLegSources(
  m: Metric,
  widgetSources?: SourceKey[]
): SourceKey[] | null {
  const targets = metricTargetSources(m);
  if (targets.length === 0) return null;
  if (
    widgetSources &&
    widgetSources.length > 0 &&
    metricSourcesKey(targets) === metricSourcesKey(widgetSources)
  ) {
    return null;
  }
  return targets;
}

/**
 * Particiona as métricas do widget entre a consulta principal (índices em
 * `defaultIdx` — fontes do widget) e as pernas extras (uma por conjunto
 * DISTINTO de fontes, com os índices das métricas daquele conjunto). Índices
 * referem-se a `config.metrics` (ordem de exibição).
 */
export function partitionMetricLegs(
  metrics: Metric[],
  widgetSources?: SourceKey[]
): {
  defaultIdx: number[];
  legs: { sources: SourceKey[]; idx: number[] }[];
} {
  const defaultIdx: number[] = [];
  const byKey = new Map<string, { sources: SourceKey[]; idx: number[] }>();
  metrics.forEach((m, i) => {
    const srcs = metricLegSources(m, widgetSources);
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
  metrics: Metric[] | undefined
): SourceKey[] {
  if (!widgetSources || widgetSources.length === 0) return [];
  const all = new Set<SourceKey>(widgetSources);
  for (const m of metrics ?? []) {
    for (const s of metricTargetSources(m)) all.add(s);
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
