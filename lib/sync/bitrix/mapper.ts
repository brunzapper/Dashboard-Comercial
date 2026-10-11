// Versão: 1.5 | Data: 11/10/2026
// v1.5 (11/10/2026): `mapSpaItem` — item de PROCESSO INTELIGENTE (crm.item.*,
//   0155). Campos em camelCase; `record_type` é o da Base aprovada; `source_id`
//   PREFIXADO pelo tipo (`spaSourceId` — ver lib/sync/bitrix/entities.ts);
//   etapa/semântica pelas etapas DYNAMIC_* dos lookups; só os campos da config
//   APROVADA entram em custom_fields (o resto do processo fica de fora).
// v1.4 (19/07/2026): fuso da fonte (data_sources.timezone) — valores DATETIME
//   são normalizados para o horário de Brasília na entrada (lib/date/normalize).
//   Campo Bitrix tipo `date` é calendário puro e NUNCA converte (recuaria um
//   dia). Colunas timestamptz do núcleo também passam pelo normalize — no-op
//   de instante, mantido por consistência de representação.
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
import { normalizeDateString } from "@/lib/date/normalize";
import type { CustomMapEntry } from "./catalog";
import { spaSourceId } from "./entities";
import { BitrixLookups } from "./lookups";

export interface MappedRecord {
  // v1.5: + record_type de Base de processo inteligente (identidade = key).
  record_type: string;
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

function dateOrNull(v: unknown, tz?: string | null): string | null {
  if (v == null || v === "") return null;
  const s = String(v);
  if (s.startsWith("0000-00-00")) return null;
  return normalizeDateString(s, tz ?? null);
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
  entity: "deal" | "lead",
  tz: string | null
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
      // Calendário puro: o dia escolhido no Bitrix É o dado — nunca converter.
      return dateOrNull(val);
    case "datetime":
      return dateOrNull(val, tz);
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
  entity: "deal" | "lead",
  tz: string | null
): Promise<Record<string, unknown>> {
  const custom_fields: Record<string, unknown> = {};
  for (const entry of mapping) {
    custom_fields[entry.key] = await resolveCustom(
      entry.fieldId,
      entry.type,
      raw[entry.fieldId],
      lookups,
      entity,
      tz
    );
  }
  return custom_fields;
}

export async function mapDeal(
  raw: Raw,
  lookups: BitrixLookups,
  mapping: CustomMapEntry[],
  tz: string | null = null
): Promise<MappedRecord> {
  const custom_fields = await resolveMapping(raw, mapping, lookups, "deal", tz);

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
    closed_at: dateOrNull(raw[DEAL_CORE.closedAt], tz),
    opened_at: dateOrNull(raw[DEAL_CORE.openedAt], tz),
    source_created_at: dateOrNull(raw[DEAL_CORE.sourceCreatedAt], tz),
    source_modified_at: dateOrNull(raw[DEAL_CORE.sourceModifiedAt], tz),
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
  mapping: CustomMapEntry[],
  tz: string | null = null
): Promise<MappedRecord> {
  const custom_fields = await resolveMapping(raw, mapping, lookups, "lead", tz);
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
    source_created_at: dateOrNull(raw[LEAD_CORE.sourceCreatedAt], tz),
    source_modified_at: dateOrNull(raw[LEAD_CORE.sourceModifiedAt], tz),
    custom_fields,
    _assignedById: strOrNull(raw[LEAD_CORE.assignedById]),
    _leadId: null,
    _signatureDate: null,
  };
}

// ------------------------- Processos inteligentes (v1.5) -------------------------

/** Um campo do processo que entra na Base (da config aprovada + o schema). */
export interface SpaMapEntry {
  fieldId: string;
  key: string;
  type: BitrixFieldType;
  /** Opções de enumeração (ID → VALUE) — os enums do item são por processo. */
  items?: Record<string, string>;
}

/** O que o mapper precisa saber do processo (serializável no job). */
export interface SpaMapContext {
  recordType: string;
  entityTypeId: number;
  mapping: SpaMapEntry[];
  /** categoryId → nome do funil (crm.category.list). */
  categories: Record<string, string>;
}

/**
 * Tipo do `crm.item.fields` → tipo de resolução do mapper. Diferente do deal,
 * aqui o schema já diz `crm_company`/`crm_status` — o `sourceId` é a origem.
 */
export function spaFieldType(fieldId: string, rawType: string): BitrixFieldType {
  if (fieldId === "sourceId") return "source";
  if (fieldId === "companyId" || rawType === "crm_company") return "company";
  switch (rawType) {
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

async function resolveSpaValue(
  entry: SpaMapEntry,
  val: unknown,
  lookups: BitrixLookups,
  tz: string | null
): Promise<unknown> {
  if (val == null || val === "") return null;
  if (entry.type === "enumeration") {
    const label = (id: unknown) => entry.items?.[String(id)] ?? String(id);
    if (Array.isArray(val)) return val.map(label).filter(Boolean).join(", ");
    return label(val);
  }
  if (Array.isArray(val) && entry.type !== "string") {
    // Múltiplo de tipo escalar (ex.: vários usuários): resolve cada um.
    const parts = await Promise.all(
      val.map((v) => resolveCustom(entry.fieldId, entry.type, v, lookups, "deal", tz))
    );
    return parts.filter((p) => p != null && p !== "").map(String).join(", ") || null;
  }
  if (Array.isArray(val)) {
    return val.map((v) => strOrNull(v)).filter(Boolean).join(", ") || null;
  }
  // O tipo nunca é "enumeration" aqui, então a entidade não é consultada.
  return resolveCustom(entry.fieldId, entry.type, val, lookups, "deal", tz);
}

function spaSemantic(code: string | null): string | null {
  if (code === "S") return "won";
  if (code === "F") return "lose";
  return code == null ? "open" : null;
}

export async function mapSpaItem(
  raw: Raw,
  ctx: SpaMapContext,
  lookups: BitrixLookups,
  tz: string | null = null
): Promise<MappedRecord> {
  const custom_fields: Record<string, unknown> = {};
  for (const entry of ctx.mapping) {
    custom_fields[entry.key] = await resolveSpaValue(entry, raw[entry.fieldId], lookups, tz);
  }
  const stageId = strOrNull(raw.stageId);
  const semanticCode = lookups.spaStageSemantic(stageId);
  const categoryId = strOrNull(raw.categoryId);
  const closedate = dateOrNull(raw.closedate, tz);

  return {
    record_type: ctx.recordType,
    source_system: "bitrix",
    source_id: spaSourceId(ctx.entityTypeId, String(raw.id)),
    title: strOrNull(raw.title),
    pipeline: categoryId ? (ctx.categories[categoryId] ?? categoryId) : null,
    stage: lookups.spaStageName(stageId),
    stage_semantic: stageId ? spaSemantic(semanticCode) : null,
    value: parseNum(raw.opportunity),
    mrr: null,
    currency: strOrNull(raw.currencyId),
    sale_type: null,
    channel: null,
    closed: semanticCode === "S" || semanticCode === "F",
    // Data de fechamento só vale para item encerrado — no processo aberto o
    // Bitrix preenche a PREVISÃO, que não é um fechamento.
    closed_at: semanticCode === "S" || semanticCode === "F" ? closedate : null,
    opened_at: dateOrNull(raw.begindate, tz),
    source_created_at: dateOrNull(raw.createdTime, tz),
    source_modified_at: dateOrNull(raw.updatedTime, tz),
    custom_fields,
    _assignedById: strOrNull(raw.assignedById),
    _leadId: null,
    _signatureDate: null,
  };
}
