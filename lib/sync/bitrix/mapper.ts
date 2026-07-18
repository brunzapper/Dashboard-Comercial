// Versão: 1.3 | Data: 18/07/2026
// v1.3 (18/07/2026): resolveCustom trata o tipo "source" (SOURCE_ID → nome da
//   origem via BitrixLookups.sourceName).
// Tradução de um DEAL/LEAD cru do Bitrix para o formato do núcleo `records`,
// usando o field map (lib/config/bitrix-field-map) e os lookups. Campos
// auxiliares com prefixo `_` não são colunas — servem ao orquestrador do sync
// (owner/responsável, lead relacionado, data de referência do lead time).
// v1.1 (05/07/2026): mapLead passa a capturar custom_fields.email (multifield
//   EMAIL do Bitrix) — necessário para o match de lead relacionado por e-mail
//   das vendas do site (Fase 3).
// v1.2 (09/07/2026): Fase 7 — mapDeal/mapLead recebem o mapa dinâmico de
//   colunas (lib/sync/bitrix/catalog) e extraem TODOS os campos do Bitrix para
//   custom_fields (não só os curados de DEAL_CUSTOM/LEAD_CUSTOM).
import {
  DEAL_CORE,
  LEAD_CORE,
  type BitrixFieldType,
} from "@/lib/config/bitrix-field-map";
import type { CustomMapEntry } from "./catalog";
import { BitrixLookups } from "./lookups";

export interface MappedRecord {
  record_type: "lead" | "negocio";
  source_system: "bitrix";
  source_id: string;
  title: string | null;
  pipeline: string | null;
  stage: string | null;
  stage_semantic: string | null;
  value: number | null;
  mrr: number | null;
  currency: string | null;
  sale_type: string | null;
  channel: string | null;
  closed: boolean;
  closed_at: string | null;
  opened_at: string | null;
  source_created_at: string | null;
  source_modified_at: string | null;
  custom_fields: Record<string, unknown>;
  // auxiliares (não são colunas de records):
  _assignedById: string | null;
  _leadId: string | null;
  _signatureDate: string | null;
}

type Raw = Record<string, unknown>;

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function parseNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// Campos "money" do Bitrix vêm como "1234.56|BRL".
function parseMoney(v: unknown): number | null {
  if (v == null || v === "") return null;
  const first = String(v).split("|")[0];
  const n = parseFloat(first);
  return Number.isNaN(n) ? null : n;
}

function parseBool(v: unknown): boolean {
  return v === "Y" || v === "1" || v === 1 || v === true;
}

function dateOrNull(v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = String(v);
  if (s.startsWith("0000-00-00")) return null;
  return s;
}

function mapSemantic(v: unknown): string | null {
  switch (v) {
    case "S":
      return "won";
    case "F":
      return "lose";
    case "P":
      return "open";
    default:
      return null;
  }
}

async function resolveCustom(
  ufKey: string,
  type: BitrixFieldType,
  val: unknown,
  lookups: BitrixLookups,
  entity: "deal" | "lead"
): Promise<unknown> {
  if (val == null || val === "") return null;

  const enumLabel = (id: unknown) =>
    entity === "deal"
      ? lookups.dealEnumLabel(ufKey, id as string)
      : lookups.leadEnumLabel(ufKey, id as string);

  switch (type) {
    case "enumeration":
      if (Array.isArray(val)) {
        return val.map((x) => enumLabel(x)).filter(Boolean).join(", ");
      }
      return enumLabel(val);
    case "employee":
      return lookups.userName(val as string);
    case "company":
      return lookups.companyName(val as string);
    case "source":
      return lookups.sourceName(val as string);
    case "money":
      return parseMoney(val);
    case "double":
      return parseNum(val);
    case "boolean":
      return parseBool(val);
    case "date":
    case "datetime":
      return dateOrNull(val);
    default:
      // Multifields (arrays) sem tipo conhecido não viram texto útil.
      if (Array.isArray(val)) return null;
      return strOrNull(val);
  }
}

