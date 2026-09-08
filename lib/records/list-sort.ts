// Versão: 1.0 | Data: 07/08/2026
// Ordenação da tabela de /registros (server-side, dirigida por URL —
// `?ordenar=<ref>&dir=asc|desc`). Helper puro compartilhado pela page, pelos
// headers clicáveis (records-table) e pelo export CSV — os três validam/geram
// a MESMA expressão de order.
// Whitelist: colunas núcleo reais de `records` (precedente SORTABLE_CORE_COLS,
// lib/widgets/view-filters.ts) menos relações (ordenar por UUID não faz
// sentido) + colunas custom COM definição presente no catálogo da tabela.
// Custom numérico (numero/moeda/calculado) ordena por `custom_fields->key`
// (jsonb `->`: número JSON ordena numericamente — `->>` daria "9" > "10");
// os demais por `custom_fields->>key` (texto; datas custom são `YYYY-MM-DD`
// naive, ordem lexical = cronológica). Caveat aceito do `->`: valores legados
// de tipos mistos agrupam pela precedência de tipo do jsonb.
// Param inválido/fora do catálogo ⇒ null (fallback silencioso à ordem padrão).

import type { FieldDefinition } from "@/lib/records/types";
import { CORE_DISPLAY_REFS } from "@/lib/records/detail-fields";

export type SortDir = "asc" | "desc";

export interface RecordListSort {
  ref: string;
  dir: SortDir;
}

const RELATION_REFS = new Set([
  "responsible_id",
  "operation_id",
  "related_lead_id",
]);

export const SORTABLE_CORE_REGISTROS: ReadonlySet<string> = new Set([
  "title",
  ...CORE_DISPLAY_REFS.filter((r) => !RELATION_REFS.has(r)),
]);

const NUMERIC_SORT_TYPES = new Set(["numero", "moeda", "calculado"]);

// field_key é slug no app inteiro; o whitelist barra qualquer coisa que
// quebraria o parse do order do PostgREST (pontos, vírgulas, parênteses…).
const SAFE_KEY = /^[a-zA-Z0-9_-]+$/;

type SortableDef = Pick<FieldDefinition, "field_key" | "data_type">;

export function parseRecordListSort(
  ordenar: string,
  dir: string,
  fields: SortableDef[]
): RecordListSort | null {
  if (!ordenar) return null;
  const d: SortDir = dir === "desc" ? "desc" : "asc";
  if (SORTABLE_CORE_REGISTROS.has(ordenar)) return { ref: ordenar, dir: d };
  if (ordenar.startsWith("custom:")) {
    const key = ordenar.slice("custom:".length);
    if (!SAFE_KEY.test(key)) return null;
    if (!fields.some((f) => f.field_key === key)) return null;
    return { ref: ordenar, dir: d };
  }
  return null;
}

// Expressão de order do PostgREST para um sort JÁ validado.
export function sortColumnExpr(
  sort: RecordListSort,
  fields: SortableDef[]
): string {
  if (!sort.ref.startsWith("custom:")) return sort.ref;
  const key = sort.ref.slice("custom:".length);
  const def = fields.find((f) => f.field_key === key);
  const numeric = def ? NUMERIC_SORT_TYPES.has(def.data_type) : false;
  return numeric ? `custom_fields->${key}` : `custom_fields->>${key}`;
}

// Ciclo do clique no header: asc → desc → sem ordenação.
export function toggleSort(
  cur: RecordListSort | null,
  ref: string
): RecordListSort | null {
  if (!cur || cur.ref !== ref) return { ref, dir: "asc" };
  return cur.dir === "asc" ? { ref, dir: "desc" } : null;
}
