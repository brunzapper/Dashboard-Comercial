// Versão: 1.0 | Data: 26/07/2026
// PASTAS DE BASES (0107): agrupamento de EXIBIÇÃO das bases raiz em "Pastas"
// (source_folders) — navegação Pasta → Base → Sub-base em /registros e
// /campos, tabelas de Configurações → Bases e headings dos pickers de base
// (widget-builder, diálogo Bases do board, matriz de Acessos...).
// Pasta NUNCA entra em consulta/engine/RPC: este módulo é 100% exibição.
// TODO agrupamento/ordenação passa por aqui — não recrie a lógica em cada
// picker. Grupos vazios são omitidos por design: um catálogo já recortado
// (applySourceScope de board, RLS de bases negadas) esconde a pasta esvaziada
// sozinho. Subs nunca aparecem em `roots` — quem precisa delas usa
// subSourcesOf(root.key, sources) (lib/sources.ts), mantendo o aninhamento
// pai→sub num único lugar.
/** Linha de `source_folders` (0107). */
export interface SourceFolder {
  id: string;
  label: string;
  sortOrder: number;
}

// Forma mínima aceita pelos helpers: o catálogo cheio (SourceDef) e os
// catálogos "slim" de actions (ex.: BoardSourcesState) servem igual.
export interface SourceLike {
  key: string;
  parentKey?: string | null;
  folderId?: string | null;
}

// Rótulo do grupo implícito ("sem pasta"). Só aparece quando existe ao menos
// uma pasta real (sem pastas, a UI degrada para as listas planas de sempre).
export const IMPLICIT_FOLDER_LABEL = "Geral";

export interface SourceFolderGroup<T extends SourceLike = SourceLike> {
  // null = grupo implícito ("sem pasta" / pasta desconhecida).
  folder: SourceFolder | null;
  // Só bases RAIZ, na ordem do catálogo (sort_order asc, builtin desc,
  // created_at asc — a ordem do loader é preservada).
  roots: T[];
}

/**
 * Agrupa as bases RAIZ do catálogo por pasta. Implícita primeiro, depois as
 * pastas por sortOrder (empate: label). Grupos vazios ficam de fora — inclui
 * pasta esvaziada por um catálogo recortado (escopo de board/RLS). folderId
 * apontando para pasta fora da lista (corrida de exclusão) cai na implícita.
 */
export function groupSourcesByFolder<T extends SourceLike>(
  folders: SourceFolder[],
  sources: T[]
): SourceFolderGroup<T>[] {
  const known = new Set(folders.map((f) => f.id));
  const byFolder = new Map<string | null, T[]>();
  for (const s of sources) {
    if (s.parentKey) continue; // subs ficam com a pai (subSourcesOf)
    const fid = s.folderId && known.has(s.folderId) ? s.folderId : null;
    const list = byFolder.get(fid);
    if (list) list.push(s);
    else byFolder.set(fid, [s]);
  }
  const ordered = [...folders].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)
  );
  const groups: SourceFolderGroup<T>[] = [];
  const implicit = byFolder.get(null);
  if (implicit && implicit.length > 0) groups.push({ folder: null, roots: implicit });
  for (const folder of ordered) {
    const roots = byFolder.get(folder.id);
    if (roots && roots.length > 0) groups.push({ folder, roots });
  }
  return groups;
}

/**
 * Pasta efetiva de uma fonte QUALQUER: sub resolve pela PAI (sub não tem
 * pasta própria). null = implícita / fonte desconhecida / pasta excluída.
 */
export function folderIdOfSource(
  key: string,
  sources: SourceLike[],
  folders: SourceFolder[]
): string | null {
  const def = sources.find((s) => s.key === key);
  if (!def) return null;
  const root = def.parentKey
    ? sources.find((s) => s.key === def.parentKey)
    : def;
  const fid = root?.folderId ?? null;
  return fid && folders.some((f) => f.id === fid) ? fid : null;
}

/** Há navegação por pasta? (ao menos uma pasta REAL com base dentro). */
export function hasFolderNav(
  folders: SourceFolder[],
  sources: SourceLike[]
): boolean {
  return groupSourcesByFolder(folders, sources).some((g) => g.folder != null);
}

/**
 * Move `key` uma posição para cima/baixo em `keys` (ordem de exibição) e
 * devolve a lista re-sequenciada — a action regrava sort_order = índice do
 * grupo inteiro (normaliza empates de sort_order 0 de quebra). Bordas
 * (primeiro ↑ / último ↓) e key ausente: devolve a lista como veio.
 */
export function resequenceAfterMove(
  keys: string[],
  key: string,
  dir: "up" | "down"
): string[] {
  const idx = keys.indexOf(key);
  if (idx < 0) return [...keys];
  const target = dir === "up" ? idx - 1 : idx + 1;
  if (target < 0 || target >= keys.length) return [...keys];
  const next = [...keys];
  next[idx] = next[target];
  next[target] = key;
  return next;
}
