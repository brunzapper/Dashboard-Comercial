// Versão: 1.1 | Data: 17/07/2026
// v1.1 (17/07/2026): busca client-side na lista de registros — opção
//   `skipSearch` em viewStateToFilters + helper `searchHandledOnClient`
//   (critério único de "quem aplica o q": servidor ou cliente).
// Filtros de VISUALIZAÇÃO: filtros/busca que o usuário aplica no dashboard já
// renderizado (barra embutida da tabela + widget "Filtro por campo"), em vez de
// só na edição do widget. São transportados pela URL como um JSON compacto e
// mesclados em `config.filters` de cada widget-alvo no RSC, antes de rodar o
// engine — reaproveitando toda a pipeline de filtros (RPC / PostgREST).
//
// Busca textual: um único WidgetFilter com op 'ilike'. O `field` pode ser um
// único campo ou vários unidos por '|' (OR entre colunas). O valor é o termo
// cru — quem consulta (engine/record-list) envolve com '%...%'.
import type { FilterOp, WidgetFilter } from "./types";

const FILTER_OPS: ReadonlySet<FilterOp> = new Set<FilterOp>([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "ilike",
  "is_null",
  "not_null",
]);

// Separador de campos numa busca OR (ex.: "title|stage").
export const SEARCH_FIELD_SEP = "|";
export const DEFAULT_SEARCH_FIELDS = ["title"];

/** Estado de um filtro de visualização (termo de busca + filtros estruturados). */
export interface ViewFilterState {
  q?: string; // termo de busca livre
  filters: WidgetFilter[]; // filtros estruturados campo/operador/valor
}

const EMPTY: ViewFilterState = { q: "", filters: [] };

/** Uma entrada de filtro crua (do JSON) é um filtro válido? */
function isValidFilter(v: unknown): v is WidgetFilter {
  if (!v || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  return typeof f.field === "string" && f.field !== "" && FILTER_OPS.has(f.op as FilterOp);
}

/**
 * Decodifica o parâmetro de URL (encodeURIComponent(JSON.stringify(state))) num
 * estado seguro. Entradas inválidas são descartadas silenciosamente — o filtro
 * nunca deve derrubar a renderização do dashboard.
 */
export function parseViewFilter(raw: string | undefined | null): ViewFilterState {
  if (!raw) return { ...EMPTY };
  let obj: unknown;
  try {
    obj = JSON.parse(decodeURIComponent(raw));
  } catch {
    return { ...EMPTY };
  }
  if (!obj || typeof obj !== "object") return { ...EMPTY };
  const o = obj as Record<string, unknown>;
  const q = typeof o.q === "string" ? o.q : "";
  const filters = Array.isArray(o.filters)
    ? (o.filters.filter(isValidFilter) as WidgetFilter[])
    : [];
  return { q, filters };
}

/** Serializa um estado para o parâmetro de URL (ou "" quando vazio). */
export function encodeViewFilter(state: ViewFilterState): string {
  const q = state.q?.trim() ?? "";
  const filters = (state.filters ?? []).filter((f) => f.field);
  if (!q && filters.length === 0) return "";
  return encodeURIComponent(JSON.stringify({ q, filters }));
}

/** Um estado tem algo efetivo a aplicar? */
export function hasViewFilter(state: ViewFilterState): boolean {
  return Boolean(state.q?.trim()) || (state.filters?.length ?? 0) > 0;
}

/**
 * Converte um termo de busca num filtro `ilike` sobre os campos de busca. Vários
 * campos viram uma busca OR (field = "a|b|c"). Termo vazio => sem filtro.
 */
export function searchToFilters(
  q: string | undefined,
  searchFields: string[] | undefined
): WidgetFilter[] {
  const term = q?.trim();
  if (!term) return [];
  const fields =
    searchFields && searchFields.length > 0 ? searchFields : DEFAULT_SEARCH_FIELDS;
  return [{ field: fields.join(SEARCH_FIELD_SEP), op: "ilike", value: term }];
}

/**
 * Resolve o estado de visualização (termo + filtros) para uma lista de
 * WidgetFilter pronta para mesclar em config.filters (semântica AND).
 * `skipSearch` omite o termo (`q`) — usado quando a busca textual do widget é
 * aplicada no CLIENTE (ver searchHandledOnClient); os filtros estruturados
 * continuam valendo no servidor.
 */
export function viewStateToFilters(
  state: ViewFilterState,
  searchFields: string[] | undefined,
  opts?: { skipSearch?: boolean }
): WidgetFilter[] {
  return [
    ...(opts?.skipSearch ? [] : searchToFilters(state.q, searchFields)),
    ...(state.filters ?? []),
  ];
}

/**
 * A busca textual (q do tf_) deste widget é resolvida no CLIENTE? Vale para a
 * tabela em modo "registros individuais" (rowSource records), SEM limit e com a
 * barra visível — nesse caso runRecordList entrega o dataset completo e a
 * RecordListTable filtra localmente (busca instantânea, sem round-trip RSC).
 * Servidor (page.tsx/snapshot) e cliente (WidgetCard) DEVEM usar este mesmo
 * critério: se o servidor pulasse o q sem o cliente filtrar (ou vice-versa), a
 * busca aplicaria em dobro ou nunca. Com a barra oculta (showFilterBar false,
 * inclui snapshot com allowWidgetFilters off) ninguém digita q — um q forjado
 * na URL segue tratado no servidor, como sempre.
 */
export function searchHandledOnClient(
  settings:
    | {
        rowMode?: string;
        rowSource?: string;
        limit?: number;
        showFilterBar?: boolean;
      }
    | null
    | undefined
): boolean {
  return (
    settings?.rowMode === "records" &&
    (settings.rowSource ?? "records") === "records" &&
    !(typeof settings.limit === "number" && settings.limit > 0) &&
    settings.showFilterBar !== false
  );
}

/** Anexa os filtros de visualização aos do widget (AND). */
export function mergeViewFilters(
  base: WidgetFilter[],
  view: WidgetFilter[]
): WidgetFilter[] {
  if (view.length === 0) return base;
  return [...base, ...view];
}
