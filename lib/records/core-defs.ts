// Versão: 1.0 | Data: 21/07/2026
// Linhas de `field_definitions` com source_system='core' (migração 0086) são
// OVERRIDES das colunas núcleo de `records` (rótulo/visibilidade/options via
// /campos) — NUNCA campos custom: o ref de widget segue sendo o nome cru da
// coluna ("pipeline"), jamais `custom:pipeline`. Todo consumidor de defs deve
// particionar por aqui (splitCoreDefs) antes de tratar a lista como campos de
// `custom_fields`. Exclusão via query: NÃO usar `.neq("source_system",'core')`
// — campos locais/app têm source_system NULL e o `<>` os derrubaria; filtre em
// JS com isCoreDef.

export const CORE_DEF_SOURCE = "core";

export function isCoreDef(f: { source_system?: string | null }): boolean {
  return f.source_system === CORE_DEF_SOURCE;
}

// Particiona defs em campos custom (tudo que não é core) + mapa de overrides
// core por field_key (= nome da coluna núcleo).
export function splitCoreDefs<
  T extends { field_key: string; source_system?: string | null },
>(rows: T[]): { custom: T[]; core: Map<string, T> } {
  const custom: T[] = [];
  const core = new Map<string, T>();
  for (const r of rows) {
    if (isCoreDef(r)) core.set(r.field_key, r);
    else custom.push(r);
  }
  return { custom, core };
}

// Colunas núcleo de TEXTO que podem alternar texto↔selecao no /campos (as
// demais têm o tipo travado ao da coluna física).
export const CORE_SELECT_CAPABLE = new Set<string>([
  "pipeline",
  "stage",
  "sale_type",
  "channel",
]);
