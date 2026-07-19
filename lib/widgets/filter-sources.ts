// Versão: 1.1 | Data: 16/07/2026
// Filtros segmentados por fonte (pass-through): um WidgetFilter pode carregar
// `sources` (fontes-alvo) e então só restringe as linhas dessas fontes — as
// demais fontes do widget passam sem restrição. Este módulo é puro (sem
// supabase) e converte a forma PERSISTIDA (`sources: SourceKey[]`) na forma de
// FIO (`record_types: string[]`) que o RPC run_widget_query (migração 0054) e
// o espelho PostgREST do modo lista entendem. O SQL só conhece record_type; o
// mapeamento SourceKey→record_type acontece aqui, num único ponto.
// v1.1 (16/07/2026): fontes dinâmicas — livre de catálogo. Qualquer key é
//   aceita como alvo (fonte nova = identidade key===record_type); alvo órfão
//   (fonte excluída) é inofensivo: a FK de records garante que não restam
//   linhas daquele record_type, então o disjunto não casa nada. Com o widget
//   em "todas as fontes" NÃO há mais interseção/unwrap contra a lista fixa —
//   o wrapper preserva a semântica mesmo com fontes criadas depois.
import {
  BUILTIN_SOURCES,
  recordTypeOf,
  type SourceDef,
  type SourceKey,
} from "@/lib/sources";
import type { WidgetFilter } from "./types";

// Fontes-alvo deduplicadas de um filtro ([] = todas as fontes).
export function filterTargetSources(f: WidgetFilter): SourceKey[] {
  return [
    ...new Set(
      (f.sources ?? []).filter(
        (s): s is SourceKey => typeof s === "string" && s.trim() !== ""
      )
    ),
  ];
}

// Normaliza a segmentação por fonte p/ o formato de fio:
// - sem `sources` → filtro inalterado (compat total com filtros gravados);
// - widget com fontes explícitas: alvo ∩ fontes do widget = ∅ → filtro
//   DESCARTADO (pass-through de tudo = não filtrar); alvo cobre TODAS →
//   filtro simples sem wrapper (igual hoje);
// - widget em "todas as fontes" → sempre wrapper com os alvos (não dá para
//   enumerar "todas" sem o catálogo — e o wrapper é equivalente).
// Idempotente: filtros já normalizados (com record_types) passam intactos.
export function applyFilterSourceTargets(
  filters: WidgetFilter[],
  widgetSources?: SourceKey[],
  catalog: SourceDef[] = BUILTIN_SOURCES
): WidgetFilter[] {
  const covered = widgetSources?.length ? widgetSources : null;
  const out: WidgetFilter[] = [];
  for (const f of filters) {
    const targets = filterTargetSources(f);
    if (targets.length === 0) {
      out.push(f);
      continue;
    }
    const effective = covered
      ? targets.filter((s) => covered.includes(s))
      : targets;
    if (effective.length === 0) continue;
    const { sources: _drop, ...rest } = f;
    if (covered && effective.length === covered.length) {
      out.push(rest);
      continue;
    }
    // record_type ciente do catálogo: sub-fonte → record_type da pai.
    out.push({
      ...rest,
      record_types: [...new Set(effective.map((s) => recordTypeOf(s, catalog)))],
    });
  }
  return out;
}
