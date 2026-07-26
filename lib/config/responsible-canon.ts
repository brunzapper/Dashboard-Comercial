// Versão: 1.0 | Data: 26/07/2026
// Agrupamento de responsáveis por EXIBIÇÃO (0101): `responsibles.canonical_id`
// marca um responsável como apelido de outro ("nome usado") SEM repontar
// records.responsible_id — a resolução é 100% engine/loaders (invariante 20):
// filtros por responsável expandem para o GRUPO (apelidos ∪ principal),
// dimensões fundem no merge client-side (bucket-merge), rótulos saem do
// principal (fetchFkLabels/fk-labels) e dropdowns colapsam para o principal.
// Limpar canonical_id desfaz tudo (nada é gravado nos registros). O grupo é
// sempre PLANO (apelido aponta direto ao principal — a action de Configurações
// repontea filhos); o rootOf abaixo achata cadeias por defesa.
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { WidgetFilter } from "@/lib/widgets/types";

export interface ResponsibleCanon {
  /** apelido → principal (só apelidos têm entrada). */
  canonicalById: Map<string, string>;
  /** qualquer membro (principal OU apelido) → grupo completo [principal, ...apelidos]. */
  groupById: Map<string, string[]>;
}

export const EMPTY_CANON: ResponsibleCanon = {
  canonicalById: new Map(),
  groupById: new Map(),
};

/** Monta o mapa de grupos a partir de linhas {id, canonical_id} de responsibles. */
export function buildResponsibleCanon(
  rows: { id: string; canonical_id?: string | null }[]
): ResponsibleCanon {
  const parent = new Map<string, string>();
  for (const r of rows) {
    if (r.canonical_id && r.canonical_id !== r.id)
      parent.set(r.id, r.canonical_id);
  }
  if (parent.size === 0) return EMPTY_CANON;
  // Achata cadeias (defensivo — a action mantém o grupo plano) com guarda de
  // ciclo: A→B→A para no último id visitado em vez de laçar.
  const rootOf = (id: string): string => {
    let cur = id;
    const seen = new Set<string>([cur]);
    while (parent.has(cur)) {
      const next = parent.get(cur)!;
      if (seen.has(next)) break;
      seen.add(next);
      cur = next;
    }
    return cur;
  };
  const canonicalById = new Map<string, string>();
  for (const id of parent.keys()) {
    const root = rootOf(id);
    if (root !== id) canonicalById.set(id, root);
  }
  const members = new Map<string, string[]>();
  for (const [alias, canon] of canonicalById) {
    const list = members.get(canon) ?? [canon];
    list.push(alias);
    members.set(canon, list);
  }
  const groupById = new Map<string, string[]>();
  for (const group of members.values()) {
    for (const id of group) groupById.set(id, group);
  }
  return { canonicalById, groupById };
}

/**
 * Carrega o mapa de agrupamento. Só ids (sem nomes) — seguro inclusive p/ o
 * service role do viewer público de snapshot (invariante 15: nenhum dado além
 * da topologia do grupo). Erro (ex.: migração 0101 ausente) degrada para
 * EMPTY_CANON — dashboards seguem sem agrupamento, nunca quebrados.
 */
export const loadResponsibleCanon = cache(async function loadResponsibleCanon(
  supabase: SupabaseClient
): Promise<ResponsibleCanon> {
  try {
    const { data, error } = await supabase
      .from("responsibles")
      .select("id, canonical_id");
    if (error) return EMPTY_CANON;
    return buildResponsibleCanon(
      (data ?? []) as { id: string; canonical_id?: string | null }[]
    );
  } catch {
    return EMPTY_CANON;
  }
});

/** Principal de um id (o próprio id quando não é apelido). */
export function canonicalOf(id: string, canon: ResponsibleCanon): string {
  return canon.canonicalById.get(id) ?? id;
}

/**
 * Expande ids para o grupo completo de cada um (dedup, ordem de chegada).
 * Id fora de qualquer grupo passa intacto — inclusive o uuid-zero do filtro
 * impossível do escopo de operação. Idempotente (expandir de novo não muda).
 */
export function expandResponsibleIds(
  ids: string[],
  canon: ResponsibleCanon
): string[] {
  if (canon.canonicalById.size === 0) return ids;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    for (const m of canon.groupById.get(id) ?? [id]) {
      if (!seen.has(m)) {
        seen.add(m);
        out.push(m);
      }
    }
  }
  return out;
}

/** Algum filtro referencia a coluna responsible_id? (gate barato do load). */
export function filtersReferenceResponsible(
  filters: WidgetFilter[] | undefined
): boolean {
  return (filters ?? []).some((f) => f.field === "responsible_id");
}

/** A config referencia responsável em filtros ou dimensões? (gate do engine). */
export function widgetReferencesResponsible(config: {
  filters?: WidgetFilter[];
  dimensions?: { field: string }[];
}): boolean {
  return (
    filtersReferenceResponsible(config.filters) ||
    (config.dimensions ?? []).some((d) => d.field === "responsible_id")
  );
}

/**
 * Reescreve filtros `responsible_id` para alcançar o grupo: `in` expande a
 * lista; `eq`/`eq_ci` com id de um grupo viram `in` no grupo (valor já é UUID
 * nesses caminhos — condições por NOME passam antes por resolveFkCondFilters).
 * Demais operadores (neq, is_null…) passam intactos. Sem apelidos ou sem
 * mudança real, retorna a MESMA lista (fast path).
 */
export function expandResponsibleFilters(
  filters: WidgetFilter[],
  canon: ResponsibleCanon
): WidgetFilter[] {
  if (canon.canonicalById.size === 0) return filters;
  let changed = false;
  const out = filters.map((f) => {
    if (f.field !== "responsible_id") return f;
    if (f.op === "in" && Array.isArray(f.value)) {
      const ids = f.value.filter((v): v is string => typeof v === "string");
      const expanded = expandResponsibleIds(ids, canon);
      if (expanded.length === ids.length) return f;
      changed = true;
      return { ...f, value: expanded };
    }
    if ((f.op === "eq" || f.op === "eq_ci") && typeof f.value === "string") {
      const group = canon.groupById.get(f.value);
      if (!group || group.length <= 1) return f;
      changed = true;
      return { ...f, op: "in" as const, value: [...group] };
    }
    return f;
  });
  return changed ? out : filters;
}

/**
 * Colapsa opções de dropdown: apelido some SÓ quando o principal está presente
 * na lista (defensivo — principal inativo/fora de uma restrição mantém o
 * apelido visível em vez de sumir com o grupo inteiro).
 */
export function collapseResponsibleOptions<T extends { value: string }>(
  options: T[],
  canon: ResponsibleCanon
): T[] {
  if (canon.canonicalById.size === 0) return options;
  const present = new Set(options.map((o) => o.value));
  const out = options.filter((o) => {
    const c = canon.canonicalById.get(o.value);
    return !(c && present.has(c));
  });
  return out.length === options.length ? options : out;
}
