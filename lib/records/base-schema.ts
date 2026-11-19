// Versão: 1.0 | Data: 19/11/2026
// ESQUEMA POR BASE (0156) — resolvedor ÚNICO de "que campos ESTE registro,
// DESTA Base, tem?".
//
// Antes da 0156 a resposta era `fieldAppliesToSource(applies_to)`, onde
// `applies_to` VAZIO significa "todas as Bases": campo "global" aparecia em
// toda Base (inclusive numa recém-criada), e as colunas do núcleo de negócio
// do Bitrix (pipeline, MRR, "Fechado?") apareciam em qualquer registro.
//
// Regras (pinadas em base-schema.test.ts):
//   - campo CUSTOM pertence à Base se `source_fields` tem `custom:<key>` para
//     ela OU se `applies_to` o DECLARA explicitamente para o record_type dela.
//     `applies_to` vazio deixa de significar "todas" — só entra pela linha;
//   - colunas do NÚCLEO formam o PERFIL da Base (`core:<coluna>`); uma coluna
//     fora do perfil só aparece num registro que TEM valor nela (dado nunca
//     some da tela);
//   - sub-base usa o esquema da Base PAI (fase 1);
//   - sem a tabela (migração não aplicada) ou com erro de leitura, o loader
//     devolve null e TODO consumidor cai no comportamento legado — deploy do
//     código antes da migração é seguro.
//
// Módulo PURO + loader com o client recebido (client-safe: só tipos do
// supabase-js). Escritores (sync/CSV/ingest) mantêm `source_fields` a partir
// da fase 2; até lá a declaração por `applies_to` cobre campo novo.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import {
  BUILTIN_SOURCES,
  fieldAppliesToSource,
  parentKeyOf,
  recordTypeOf,
  type SourceDef,
} from "@/lib/sources";

export type BaseFieldOrigin =
  | "core"
  | "bitrix"
  | "spa"
  | "csv"
  | "sheet"
  | "api"
  | "manual"
  | "calc";

/** Linha de `source_fields` (colunas usadas pelo app). */
export interface BaseSchemaRow {
  field_ref: string;
  label: string | null;
  sort_order: number | null;
  visible: boolean;
  origin: BaseFieldOrigin | string;
  origin_ref: string | null;
  removed_at: string | null;
}

export interface BaseSchema {
  /** Key da Base RAIZ dona do esquema (sub-base resolvida para a pai). */
  sourceKey: string;
  recordType: string;
  /** Colunas do núcleo no perfil da Base (sem o prefixo `core:`). */
  coreRefs: ReadonlySet<string>;
  /** Chaves custom no esquema (sem o prefixo `custom:`). */
  customKeys: ReadonlySet<string>;
  rows: ReadonlyMap<string, BaseSchemaRow>;
}

export const SOURCE_FIELDS_SELECT =
  "field_ref, label, sort_order, visible, origin, origin_ref, removed_at";

/** Monta o esquema a partir das linhas cruas (puro). */
export function buildBaseSchema(
  sourceKey: string,
  recordType: string,
  rows: readonly BaseSchemaRow[]
): BaseSchema {
  const coreRefs = new Set<string>();
  const customKeys = new Set<string>();
  const byRef = new Map<string, BaseSchemaRow>();
  for (const row of rows) {
    if (!row || typeof row.field_ref !== "string") continue;
    byRef.set(row.field_ref, row);
    if (row.field_ref.startsWith("core:")) coreRefs.add(row.field_ref.slice(5));
    else if (row.field_ref.startsWith("custom:"))
      customKeys.add(row.field_ref.slice(7));
  }
  return { sourceKey, recordType, coreRefs, customKeys, rows: byRef };
}

/** Key da Base raiz que guarda o esquema (sub-base → pai). */
export function schemaOwnerKey(
  sourceKey: string,
  sources: SourceDef[] = BUILTIN_SOURCES
): string {
  return parentKeyOf(sourceKey, sources) ?? sourceKey;
}

/**
 * O campo custom pertence à Base? Com `schema` null cai na regra legada
 * (`applies_to` vazio = todas). `sourceKey` é a Base pedida (sub-base ok).
 */
