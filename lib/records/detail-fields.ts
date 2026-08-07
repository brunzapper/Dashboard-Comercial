// Versão: 1.0 | Data: 07/08/2026
// Helpers puros (client-safe) do "100% dos campos" da área Registros:
// - parse do resultado de registros_populated_refs (0120) — fail-safe: shape
//   inesperado vira null e a page cai no conjunto de colunas legado;
// - conjunto/ordem das colunas núcleo de exibição (dirigidas por dados) e das
//   colunas custom da tabela (aplica-se à base OU populada, ACL preservado);
// - linhas da seção núcleo do painel de detalhe (RecordEditForm) — o guard
//   `ref in record` pula colunas que o select da superfície não trouxe, em vez
//   de exibir um "—" falso;
// - chaves órfãs de custom_fields (valor sem definição alguma → "Outros dados").
// O olho (show_in_builder) NÃO participa de nada aqui — desde 07/08/2026 ele
// vale só para os dropdowns do construtor de dashboards.

import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import { CORE_FIELDS } from "@/lib/widgets/fields";
import { recordCellValue, type RecordLabels } from "@/lib/export/record-cells";

// ---------------------------------------------------------------------------
// Resultado de registros_populated_refs (0120)

export interface PopulatedRefs {
  core: string[];
  custom: string[];
}

export function parsePopulatedRefs(raw: unknown): PopulatedRefs | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const arr = (v: unknown): string[] | null =>
    Array.isArray(v) && v.every((x) => typeof x === "string")
      ? (v as string[])
      : null;
  const core = arr(obj.core);
  const custom = arr(obj.custom);
  if (!core || !custom) return null;
  return { core, custom };
}

// ---------------------------------------------------------------------------
// Refs núcleo de exibição

type CoreDefLite = Pick<FieldDefinition, "field_key" | "label" | "sort_order">;

// Identidade/cabeçalho ficam fora da exibição em colunas/grades: o título é a
// 1ª coluna fixa da tabela e o cabeçalho do painel; tipo/base idem (espelho da
// lista da migração 0120).
export const DETAIL_HEADER_REFS: ReadonlySet<string> = new Set([
  "title",
  "record_type",
  "source_system",
]);

// Colunas núcleo com input próprio no bloco editável do RecordEditForm — a
// grade read-only "Demais dados do registro" não as repete.
export const DETAIL_EDITABLE_CORE_REFS: ReadonlySet<string> = new Set([
  "stage",
  "channel",
  "value",
  "mrr",
  "currency",
  "responsible_id",
  "operation_id",
  "related_lead_id",
]);

export const CORE_DISPLAY_REFS: readonly string[] = CORE_FIELDS.map(
  (f) => f.field
).filter((ref) => !DETAIL_HEADER_REFS.has(ref));

const CORE_LABELS = new Map(CORE_FIELDS.map((f) => [f.field, f.label]));
const CORE_ORDER = new Map(CORE_FIELDS.map((f, i) => [f.field, i]));
const NUMERIC_CORE = new Set(
  CORE_FIELDS.filter((f) => f.isNumeric).map((f) => f.field)
);

function coreDefMap(coreDefs?: CoreDefLite[]): Map<string, CoreDefLite> {
  return new Map((coreDefs ?? []).map((d) => [d.field_key, d]));
}

// Ordena refs núcleo pelo sort_order da linha core (0086) quando presente;
// refs sem linha vão depois, na ordem estática de CORE_FIELDS.
export function orderCoreRefs(
  refs: string[],
  coreDefs?: CoreDefLite[]
): string[] {
  const defs = coreDefMap(coreDefs);
  const key = (ref: string): [number, number] => {
    const so = defs.get(ref)?.sort_order;
    return typeof so === "number"
      ? [0, so]
      : [1, CORE_ORDER.get(ref) ?? CORE_FIELDS.length];
  };
  return [...refs].sort((a, b) => {
    const [ga, ka] = key(a);
    const [gb, kb] = key(b);
    return ga !== gb ? ga - gb : ka !== kb ? ka - kb : 0;
  });
}

