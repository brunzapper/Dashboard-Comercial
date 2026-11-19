// Versão: 1.1 | Data: 19/11/2026
// v1.1 (19/11/2026): distinctFieldKey — chave PRÓPRIA da Base para um campo
//   homônimo de outra Base que não é o mesmo dado (esquema por Base, fase 4).
// Slug compartilhado (extraído de app/(app)/campos/actions.ts): usado no
// field_key dos campos e na key das fontes dinâmicas (Registros → Bases,
// wizard de import). Minúsculas, sem acentos, [a-z0-9_], máx. 60.
export function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/**
 * Chave de um campo com o MESMO nome de um campo de outra Base que NÃO é o
 * mesmo dado: sufixo com a key da Base (`status` em Meetime ⇒
 * `status_meetime`). Cabe nos 60 caracteres cortando a parte do nome.
 */
export function distinctFieldKey(key: string, sourceKey: string): string {
  const suffix = `_${slugify(sourceKey)}`;
  if (key.endsWith(suffix)) return key;
  return `${key.slice(0, Math.max(1, 60 - suffix.length))}${suffix}`;
}
