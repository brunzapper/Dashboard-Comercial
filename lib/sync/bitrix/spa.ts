// Versão: 1.0 | Data: 11/10/2026
// PROCESSOS INTELIGENTES do Bitrix (Smart Process Automation, 0155) — o lado
// servidor: descobrir os processos do portal, ler o schema de um processo,
// buscar uma AMOSTRA sem gravar nada, carregar as Bases SPA aprovadas para o
// sync e catalogar os campos escolhidos.
//
// A API é a `crm.item.*` (camelCase, `entityTypeId` em todo método, lista em
// `result.items`), diferente da `crm.deal.*`/`crm.lead.*` que o resto do sync
// usa — por isso o mapeamento vive em `mapSpaItem` (mapper.ts) e não em
// `mapDeal`. O que é COMPARTILHADO não é copiado: o upsert de registros
// (`upsertPage`), o upsert preservador do catálogo (`upsertCatalogRows`), a
// resolução de usuário/empresa/origem (`BitrixLookups`).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { BitrixFieldMeta } from "./lookups";
import { spaFieldType, type SpaMapContext, type SpaMapEntry } from "./mapper";
import { upsertCatalogRows, type CatalogRow } from "./catalog";
import {
  parseSpaConfig,
  spaSourceFieldId,
  type SpaSourceConfig,
} from "./spa-config";
import type { BitrixCallable } from "./task-mirror";

/** Um processo inteligente do portal (`crm.type.list`). */
export interface SpaTypeInfo {
  entityTypeId: number;
  title: string;
  isCategoriesEnabled: boolean;
}

/** Schema de um processo: campos + funis. */
export interface SpaSchema {
  entityTypeId: number;
  fields: BitrixFieldMeta[];
  /** categoryId → nome do funil. */
  categories: Record<string, string>;
}

interface RawItemField {
  type?: string;
  title?: string;
  isReadOnly?: boolean;
  isMultiple?: boolean;
  items?: { ID: string | number; VALUE: string }[];
}

