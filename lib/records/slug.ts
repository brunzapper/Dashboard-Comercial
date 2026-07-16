// Versão: 1.0 | Data: 16/07/2026
// Slug compartilhado (extraído de app/(app)/campos/actions.ts): usado no
// field_key dos campos e na key das fontes dinâmicas (Configurações → Fontes,
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
