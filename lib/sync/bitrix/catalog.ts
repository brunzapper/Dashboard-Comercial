// Versão: 1.5 | Data: 19/07/2026
// v1.5 (19/07/2026): loga o erro do upsert final de field_definitions (antes
//   engolido) — uma violação do índice único (source_system, source_field_id)
//   derruba o upsert inteiro em silêncio e nenhum campo novo aparece (0076).
// v1.4 (18/07/2026): campos curados de tipo "source" (SOURCE_ID → `fonte`) viram
//   data_type 'selecao' com as origens resolvidas como options (o schema diz
//   crm_status, que cairia em texto sem options).
// v1.3 (15/07/2026): preserva show_as_percent (toggle do admin) no upsert do
//   catálogo — sem isso todo sync resetaria o flag para false.
// v1.1 (09/07/2026): Fase 8 — grava applies_to (record_type de origem) e usa o
//   label curado (bitrix-field-map) como fallback do título do schema.
// v1.2 (09/07/2026): Fase 8b — FIELD_LABELS é AUTORITATIVO (vence o título do
//   schema, que às vezes volta como o próprio fieldId) e define os campos que
//   nascem visíveis (show_in_builder) — tanto curados quanto descobertos.
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
  FIELD_LABELS,
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
  applies_to: string[]; // record_type(s) a que a coluna pertence
}

function catalogRowsFor(lookups: BitrixLookups, entity: Entity): CatalogRow[] {
  const coreIds = coreIdsOf(entity);
  const curated = curatedOf(entity);
  const metas = entity === "deal" ? lookups.dealFieldMetas() : lookups.leadFieldMetas();
  const metaById = new Map(metas.map((m) => [m.fieldId, m]));
  const recordType = entity === "deal" ? "negocio" : "lead";

  const rows: CatalogRow[] = [];

  // Curados: chave curada, ligados por padrão (já eram usáveis). Têm precedência
  // sobre a exclusão do núcleo (ex.: Data da assinatura).
  for (const [fieldId, def] of Object.entries(curated)) {
    const meta = metaById.get(fieldId);
    // Tipo curado "source" (SOURCE_ID): o schema devolve crm_status (sem items,
    // cairia em texto) — vira seleção com as origens resolvidas como options.
    const isSource = def.type === "source";
    rows.push({
      field_key: def.key,
      label: FIELD_LABELS[fieldId] ?? meta?.title ?? def.key,
      data_type: isSource ? "selecao" : meta ? toDataType(meta.type) : "texto",
      options: isSource
        ? lookups.sourceNames()
        : (meta?.items?.map((i) => i.VALUE) ?? []),
      source_system: "bitrix",
      source_field_id: fieldId,
      show_in_builder: true,
      applies_to: [recordType],
    });
  }

  // Descobertos: chave bitrix_<id>. Nascem VISÍVEIS quando estão na lista
  // FIELD_LABELS (campos que o cliente quer ver, com nome visual); o resto
  // continua oculto por padrão. show_in_builder só é gravado no INSERT
  // (syncFieldCatalog), então a curadoria posterior do admin é preservada.
  for (const meta of metas) {
    if (coreIds.has(meta.fieldId)) continue;
    if (curated[meta.fieldId]) continue;
    const listed = FIELD_LABELS[meta.fieldId] != null;
    rows.push({
      field_key: bitrixKey(meta.fieldId),
      label: FIELD_LABELS[meta.fieldId] ?? meta.title,
      data_type: toDataType(meta.type),
      options: meta.type === "enumeration" ? meta.items?.map((i) => i.VALUE) ?? [] : [],
      source_system: "bitrix",
      source_field_id: meta.fieldId,
      show_in_builder: listed,
      applies_to: [recordType],
    });
  }

  return rows;
}

/**
 * Cataloga (upsert) os campos de negócios e leads em field_definitions.
 * Insere ausentes com o show_in_builder correto (campos money nascem com
 * currency_mode='inherit' — moeda do registro); nos existentes atualiza APENAS
 * label/options/data_type/source_*, preservando os toggles do admin
 * (show_in_builder, visible_to_roles, editable_by_roles, formula, sort_order,
 * currency_mode/currency_code).
 */