export function fieldBelongsToBase(
  schema: BaseSchema | null,
  def: Pick<FieldDefinition, "field_key" | "applies_to">,
  sourceKey: string,
  sources: SourceDef[] = BUILTIN_SOURCES
): boolean {
  if (!schema) return fieldAppliesToSource(def.applies_to, sourceKey, sources);
  if (schema.customKeys.has(def.field_key)) return true;
  const declared = def.applies_to ?? [];
  return (
    declared.length > 0 &&
    declared.includes(recordTypeOf(sourceKey, sources))
  );
}

/** Mesmo teste, mas a Base vem pelo record_type do registro (painéis). */
export function fieldBelongsToRecordType(
  schema: BaseSchema | null,
  def: Pick<FieldDefinition, "field_key" | "applies_to">,
  recordType: string
): boolean {
  if (!schema) {
    const at = def.applies_to ?? [];
    return at.length === 0 || at.includes(recordType);
  }
  if (schema.customKeys.has(def.field_key)) return true;
  const declared = def.applies_to ?? [];
  return declared.length > 0 && declared.includes(recordType);
}

/** A coluna do núcleo tem valor NESTE registro? (`closed` só se true.) */
export function coreHasValue(record: RecordRow, ref: string): boolean {
  const v = (record as unknown as Record<string, unknown>)[ref];
  if (ref === "closed") return v === true;
  if (v == null) return false;
  return typeof v === "string" ? v.trim() !== "" : true;
}

/**
 * A coluna do núcleo aparece para este registro? Perfil da Base OU valor no
 * próprio registro. Sem esquema (null) ⇒ legado: sempre.
 */
export function coreRefShown(
  schema: BaseSchema | null,
  ref: string,
  record: RecordRow
): boolean {
  if (!schema) return true;
  return schema.coreRefs.has(ref) || coreHasValue(record, ref);
}

/**
 * Perfil serializável (para Client Components): lista das colunas do núcleo
 * da Base, ou null = sem esquema (legado).
 */
export function coreProfileOf(schema: BaseSchema | null): string[] | null {
  return schema ? [...schema.coreRefs] : null;
}

/** Versão de `coreRefShown` sobre o perfil serializado. */
export function coreRefInProfile(
  profile: readonly string[] | null | undefined,
  ref: string,
  record: RecordRow
): boolean {
  if (!profile) return true;
  return profile.includes(ref) || coreHasValue(record, ref);
}

// ===================== Loaders =====================

async function readRows(
  db: SupabaseClient,
  ownerKey: string
): Promise<BaseSchemaRow[] | null> {
  const { data, error } = await db
    .from("source_fields")
    .select(SOURCE_FIELDS_SELECT)
    .eq("source_key", ownerKey);
  // Tabela ausente (migração 0156 não aplicada) ou falha: legado, nunca erro
  // na tela.
  if (error) return null;
  return (data ?? []) as BaseSchemaRow[];
}

/** Esquema da Base `sourceKey` (sub-base ⇒ o da pai). null = legado. */
export async function loadBaseSchema(
  db: SupabaseClient,
  sourceKey: string,
  sources: SourceDef[] = BUILTIN_SOURCES
): Promise<BaseSchema | null> {
  if (!sourceKey) return null;
  const owner = schemaOwnerKey(sourceKey, sources);
  const rows = await readRows(db, owner);
  if (!rows) return null;
  return buildBaseSchema(owner, recordTypeOf(owner, sources), rows);
}

/** Esquema pela Base dona do record_type (painel do registro). */
export async function loadBaseSchemaForRecordType(
  db: SupabaseClient,
  recordType: string
): Promise<BaseSchema | null> {
  if (!recordType) return null;
  const { data, error } = await db
    .from("data_sources")
    .select("key")
    .eq("record_type", recordType)
    .maybeSingle();
  if (error || !data?.key) return null;
  const rows = await readRows(db, data.key as string);
  if (!rows) return null;
  return buildBaseSchema(data.key as string, recordType, rows);
}
