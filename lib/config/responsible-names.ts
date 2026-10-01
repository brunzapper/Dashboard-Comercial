// Versão: 1.0 | Data: 01/10/2026
// Responsável por NOME → id CANÔNICO. Extraído de app/(app)/dashboards/
// actions.ts (`loadResponsibleIdByName`, v4.x) para ser o dono ÚNICO da regra:
// display_name exato (trim), linha CANÔNICA preferida quando o mesmo nome
// existe em canônico e apelido, alvo apelido resolve para o principal
// (agrupamento 0101). Consumidores: vínculos do preset, metas por responsável
// (Tabela de metas, seções de dados do preset) e nós de indicador da Tree.
//
// Fallback sem caixa (v1.0): o nome digitado num widget ("gabriella") casa o
// cadastrado ("Gabriella") quando não há casamento exato — ambiguidade entre
// dois cadastros que só diferem em caixa prefere o canônico, como no exato.
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ResponsibleNameRow {
  id: string;
  display_name: string | null;
  canonical_id?: string | null;
}

export interface ResponsibleNameIndex {
  exact: Map<string, string>;
  folded: Map<string, string>;
}

const fold = (s: string) => s.trim().toLocaleLowerCase("pt-BR");

export function buildResponsibleNameIndex(
  rows: ResponsibleNameRow[]
): ResponsibleNameIndex {
  const pickInto = (
    map: Map<string, { id: string; canonical: boolean }>,
    key: string,
    entry: { id: string; canonical: boolean }
  ) => {
    const cur = map.get(key);
    if (!cur || (!cur.canonical && entry.canonical)) map.set(key, entry);
  };
  const exact = new Map<string, { id: string; canonical: boolean }>();
  const folded = new Map<string, { id: string; canonical: boolean }>();
  for (const r of rows) {
    const name = (r.display_name ?? "").trim();
    if (!name) continue;
    const entry = {
      id: r.canonical_id ?? r.id,
      canonical: r.canonical_id == null,
    };
    pickInto(exact, name, entry);
    pickInto(folded, fold(name), entry);
  }
  const flat = (m: Map<string, { id: string }>) =>
    new Map([...m].map(([k, e]) => [k, e.id]));
  return { exact: flat(exact), folded: flat(folded) };
}

/** Id canônico de um nome; desconhecido ⇒ null (o chamador decide o erro). */
export function responsibleIdForName(
  index: ResponsibleNameIndex,
  name: string | null | undefined
): string | null {
  const n = (name ?? "").trim();
  if (!n) return null;
  return index.exact.get(n) ?? index.folded.get(fold(n)) ?? null;
}

export const loadResponsibleNameIndex = cache(
  async function loadResponsibleNameIndex(
    supabase: SupabaseClient
  ): Promise<ResponsibleNameIndex> {
    try {
      const { data } = await supabase
        .from("responsibles")
        .select("id, display_name, canonical_id");
      return buildResponsibleNameIndex((data ?? []) as ResponsibleNameRow[]);
    } catch {
      return buildResponsibleNameIndex([]);
    }
  }
);