export async function syncFieldCatalog(
  db: SupabaseClient,
  lookups: BitrixLookups
): Promise<void> {
  const all = [...catalogRowsFor(lookups, "deal"), ...catalogRowsFor(lookups, "lead")];

  // Dedup por field_key (ex.: grupo_origem/utm_* aparecem em deal e lead).
  // Ao encontrar o mesmo field_key nas duas entidades, une os applies_to
  // (a coluna passa a valer para lead E negócio).
  const byKey = new Map<string, CatalogRow>();
  for (const r of all) {
    const ex = byKey.get(r.field_key);
    if (!ex) byKey.set(r.field_key, { ...r });
    else ex.applies_to = Array.from(new Set([...ex.applies_to, ...r.applies_to]));
  }
  const rows = Array.from(byKey.values());
  if (rows.length === 0) return;

  const keys = rows.map((r) => r.field_key);
  // Lê os toggles do admin dos campos já existentes para PRESERVÁ-LOS no upsert
  // (show_in_builder/visible_to_roles/editable_by_roles/is_local/formula/sort_order).
  const { data: existing } = await db
    .from("field_definitions")
    .select(
      "field_key, show_in_builder, visible_to_roles, editable_by_roles, is_local, formula, sort_order, write_back, currency_mode, currency_code, show_as_percent"
    )
    .in("field_key", keys);
  const existingByKey = new Map(
    (existing ?? []).map((r) => [r.field_key as string, r])
  );

  // Um único upsert (em vez de ~400 updates concorrentes): sempre atualiza
  // label/data_type/options/source_*/applies_to; nos existentes carrega os
  // toggles atuais, nos novos aplica os defaults.
  const payload = rows.map((r) => {
    const ex = existingByKey.get(r.field_key) as
      | {
          show_in_builder?: boolean;
          visible_to_roles?: string[];
          editable_by_roles?: string[];
          is_local?: boolean;
          formula?: unknown;
          sort_order?: number;
          write_back?: boolean;
          currency_mode?: string | null;
          currency_code?: string | null;
          show_as_percent?: boolean;
        }
      | undefined;
    return {
      field_key: r.field_key,
      label: r.label,
      data_type: r.data_type,
      options: r.options,
      source_system: r.source_system,
      source_field_id: r.source_field_id,
      applies_to: r.applies_to,
      show_in_builder: ex ? ex.show_in_builder ?? r.show_in_builder : r.show_in_builder,
      visible_to_roles: ex ? ex.visible_to_roles ?? [] : [],
      editable_by_roles: ex ? ex.editable_by_roles ?? [] : [],
      is_local: ex ? ex.is_local ?? false : false,
      formula: ex ? ex.formula ?? null : null,
      sort_order: ex ? ex.sort_order ?? 0 : 0,
      write_back: ex ? ex.write_back ?? false : false,
      // Moeda: campo money novo nasce herdando a moeda do registro; nos
      // existentes preserva a configuração do admin (inherit/fixed).
      currency_mode: ex
        ? ex.currency_mode ?? null
        : r.data_type === "moeda"
          ? "inherit"
          : null,
      currency_code: ex ? ex.currency_code ?? null : null,
      // Exibição percentual: toggle do admin — preservado no upsert (novo nasce
      // desligado). Sem isto, todo sync resetaria o flag para false.
      show_as_percent: ex ? ex.show_as_percent ?? false : false,
    };
  });

  const { error } = await db
    .from("field_definitions")
    .upsert(payload, { onConflict: "field_key" });
  // Não aborta o sync: um catálogo desatualizado é preferível a um sync parado.
  // Mas a falha precisa aparecer nos logs — um conflito com o índice único
  // (source_system, source_field_id) da 0017 derruba o upsert INTEIRO e, calado,
  // vira "campo novo nunca aparece" (ver manual §4.6).
  if (error) {
    console.error(`syncFieldCatalog: upsert de field_definitions falhou: ${error.message}`);
  }
}
