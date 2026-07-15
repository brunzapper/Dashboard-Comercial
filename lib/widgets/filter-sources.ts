// Versão: 1.0 | Data: 15/07/2026
// Filtros segmentados por fonte (pass-through): um WidgetFilter pode carregar
// `sources` (fontes-alvo) e então só restringe as linhas dessas fontes — as
// demais fontes do widget passam sem restrição. Este módulo é puro (sem
// supabase) e converte a forma PERSISTIDA (`sources: SourceKey[]`) na forma de
// FIO (`record_types: string[]`) que o RPC run_widget_query (migração 0054) e
// o espelho PostgREST do modo lista entendem. O SQL só conhece record_type; o
// mapeamento SourceKey→record_type acontece aqui, num único ponto.
import {
  SOURCE_KEYS,
  SOURCE_RECORD_TYPE,
  isSourceKey,
  type SourceKey,
} from "@/lib/sources";
import type { WidgetFilter } from "./types";

// Fontes-alvo válidas/deduplicadas de um filtro ([] = todas as fontes).
export function filterTargetSources(f: WidgetFilter): SourceKey[] {
  return [...new Set((f.sources ?? []).filter(isSourceKey))];
}

// Normaliza a segmentação por fonte p/ o formato de fio, relativo às fontes
// cobertas pelo widget (vazio = todas):
// - sem `sources` → filtro inalterado (compat total com filtros gravados);
// - alvo ∩ fontes cobertas = ∅ → filtro DESCARTADO (pass-through de tudo é
//   equivalente a não filtrar; neutraliza alvo "órfão" quando o usuário
//   remove uma fonte do widget depois de criar o filtro);
// - alvo cobre TODAS as fontes cobertas → filtro simples sem wrapper (igual
//   hoje; funciona até com o RPC anterior à 0054);
// - senão → { ...f, record_types: [...] } (sem a chave `sources`).
// Idempotente: filtros já normalizados (com record_types) passam intactos.
export function applyFilterSourceTargets(
  filters: WidgetFilter[],
  widgetSources?: SourceKey[]
): WidgetFilter[] {
  const covered = widgetSources?.length ? widgetSources : SOURCE_KEYS;
  const out: WidgetFilter[] = [];
  for (const f of filters) {
    const targets = filterTargetSources(f);
    if (targets.length === 0) {
      out.push(f);
      continue;
    }
    const effective = targets.filter((s) => covered.includes(s));
    if (effective.length === 0) continue;
    const { sources: _drop, ...rest } = f;
    if (effective.length === covered.length) {
      out.push(rest);
      continue;
    }
    out.push({ ...rest, record_types: effective.map((s) => SOURCE_RECORD_TYPE[s]) });
  }
  return out;
}