// Rótulo da coluna núcleo: linha core do /campos (0086) vence o estático.
export function coreRefLabel(ref: string, coreDefs?: CoreDefLite[]): string {
  return coreDefMap(coreDefs).get(ref)?.label ?? CORE_LABELS.get(ref) ?? ref;
}

export function isNumericCoreRef(ref: string): boolean {
  return NUMERIC_CORE.has(ref);
}

export const STAGE_SEMANTIC_LABELS: Record<string, string> = {
  open: "Aberto",
  won: "Ganho",
  lose: "Perdido",
};

// Valor de exibição de uma coluna núcleo — recordCellValue já formata data/
// moeda/booleano/FKs; stage_semantic ganha o rótulo pt-BR por cima.
export function coreCellValue(
  record: RecordRow,
  ref: string,
  labels: RecordLabels
): string {
  if (ref === "stage_semantic") {
    const raw = record.stage_semantic;
    if (raw == null || raw === "") return "—";
    return STAGE_SEMANTIC_LABELS[raw] ?? String(raw);
  }
  return recordCellValue(record, ref, [], labels);
}

// ---------------------------------------------------------------------------
// Colunas da tabela de /registros

// Colunas núcleo dirigidas por dados: interseção das populadas (0120) com as
// refs de exibição, na ordem do /campos. `populated` null (RPC indisponível)
// cai no fallback informado pela page (conjunto legado por fonte).
export function tableCoreColumns(
  populated: PopulatedRefs | null,
  coreDefs?: CoreDefLite[],
  fallback: string[] = []
): string[] {
  if (!populated) return fallback;
  const set = new Set(populated.core);
  return orderCoreRefs(
    CORE_DISPLAY_REFS.filter((r) => set.has(r)),
    coreDefs
  );
}

// Colunas custom: sem valor por registro (calculado_agg) nunca; ACL preservado
// (`visible`); entra quando aplica-se à base OU quando está populada nela.
export function tableCustomFields<
  T extends Pick<FieldDefinition, "field_key" | "data_type">,
>(
  defs: T[],
  opts: {
    applies: (f: T) => boolean;
    visible: (f: T) => boolean;
    populatedCustom: ReadonlySet<string>;
  }
): T[] {
  return defs.filter(
    (f) =>
      f.data_type !== "calculado_agg" &&
      opts.visible(f) &&
      (opts.applies(f) || opts.populatedCustom.has(f.field_key))
  );
}

// ---------------------------------------------------------------------------
// Painel de detalhe

export interface CoreDetailRow {
  ref: string;
  label: string;
}

// Linhas da grade núcleo do detalhe: todas as refs de exibição presentes no
// objeto (selects parciais pulam a linha), fora as de `skip`, ordenadas/
// rotuladas pelo /campos.
export function coreDetailRows(
  record: RecordRow,
  coreDefs: CoreDefLite[] | undefined,
  skip: ReadonlySet<string>
): CoreDetailRow[] {
  const rec = record as unknown as Record<string, unknown>;
  const refs = CORE_DISPLAY_REFS.filter(
    (ref) => !skip.has(ref) && ref in rec
  );
  return orderCoreRefs(refs, coreDefs).map((ref) => ({
    ref,
    label: coreRefLabel(ref, coreDefs),
  }));
}

// Chaves de custom_fields com valor mas sem definição alguma (nem restrita por
// papel — o chamador passa knownKeys PRÉ-ACL de propósito, senão valor de campo
// restrito vazaria por aqui como "órfão").
export function orphanCustomKeys(
  custom: Record<string, unknown> | null | undefined,
  knownKeys: Iterable<string>
): string[] {
  if (!custom) return [];
  const known = new Set(knownKeys);
  return Object.keys(custom)
    .filter((k) => !known.has(k))
    .filter((k) => {
      const v = custom[k];
      return v != null && String(v) !== "";
    })
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}