/** Lista os processos inteligentes do portal, pelo nome. */
export async function listSpaTypes(api: BitrixCallable): Promise<SpaTypeInfo[]> {
  const out: SpaTypeInfo[] = [];
  let start = 0;
  for (let page = 0; page < 10; page++) {
    const res = (await api.call<{ types?: Record<string, unknown>[] }>(
      "crm.type.list",
      { start }
    )) as { result: { types?: Record<string, unknown>[] }; next?: number };
    for (const t of res.result?.types ?? []) {
      const id = Number(t.entityTypeId);
      if (!Number.isInteger(id) || id <= 0) continue;
      out.push({
        entityTypeId: id,
        title: String(t.title ?? `Processo #${id}`),
        isCategoriesEnabled: t.isCategoriesEnabled === true || t.isCategoriesEnabled === "Y",
      });
    }
    if (typeof res.next !== "number") break;
    start = res.next;
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
}

/** Campos + funis de um processo. */
export async function loadSpaSchema(
  api: BitrixCallable,
  entityTypeId: number
): Promise<SpaSchema> {
  const fieldsRes = await api.call<{ fields?: Record<string, RawItemField> }>(
    "crm.item.fields",
    { entityTypeId }
  );
  const fields: BitrixFieldMeta[] = [];
  for (const [fieldId, def] of Object.entries(fieldsRes.result?.fields ?? {})) {
    if (!def || typeof def !== "object") continue;
    fields.push({
      fieldId,
      title: String(def.title || fieldId),
      type: String(def.type ?? "string"),
      isMultiple: Boolean(def.isMultiple),
      isReadOnly: Boolean(def.isReadOnly),
      items: Array.isArray(def.items)
        ? def.items.map((i) => ({ ID: String(i.ID), VALUE: String(i.VALUE) }))
        : undefined,
    });
  }

  const categories: Record<string, string> = {};
  try {
    const catRes = await api.call<{ categories?: { id: number | string; name: string }[] }>(
      "crm.category.list",
      { entityTypeId }
    );
    for (const c of catRes.result?.categories ?? []) {
      categories[String(c.id)] = String(c.name);
    }
  } catch {
    // Processo sem funis habilitados: o item vem sem categoryId útil.
  }
  return { entityTypeId, fields, categories };
}

/** Contagem total de itens (para a lista da triagem). */
export async function countSpaItems(
  api: BitrixCallable,
  entityTypeId: number
): Promise<number | null> {
  try {
    const res = (await api.call<{ items?: unknown[] }>("crm.item.list", {
      entityTypeId,
      select: ["id"],
      start: 0,
    })) as { result: { items?: unknown[] }; total?: number };
    return typeof res.total === "number" ? res.total : (res.result?.items?.length ?? 0);
  } catch {
    return null;
  }
}

/** Amostra ao vivo — os itens mais recentes, sem gravar NADA. */
export async function fetchSpaSample(
  api: BitrixCallable,
  entityTypeId: number,
  opts: { limit?: number; categoryIds?: string[] } = {}
): Promise<{ items: Record<string, unknown>[]; total: number | null }> {
  const filter: Record<string, unknown> = {};
  if (opts.categoryIds && opts.categoryIds.length > 0) {
    filter["@categoryId"] = opts.categoryIds.map(Number);
  }
  const res = (await api.call<{ items?: Record<string, unknown>[] }>("crm.item.list", {
    entityTypeId,
    filter,
    select: ["*", "uf*"],
    order: { id: "DESC" },
    start: 0,
  })) as { result: { items?: Record<string, unknown>[] }; total?: number };
  const items = (res.result?.items ?? []).slice(0, opts.limit ?? 20);
  return { items, total: typeof res.total === "number" ? res.total : null };
}

/** Mapa campo → entrada do mapper, a partir da config APROVADA + schema vivo. */
export function spaMappingFor(
  schema: SpaSchema,
  config: SpaSourceConfig
): SpaMapEntry[] {
  const byId = new Map(schema.fields.map((f) => [f.fieldId, f]));
  const out: SpaMapEntry[] = [];
  for (const choice of config.fields) {
    const meta = byId.get(choice.id);
    // Campo excluído do processo depois da aprovação: sai do mapa (o valor
    // gravado fica no registro; o catálogo não é apagado).
    if (!meta) continue;
    const type = spaFieldType(choice.id, meta.type);
    out.push({
      fieldId: choice.id,
      key: choice.key,
      type,
      ...(type === "enumeration" && meta.items
        ? { items: Object.fromEntries(meta.items.map((i) => [i.ID, i.VALUE])) }
        : {}),
    });
  }
  return out;
}

/** Uma Base SPA aprovada, como o sync a enxerga. */
export interface SpaSyncSource {
  key: string;
  recordType: string;
  label: string;
  orgId: string | null;
  entityTypeId: number;
  timezone: string | null;
  config: SpaSourceConfig;
  /** Carga inicial já concluída? Não ⇒ o job lê o processo inteiro. */
  loaded: boolean;
}

/**
 * Bases SPA aprovadas. Erro de select (migração 0155 não aplicada) ⇒ [] — o
 * sync de leads/negócios nunca para por causa disso.
 */
export async function loadSpaSyncSources(db: SupabaseClient): Promise<SpaSyncSource[]> {
  const { data, error } = await db
    .from("data_sources")
    .select(
      "key, record_type, label, organization_id, timezone, bitrix_entity_type_id, bitrix_spa_config, bitrix_spa_loaded_at"
    )
    .not("bitrix_entity_type_id", "is", null);
  if (error || !data) return [];
  const out: SpaSyncSource[] = [];
  for (const r of data) {
    const config = parseSpaConfig(r.bitrix_spa_config);
    const typeId = Number(r.bitrix_entity_type_id);
    if (!config || !Number.isInteger(typeId) || typeId <= 0) continue;
    out.push({
      key: r.key as string,
      recordType: r.record_type as string,
      label: (r.label as string) || (r.key as string),
      orgId: (r.organization_id as string | null) ?? null,
      entityTypeId: typeId,
      timezone: (r.timezone as string | null) || null,
      config,
      loaded: r.bitrix_spa_loaded_at != null,
    });
  }
  return out;
}

/** data_type do app para um campo do processo. */
function spaDataType(meta: BitrixFieldMeta, fieldId: string): string {
  const t = spaFieldType(fieldId, meta.type);
  switch (t) {
    case "enumeration":
    case "source":
      return "selecao";
    case "money":
      return "moeda";
    case "double":
      return "numero";
    case "date":
    case "datetime":
      return "data";
    case "boolean":
      return "booleano";
    default:
      return "texto";
  }
}

/**
 * Cataloga (upsert preservador) os campos ESCOLHIDOS de uma Base SPA, na org
 * dela. Campo novo nasce visível no construtor e com write-back ligado quando o
 * Bitrix permite escrever nele (pedido do usuário: edição volta ao CRM).
 */
export async function syncSpaFieldCatalog(
  db: SupabaseClient,
  source: SpaSyncSource,
  schema: SpaSchema,
  sourceNames: string[] = []
): Promise<void> {
  const byId = new Map(schema.fields.map((f) => [f.fieldId, f]));
  const rows: CatalogRow[] = [];
  for (const choice of source.config.fields) {
    const meta = byId.get(choice.id);
    if (!meta) continue;
    const dataType = spaDataType(meta, choice.id);
    rows.push({
      field_key: choice.key,
      label: choice.label,
      data_type: dataType,
      options:
        choice.id === "sourceId"
          ? sourceNames
          : dataType === "selecao"
            ? (meta.items ?? []).map((i) => i.VALUE)
            : [],
      source_system: "bitrix",
      source_field_id: spaSourceFieldId(source.entityTypeId, choice.id),
      show_in_builder: true,
      applies_to: [source.recordType],
      write_back: !meta.isReadOnly,
    });
  }
  await upsertCatalogRows(db, rows, source.orgId);
}

/** Contexto do mapper (serializável no job) de uma Base SPA. */
export function spaMapContext(source: SpaSyncSource, schema: SpaSchema): SpaMapContext {
  return {
    recordType: source.recordType,
    entityTypeId: source.entityTypeId,
    mapping: spaMappingFor(schema, source.config),
    categories: schema.categories,
  };
}
