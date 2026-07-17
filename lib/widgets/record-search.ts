// Versão: 1.0 | Data: 17/07/2026
// Busca textual CLIENT-SIDE da tabela em modo "registros individuais": matcher
// em memória com a mesma semântica do ilike que runRecordList aplicava no
// servidor — substring case-insensitive, OR entre os campos de busca, NULL
// nunca casa. Usado quando searchHandledOnClient(settings) (view-filters.ts):
// o dataset completo já está no cliente e filtrar aqui evita o round-trip RSC
// a cada digitação.
//
// ESPELHO de lib/widgets/record-list.ts — qualquer mudança no ramo ilike
// (expansão de unified:*) ou em filterColumn/CORE_COLS de lá DEVE ser
// espelhada aqui, senão a busca client-side diverge da server-side (tabelas
// com limit/agregadas seguem no servidor). Não importar record-list.ts neste
// módulo: ele arrasta engine.ts (server-only) para o bundle do cliente.
//
// Divergências intencionais do ilike/PostgREST: `%`/`_` casam LITERAL (no
// servidor são curingas SQL) e `,()` também (lá viram espaço por limitação da
// sintaxe de `.or()`).
import type { RecordRow } from "@/lib/records/types";

import { CORE_FIELDS, type AvailableField } from "./fields";
import { DEFAULT_SEARCH_FIELDS, SEARCH_FIELD_SEP } from "./view-filters";

// Colunas do núcleo pesquisáveis (whitelist) — espelho do CORE_COLS de
// record-list.ts.
const CORE_COLS = new Set<string>([
  ...CORE_FIELDS.map((f) => f.field),
  "record_type",
]);

// Valor pesquisável de um ref CONCRETO — espelho de filterColumn + do acesso
// que o PostgREST faria: custom:<k> → custom_fields->>k; núcleo whitelisted →
// coluna; resto (match:*, desconhecidos) → não pesquisável (como no servidor).
function refValue(ref: string, r: RecordRow): unknown {
  if (ref.startsWith("custom:")) return r.custom_fields?.[ref.slice(7)];
  if (!CORE_COLS.has(ref)) return undefined;
  return (r as unknown as Record<string, unknown>)[ref];
}

/**
 * Matcher da busca textual sobre RecordRow[] (null = termo vazio, sem filtro).
 * `searchFields` são os campos configurados no widget (default ['title']);
 * `unified:*` expande para TODOS os membros via `available` (OR entre colunas,
 * independente do record_type da linha — colunas de outra fonte simplesmente
 * não casam), como no servidor.
 */
export function recordSearchMatcher(
  q: string,
  searchFields: string[] | undefined,
  available: AvailableField[]
): ((r: RecordRow) => boolean) | null {
  const term = q.trim().toLowerCase();
  if (!term) return null;
  const fields =
    searchFields && searchFields.length > 0 ? searchFields : DEFAULT_SEARCH_FIELDS;
  const refs = [
    ...new Set(
      fields
        .flatMap((f) => f.split(SEARCH_FIELD_SEP))
        .flatMap((f) =>
          f.startsWith("unified:")
            ? Object.values(
                available.find((a) => a.field === f)?.unifiedMembers ?? {}
              )
            : [f]
        )
    ),
  ];
  return (r) =>
    refs.some((ref) => {
      const v = refValue(ref, r);
      return v != null && v !== "" && String(v).toLowerCase().includes(term);
    });
}