async function resolveMapping(
  raw: Raw,
  mapping: CustomMapEntry[],
  lookups: BitrixLookups,
  entity: "deal" | "lead"
): Promise<Record<string, unknown>> {
  const custom_fields: Record<string, unknown> = {};
  for (const entry of mapping) {
    custom_fields[entry.key] = await resolveCustom(
      entry.fieldId,
      entry.type,
      raw[entry.fieldId],
      lookups,
      entity
    );
  }
  return custom_fields;
}

export async function mapDeal(
  raw: Raw,
  lookups: BitrixLookups,
  mapping: CustomMapEntry[]
): Promise<MappedRecord> {
  const custom_fields = await resolveMapping(raw, mapping, lookups, "deal");

  return {
    record_type: "negocio",
    source_system: "bitrix",
    source_id: String(raw[DEAL_CORE.sourceId]),
    title: strOrNull(raw[DEAL_CORE.title]),
    pipeline: lookups.categoryName(raw[DEAL_CORE.categoryId] as string),
    stage: lookups.statusName(raw[DEAL_CORE.stageId] as string, "deal"),
    stage_semantic: mapSemantic(raw[DEAL_CORE.stageSemantic]),
    value: parseNum(raw[DEAL_CORE.value]),
    mrr: parseMoney(raw[DEAL_CORE.mrr]),
    currency: strOrNull(raw[DEAL_CORE.currency]),
    sale_type: lookups.dealEnumLabel(
      DEAL_CORE.saleType,
      raw[DEAL_CORE.saleType] as string
    ),
    channel: strOrNull(raw[DEAL_CORE.channel]),
    closed: parseBool(raw[DEAL_CORE.closed]),
    closed_at: dateOrNull(raw[DEAL_CORE.closedAt]),
    opened_at: dateOrNull(raw[DEAL_CORE.openedAt]),
    source_created_at: dateOrNull(raw[DEAL_CORE.sourceCreatedAt]),
    source_modified_at: dateOrNull(raw[DEAL_CORE.sourceModifiedAt]),
    custom_fields,
    _assignedById: strOrNull(raw[DEAL_CORE.assignedById]),
    _leadId: strOrNull(raw[DEAL_CORE.leadId]),
    _signatureDate: dateOrNull(raw[DEAL_CORE.signatureDate]),
  };
}

// EMAIL é um multifield do Bitrix: array de {VALUE, VALUE_TYPE, ...}. Usamos o
// primeiro e-mail — é o que a Fase 3 (sync de Sheets) usa para casar a venda
// do site com o lead de origem.
function firstEmail(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const first = v[0] as { VALUE?: unknown } | undefined;
  return strOrNull(first?.VALUE);
}

export async function mapLead(
  raw: Raw,
  lookups: BitrixLookups,
  mapping: CustomMapEntry[]
): Promise<MappedRecord> {
  const custom_fields = await resolveMapping(raw, mapping, lookups, "lead");
  custom_fields.email = firstEmail(raw["EMAIL"]);

  return {
    record_type: "lead",
    source_system: "bitrix",
    source_id: String(raw[LEAD_CORE.sourceId]),
    title: strOrNull(raw[LEAD_CORE.title]) ?? strOrNull(raw[LEAD_CORE.companyTitle]),
    pipeline: null,
    stage: lookups.statusName(raw[LEAD_CORE.stageId] as string, "lead"),
    stage_semantic: mapSemantic(raw["STATUS_SEMANTIC_ID"]),
    value: parseNum(raw[LEAD_CORE.value]),
    mrr: null,
    currency: strOrNull(raw[LEAD_CORE.currency]),
    sale_type: null,
    channel: null,
    closed: false,
    closed_at: null,
    opened_at: null,
    source_created_at: dateOrNull(raw[LEAD_CORE.sourceCreatedAt]),
    source_modified_at: dateOrNull(raw[LEAD_CORE.sourceModifiedAt]),
    custom_fields,
    _assignedById: strOrNull(raw[LEAD_CORE.assignedById]),
    _leadId: null,
    _signatureDate: null,
  };
}
