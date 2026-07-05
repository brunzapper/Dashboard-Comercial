// Versão: 1.0 | Data: 05/07/2026
// Tradução de um DEAL/LEAD cru do Bitrix para o formato do núcleo `records`,
// usando o field map (lib/config/bitrix-field-map) e os lookups. Campos
// auxiliares com prefixo `_` não são colunas — servem ao orquestrador do sync
// (owner/responsável, lead relacionado, data de referência do lead time).
import {
  DEAL_CORE,
  DEAL_CUSTOM,
  LEAD_CORE,
  LEAD_CUSTOM,
  type BitrixFieldType,
  type CustomFieldMap,
} from "@/lib/config/bitrix-field-map";
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
  def: CustomFieldMap,
  val: unknown,
  lookups: BitrixLookups,
  entity: "deal" | "lead"
): Promise<unknown> {
  if (val == null || val === "") return null;
  const type: BitrixFieldType = def.type;

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
      return strOrNull(val);
  }
}

export async function mapDeal(
  raw: Raw,
  lookups: BitrixLookups
): Promise<MappedRecord> {
  const custom_fields: Record<string, unknown> = {};
  for (const [ufKey, def] of Object.entries(DEAL_CUSTOM)) {
    custom_fields[def.key] = await resolveCustom(
      ufKey,
      def,
      raw[ufKey],
      lookups,
      "deal"
    );
  }

  return {
    record_type: "negocio",
    source_system: "bitrix",
    source_id: String(raw[DEAL_CORE.sourceId]),
    title: strOrNull(raw[DEAL_CORE.title]),
    pipeline: lookups.categoryName(raw[DEAL_CORE.categoryId] as string),
    stage: lookups.statusName(raw[DEAL_CORE.stageId] as string),
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

export async function mapLead(
  raw: Raw,
  lookups: BitrixLookups
): Promise<MappedRecord> {
  const custom_fields: Record<string, unknown> = {};
  for (const [ufKey, def] of Object.entries(LEAD_CUSTOM)) {
    custom_fields[def.key] = await resolveCustom(
      ufKey,
      def,
      raw[ufKey],
      lookups,
      "lead"
    );
  }

  return {
    record_type: "lead",
    source_system: "bitrix",
    source_id: String(raw[LEAD_CORE.sourceId]),
    title: strOrNull(raw[LEAD_CORE.title]) ?? strOrNull(raw[LEAD_CORE.companyTitle]),
    pipeline: null,
    stage: lookups.statusName(raw[LEAD_CORE.stageId] as string),
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
