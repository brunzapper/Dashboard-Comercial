// Versão: 1.0 | Data: 09/07/2026
// Descoberta dinâmica de colunas do Bitrix (Fase 7). Usa o schema de
// crm.deal.fields / crm.lead.fields (carregado em BitrixLookups) para:
//   1) catalogar TODOS os campos como field_definitions (syncFieldCatalog) —
//      colunas novas do Bitrix entram sozinhas no próximo sync;
//   2) montar o mapa fonte→custom_fields que o mapper usa (buildCustomMapping).
// Campos já mapeados para colunas do núcleo (DEAL_CORE/LEAD_CORE) são ignorados.
// Chaves curadas de DEAL_CUSTOM/LEAD_CUSTOM são preservadas (retrocompat com
// widgets/records existentes); o resto recebe a chave estável `bitrix_<id>`.
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEAL_CORE,
  DEAL_CUSTOM,
  LEAD_CORE,
  LEAD_CUSTOM,
  type BitrixFieldType,
  type CustomFieldMap,
} from "@/lib/config/bitrix-field-map";
import type { BitrixLookups } from "./lookups";

export type Entity = "deal" | "lead";

export interface CustomMapEntry {
  fieldId: string;
  key: string;
  type: BitrixFieldType;
}

function slug(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function bitrixKey(fieldId: string): string {
  return `bitrix_${slug(fieldId)}`.slice(0, 60);
}

// Tipo bruto do Bitrix → tipo de resolução do mapper (resolveCustom).
function toBitrixFieldType(raw: string): BitrixFieldType {
  switch (raw) {
    case "enumeration": return "enumeration";
    case "user":
    case "employee": return "employee";
    case "money": return "money";
    case "double":
    case "integer": return "double";
    case "date": return "date";
    case "datetime": return "datetime";
    case "boolean":
    case "char": return "boolean";
    default: return "string";
  }
}

// Tipo bruto do Bitrix → data_type do app (field_definitions).
function toDataType(raw: string): string {
  switch (raw) {
    case "enumeration": return "selecao";
    case "money": return "moeda";
    case "double":
    case "integer": return "numero";
    case "date":
    case "datetime": return "data";
    case "boolean":
    case "char": return "booleano";
    default: return "texto";
  }
}

function coreIdsOf(entity: Entity): Set<string> {
  const core = entity === "deal" ? DEAL_CORE : LEAD_CORE;
  return new Set(Object.values(core) as string[]);
}

function curatedOf(entity: Entity): Record<string, CustomFieldMap> {
  return entity === "deal" ? DEAL_CUSTOM : LEAD_CUSTOM;
}

/**
 * Mapa fonte→custom_fields para o mapper. Chaves curadas primeiro (garantidas
 * mesmo que o campo não apareça no schema), depois os descobertos, excluindo os
 * ids que já são colunas do núcleo. Uma entrada curada tem precedência sobre a
 * exclusão do núcleo — é uma decisão explícita de expor o campo (ex.: a Data da
 * assinatura, que também é usada como referência do lead time).
 */
export function buildCustomMapping(
  lookups: BitrixLookups,
  entity: Entity
): CustomMapEntry[] {
  const coreIds = coreIdsOf(entity);
  const curated = curatedOf(entity);
  const metas = entity === "deal" ? lookups.dealFieldMetas() : lookups.leadFieldMetas();

  const byId = new Map<string, CustomMapEntry>();
  for (const [fieldId, def] of Object.entries(curated)) {
    byId.set(fieldId, { fieldId, key: def.key, type: def.type });
  }
  for (const meta of metas) {
    if (coreIds.has(meta.fieldId)) continue;
    if (byId.has(meta.fieldId)) continue;
    byId.set(meta.fieldId, {
      fieldId: meta.fieldId,
      key: bitrixKey(meta.fieldId),
      type: toBitrixFieldType(meta.type),
    });
  }
  return Array.from(byId.values());
}

interface CatalogRow {
  field_key: string;
  label: string;
  data_type: string;
  options: string[];
  source_system: "bitrix";
  source_field_id: string;
  show_in_builder: boolean; // usado só no INSERT
}

function catalogRowsFor(lookups: BitrixLookups, entity: Entity): CatalogRow[] {
  const coreIds = coreIdsOf(entity);
  const curated = curatedOf(entity);
  const metas = entity === "deal" ? lookups.dealFieldMetas() : lookups.leadFieldMetas();
  const metaById = new Map(metas.map((m) => [m.fieldId, m]));

  const rows: CatalogRow[] = [];

  // Curados: chave curada, ligados por padrão (já eram usáveis). Têm precedência
  // sobre a exclusão do núcleo (ex.: Data da assinatura).
  for (const [fieldId, def] of Object.entries(curated)) {
    const meta = metaById.get(fieldId);
    rows.push({
      field_key: def.key,
      label: meta?.title ?? def.key,
      data_type: meta ? toDataType(meta.type) : "texto",
      options: meta?.items?.map((i) => i.VALUE) ?? [],
      source_system: "bitrix",
      source_field_id: fieldId,
      show_in_builder: true,
    });
  }

  // Descobertos: chave bitrix_<id>, DESLIGADOS por padrão.
  for (const meta of metas) {
    if (coreIds.has(meta.fieldId)) continue;
    if (curated[meta.fieldId]) continue;
    rows.push({
      field_key: bitrixKey(meta.fieldId),
      label: meta.title,
      data_type: toDataType(meta.type),
      options: meta.type === "enumeration" ? meta.items?.map((i) => i.VALUE) ?? [] : [],
      source_system: "bitrix",
      source_field_id: meta.fieldId,
      show_in_builder: false,
    });
  }

  return rows;
}

/**
 * Cataloga (upsert) os campos de negócios e leads em field_definitions.
 * Insere ausentes com o show_in_builder correto; nos existentes atualiza APENAS
 * label/options/data_type/source_*, preservando os toggles do admin
 * (show_in_builder, visible_to_roles, editable_by_roles, formula, sort_order).
 */
export async function syncFieldCatalog(
  db: SupabaseClient,
  lookups: BitrixLookups
): Promise<void> {
  const all = [...catalogRowsFor(lookups, "deal"), ...catalogRowsFor(lookups, "lead")];

  // Dedup por field_key (ex.: grupo_origem/utm_* aparecem em deal e lead).
  const byKey = new Map<string, CatalogRow>();
  for (const r of all) if (!byKey.has(r.field_key)) byKey.set(r.field_key, r);
  const rows = Array.from(byKey.values());
  if (rows.length === 0) return;

  const keys = rows.map((r) => r.field_key);
  const { data: existing } = await db
    .from("field_definitions")
    .select("field_key")
    .in("field_key", keys);
  const existingSet = new Set((existing ?? []).map((r) => r.field_key as string));

  const toInsert = rows.filter((r) => !existingSet.has(r.field_key));
  if (toInsert.length > 0) {
    await db.from("field_definitions").insert(
      toInsert.map((r) => ({
        field_key: r.field_key,
        label: r.label,
        data_type: r.data_type,
        options: r.options,
        source_system: r.source_system,
        source_field_id: r.source_field_id,
        show_in_builder: r.show_in_builder,
        visible_to_roles: [],
        editable_by_roles: [],
        is_local: false,
      }))
    );
  }

  const toUpdate = rows.filter((r) => existingSet.has(r.field_key));
  await Promise.all(
    toUpdate.map((r) =>
      db
        .from("field_definitions")
        .update({
          label: r.label,
          data_type: r.data_type,
          options: r.options,
          source_system: r.source_system,
          source_field_id: r.source_field_id,
        })
        .eq("field_key", r.field_key)
    )
  );
}
