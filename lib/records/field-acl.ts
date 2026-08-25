// Versão: 1.0 | Data: 22/08/2026
// ACL por papel (field_definitions.visible_to_roles) aplicada aos VALORES, não
// só às colunas.
//
// Por que existe: `records.custom_fields` é UMA coluna jsonb, então a RLS não
// consegue esconder uma CHAVE dela — quem lê o registro lê o objeto inteiro. As
// pages resolviam o ACL escolhendo quais colunas RENDERIZAR, o que esconde o
// dado do olho mas não do payload: as linhas cruas seguiam para o Client
// Component e o valor do campo restrito viajava no flight payload, visível em
// view-source / aba Network.
//
// A peneira roda no SERVIDOR, imediatamente antes de entregar as linhas ao
// cliente. Regra: chave com definição que o papel NÃO alcança sai; chave sem
// definição alguma (órfã) fica — não há ACL a aplicar nela, e ela já aparece
// como coluna read-only. Admin vê tudo.
//
// Precedente da mesma régua em app/(app)/registros/export-actions.ts (o CSV já
// filtrava os VALORES, não só o catálogo) — aqui ela vira helper único.
import { hasAnyRole, type RoleKey } from "@/lib/auth/roles";
import type { FieldDefinition, RecordRow } from "./types";

/**
 * Chaves de campo que este conjunto de papéis NÃO pode ver. Deny-list de
 * propósito: só remove o que tem definição restrita, preservando as chaves
 * órfãs (sem def) e qualquer chave nova que o catálogo ainda não conheça.
 * Admin ⇒ conjunto vazio.
 */
export function restrictedFieldKeys(
  defs: Pick<FieldDefinition, "field_key" | "visible_to_roles">[],
  roles: string[],
  isAdmin: boolean
): Set<string> {
  if (isAdmin) return new Set();
  return new Set(
    defs
      .filter((f) => !hasAnyRole(roles, f.visible_to_roles as RoleKey[]))
      .map((f) => f.field_key)
  );
}

/** Uma linha com as chaves restritas removidas de custom_fields (+ __match). */
function redactRow<T extends Pick<RecordRow, "custom_fields">>(
  row: T,
  denied: Set<string>
): T {
  const custom = row.custom_fields;
  const match = (row as Partial<RecordRow>).__match;

  const hit = custom
    ? Object.keys(custom).some((k) => denied.has(k))
    : false;
  // Registros CASADOS (match:<fonte>:<campo>) carregam custom_fields próprios —
  // a mesma peneira vale para eles, senão o campo restrito volta pela conexão.
  const matchEntries = match ? Object.entries(match) : null;
  const matchHit =
    matchEntries?.some(
      ([, m]) =>
        m != null &&
        (Object.keys(m.custom_fields ?? {}).some((k) => denied.has(k)) ||
          m.__match != null)
    ) ?? false;
  if (!hit && !matchHit) return row;

  const out = { ...row } as T;
  if (hit && custom) {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(custom)) {
      if (!denied.has(k)) clean[k] = v;
    }
    out.custom_fields = clean;
  }
  if (matchHit && matchEntries) {
    const cleanMatch: Record<string, RecordRow | undefined> = {};
    for (const [key, m] of matchEntries) {
      cleanMatch[key] = m ? redactRow(m, denied) : m;
    }
    (out as Partial<RecordRow>).__match = cleanMatch;
  }
  return out;
}

/**
 * Remove das linhas os valores de campo que o papel não alcança. Sem chave
 * restrita em jogo devolve o MESMO array (nenhuma alocação no caminho comum —
 * admin e bases sem campo restrito não pagam nada).
 */
export function redactRestrictedFields<
  T extends Pick<RecordRow, "custom_fields">,
>(rows: T[], denied: Set<string>): T[] {
  if (denied.size === 0 || rows.length === 0) return rows;
  let changed = false;
  const out = rows.map((r) => {
    const next = redactRow(r, denied);
    if (next !== r) changed = true;
    return next;
  });
  return changed ? out : rows;
}
