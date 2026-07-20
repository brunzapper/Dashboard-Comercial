// Versão: 1.1 | Data: 05/07/2026
// Orquestração do sync Bitrix → records: upsert com CONFLITO POR CAMPO
// (campos editados manualmente após o último sync não são sobrescritos),
// auditoria (origin 'sync_bitrix'), e resolução de owner (RLS), responsável
// (atributo de negócio, auto-criado e curável), operação padrão e lead
// relacionado + lead time (deals).
//
// Convenção de field_modified_at: chave = nome da coluna do núcleo
// (ex.: 'stage', 'mrr', 'responsible_id', 'related_lead_id') ou a chave do
// custom_field (ex.: 'tier'). A edição manual (Fase 4) grava o timestamp ali.
//
// v1.1 (05/07/2026): isProtected/valuesDiffer/primaryOperationId/leadTimeDays
//   extraídos para lib/sync/shared.ts (reutilizados pelo adapter de Sheets,
//   Fase 3) — SyncResult também passa a vir de lá.
// v1.2 (09/07/2026): Fase 7 — descobre/cataloga colunas do Bitrix
//   (syncFieldCatalog) e mapeia TODAS via buildCustomMapping; upsertRecord
//   materializa os campos calculados (computeFormulaFields) em custom_fields.
// v1.3 (09/07/2026): Fase 8 — contabiliza resultado por entidade (lead/negócio)
//   e captura a mensagem do erro (recordOutcome/recordError) em vez de engolir.
// v1.4 (19/07/2026): fuso da fonte — SyncContext.timezones (data_sources.timezone
//   por record_type) chega ao mapper; datetimes normalizam p/ Brasília (0079).
import type { SupabaseClient } from "@supabase/supabase-js";

import { BitrixClient } from "./client";
import { BitrixLookups } from "./lookups";
import { mapDeal, mapLead, type MappedRecord } from "./mapper";
import { buildCustomMapping, syncFieldCatalog, type CustomMapEntry } from "./catalog";
import { DEAL_PIPELINES } from "@/lib/config/bitrix-field-map";
import {
  computeFormulaFields,
  buildDateContext,
  loadCustomDateKeys,
  loadFormulaDefs,
  type FormulaFieldDef,
} from "@/lib/records/formulas";
import {
  emptyResult,
  isProtected,
  leadTimeDays,
  normalizeName,
  primaryOperationId,
  recordError,
  recordOutcome,
  valuesDiffer,
  type ExistingRecord,
  type SyncResult,
} from "@/lib/sync/shared";

export type { SyncResult };

const CORE_SYNC_FIELDS = [
  "title",
  "pipeline",
  "stage",
  "stage_semantic",
  "value",
  "mrr",
  "currency",
  "sale_type",
  "channel",
  "closed",
  "closed_at",
  "opened_at",
  "source_created_at",
  "source_modified_at",
] as const;

async function resolveOwnerUserId(
  db: SupabaseClient,
  bitrixId: string | null
): Promise<string | null> {
  if (!bitrixId) return null;
  const { data } = await db
    .from("bitrix_user_map")
    .select("user_id")
    .eq("bitrix_id", bitrixId)
    .maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}

// Encontra (ou cria) o responsável elegível a partir do ASSIGNED_BY_ID.
async function resolveResponsibleId(
  db: SupabaseClient,
  bitrixId: string | null,
  lookups: BitrixLookups
): Promise<string | null> {
  if (!bitrixId) return null;
  const { data: existing } = await db
    .from("responsibles")
    .select("id")
    .eq("bitrix_user_id", bitrixId)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const displayName = (await lookups.userName(bitrixId)) ?? bitrixId;
  const { data: created } = await db
    .from("responsibles")
    .insert({ display_name: displayName, bitrix_user_id: bitrixId })
    .select("id")
    .maybeSingle();
  return (created?.id as string | undefined) ?? null;
}

// Lead relacionado: por LEAD_ID nativo; senão, pelo nome (mais recente).
async function resolveRelatedLead(
  db: SupabaseClient,
  mapped: MappedRecord
): Promise<{ id: string; created: string | null } | null> {
  if (mapped.record_type !== "negocio") return null;

  if (mapped._leadId) {
    const { data } = await db
      .from("records")
      .select("id, source_created_at")
      .eq("source_system", "bitrix")
      .eq("record_type", "lead")
      .eq("source_id", mapped._leadId)
      .maybeSingle();
    if (data?.id) {
      return { id: data.id as string, created: (data.source_created_at as string) ?? null };
    }
  }

  if (mapped.title) {
    const { data } = await db
      .from("records")
      .select("id, source_created_at")
      .eq("record_type", "lead")
      .ilike("title", mapped.title)
      .order("source_created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.id) {
      return { id: data.id as string, created: (data.source_created_at as string) ?? null };
    }
  }

  return null;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Colunas que o sync escreve num upsert uniforme (mesmo conjunto p/ inserts e
// updates — PostgREST monta um único INSERT ... ON CONFLICT). Colunas fora deste
// conjunto (temperature, created_at, locally_modified_at) nunca entram no SET,
// então são preservadas no update.
const EXISTING_SELECT =
  "id, source_id, owner_user_id, custom_fields, field_modified_at, last_synced_at, " +
  "responsible_id, operation_id, related_lead_id, lead_time_days, " +
  CORE_SYNC_FIELDS.join(", ");

interface AuditEntry {
  record_id: string;
  field: string;
  old_value: unknown;
  new_value: unknown;
}

interface ResolvedRefs {
  ownerUserId: string | null;
  responsibleId: string | null;
  operationId: string | null;
  relatedLead: { id: string; created: string | null } | null;
  computedLeadTime: number | null;
}

/**
 * Calcula (SEM tocar no banco) a linha de upsert de um registro, respeitando o
 * conflito por campo (edição manual protege contra sobrescrita). Recebe os
 * valores já resolvidos (owner/responsável/operação/lead) e RETORNA a linha
 * completa + as auditorias, para o driver escrever em lote. Mesma regra do
 * upsert original (insert/update), agora unificada num único formato de linha.
 */
export function computeRecordUpsert(
  mapped: MappedRecord,
  existing: ExistingRecord | null,
  resolved: ResolvedRefs,
  formulaDefs: FormulaFieldDef[] = [],
  customDateKeys: string[] = []
): { row: Record<string, unknown>; audits: AuditEntry[]; outcome: "inserted" | "updated" } {
  const now = new Date().toISOString();
  // Datas próprias do registro (do mapper) para o contexto de datas dos campos
  // calculados. Operandos match:<fonte> ficam para o recalc (regra de "pular").
  const dateCtxFor = (custom: Record<string, unknown>) =>
    buildDateContext(
      {
        closed_at: (mapped.closed_at as string | null) ?? null,
        opened_at: (mapped.opened_at as string | null) ?? null,
        source_created_at: (mapped.source_created_at as string | null) ?? null,
      },
      custom,
      customDateKeys
    );

  if (!existing) {
    const custom_fields = { ...mapped.custom_fields };
    if (formulaDefs.length > 0) {
      const calc = computeFormulaFields(
        {
          value: mapped.value,
          mrr: mapped.mrr,
          lead_time_days: resolved.computedLeadTime,
          // Colunas textuais/booleanas (condicionais SE/E/OU nas fórmulas).
          title: mapped.title,
          record_type: mapped.record_type,
          source_system: mapped.source_system,
          pipeline: mapped.pipeline,
          stage: mapped.stage,
          stage_semantic: mapped.stage_semantic,
          sale_type: mapped.sale_type,
          channel: mapped.channel,
          currency: mapped.currency,
          closed: mapped.closed,
        },
        custom_fields,
        formulaDefs,
        undefined,
        dateCtxFor(custom_fields)
      );
      Object.assign(custom_fields, calc);
    }
    const row: Record<string, unknown> = {
      record_type: mapped.record_type,
      source_system: mapped.source_system,
      source_id: mapped.source_id,
      owner_user_id: resolved.ownerUserId,
      responsible_id: resolved.responsibleId,
      operation_id: resolved.operationId,
      related_lead_id: resolved.relatedLead?.id ?? null,
      lead_time_days: resolved.computedLeadTime,
      custom_fields,
      field_modified_at: {},
      last_synced_at: now,
    };
    for (const f of CORE_SYNC_FIELDS) row[f] = mapped[f];
    return { row, audits: [], outcome: "inserted" };
  }

  const audits: AuditEntry[] = [];
  // Linha uniforme: começa com os valores existentes; só troca o que muda e não
  // está protegido. record_type/source_* são iguais aos existentes (no-op).
  const row: Record<string, unknown> = {
    record_type: mapped.record_type,
    source_system: mapped.source_system,
    source_id: mapped.source_id,
    field_modified_at: existing.field_modified_at ?? {},
    last_synced_at: now,
  };

  // Núcleo
  for (const f of CORE_SYNC_FIELDS) {
    if (!isProtected(f, existing) && valuesDiffer(existing[f], mapped[f])) {
      audits.push({ record_id: existing.id, field: f, old_value: existing[f], new_value: mapped[f] });
      row[f] = mapped[f];
    } else {
      row[f] = existing[f];
    }
  }

  // custom_fields (preserva chaves locais e protegidas)
  const mergedCustom: Record<string, unknown> = { ...(existing.custom_fields ?? {}) };
  for (const [key, val] of Object.entries(mapped.custom_fields)) {
    if (isProtected(key, existing)) continue;
    if (valuesDiffer(mergedCustom[key], val)) {
      audits.push({ record_id: existing.id, field: key, old_value: mergedCustom[key] ?? null, new_value: val ?? null });
      mergedCustom[key] = val;
    }
  }

  // Owner (derivado; não protegido). Só sobrescreve quando resolvido.
  row.owner_user_id = resolved.ownerUserId ?? existing.owner_user_id ?? null;

  // Responsável / Operação (protegíveis)
  let responsibleId = (existing.responsible_id as string | null) ?? null;
  let operationId = (existing.operation_id as string | null) ?? null;
  if (!isProtected("responsible_id", existing) && resolved.responsibleId) {
    if (valuesDiffer(existing.responsible_id, resolved.responsibleId)) {
      responsibleId = resolved.responsibleId;
    }
    if (!isProtected("operation_id", existing) && !existing.operation_id && resolved.operationId) {
      operationId = resolved.operationId;
    }
  }
  row.responsible_id = responsibleId;
  row.operation_id = operationId;

  // Lead relacionado + lead time (protegíveis via related_lead_id)
  if (!isProtected("related_lead_id", existing) && resolved.relatedLead) {
    row.related_lead_id = resolved.relatedLead.id;
    row.lead_time_days = resolved.computedLeadTime;
  } else {
    row.related_lead_id = (existing.related_lead_id as string | null) ?? null;
    row.lead_time_days = (existing.lead_time_days as number | null) ?? null;
  }

  // Campos calculados: sempre recomputados a partir dos valores efetivos da linha.
  if (formulaDefs.length > 0) {
    const calc = computeFormulaFields(
      {
        value: numOrNull(row.value),
        mrr: numOrNull(row.mrr),
        lead_time_days: numOrNull(row.lead_time_days),
        // Valores efetivos da linha (condicionais SE/E/OU nas fórmulas).
        title: row.title,
        record_type: row.record_type,
        source_system: row.source_system,
        pipeline: row.pipeline,
        stage: row.stage,
        stage_semantic: row.stage_semantic,
        sale_type: row.sale_type,
        channel: row.channel,
        currency: row.currency,
        closed: row.closed,
      },
      mergedCustom,
      formulaDefs,
      undefined,
      dateCtxFor(mergedCustom)
    );
    Object.assign(mergedCustom, calc);
  }
  row.custom_fields = mergedCustom;

  return { row, audits, outcome: "updated" };
}

/**
 * Compat: insere/atualiza UM registro (resolvendo owner/responsável/lead por
 * registro). Usado por runBackfill/runReconcile e pelas rotas de API. O caminho
 * incremental da UI usa upsertPage (em lote).
 */
export async function upsertRecord(
  db: SupabaseClient,
  mapped: MappedRecord,
  lookups: BitrixLookups,
  formulaDefs: FormulaFieldDef[] = [],
  customDateKeys: string[] = []
): Promise<"inserted" | "updated"> {
  const { data: existingRow } = await db
    .from("records")
    .select(EXISTING_SELECT)
    .eq("source_system", mapped.source_system)
    .eq("source_id", mapped.source_id)
    .maybeSingle();
  const existing = existingRow as ExistingRecord | null;

  const ownerUserId = await resolveOwnerUserId(db, mapped._assignedById);
  const responsibleId = await resolveResponsibleId(db, mapped._assignedById, lookups);
  const operationId = await primaryOperationId(db, responsibleId);
  const relatedLead = await resolveRelatedLead(db, mapped);
  const refDate = mapped._signatureDate ?? mapped.closed_at;
  const computedLeadTime = relatedLead ? leadTimeDays(refDate, relatedLead.created) : null;

  const { row, audits, outcome } = computeRecordUpsert(
    mapped,
    existing,
    { ownerUserId, responsibleId, operationId, relatedLead, computedLeadTime },
    formulaDefs,
    customDateKeys
  );

  const { error } = await db
    .from("records")
    .upsert([row], { onConflict: "source_system,source_id" });
  if (error) throw new Error(`upsert ${mapped.source_id}: ${error.message}`);

  if (audits.length > 0) {
    await db.from("audit_log").insert(
      audits.map((a) => ({ ...a, user_id: null, origin: "sync_bitrix" as const }))
    );
  }
  return outcome;
}

// ------------------------- Upsert em lote (por página) -------------------------

export interface PreloadedMaps {
  ownerByBitrix: Map<string, string>;
  responsibleByBitrix: Map<string, string>;
  primaryOpByResponsible: Map<string, string>;
}

/** Carrega, 1x por passo, os mapas pequenos usados para resolver cada registro. */
export async function loadPreloadedMaps(db: SupabaseClient): Promise<PreloadedMaps> {
  const [users, resps, respOps] = await Promise.all([
    db.from("bitrix_user_map").select("bitrix_id, user_id"),
    db.from("responsibles").select("id, bitrix_user_id"),
    db.from("responsible_operations").select("responsible_id, operation_id").eq("priority", 1),
  ]);
  const ownerByBitrix = new Map<string, string>();
  for (const r of users.data ?? []) {
    if (r.bitrix_id && r.user_id) ownerByBitrix.set(String(r.bitrix_id), r.user_id as string);
  }
  const responsibleByBitrix = new Map<string, string>();
  for (const r of resps.data ?? []) {
    if (r.bitrix_user_id) responsibleByBitrix.set(String(r.bitrix_user_id), r.id as string);
  }
  const primaryOpByResponsible = new Map<string, string>();
  for (const r of respOps.data ?? []) {
    primaryOpByResponsible.set(r.responsible_id as string, r.operation_id as string);
  }
  return { ownerByBitrix, responsibleByBitrix, primaryOpByResponsible };
}

/** Cria (em lote) os responsáveis ausentes e os mescla nos mapas. */
export async function ensureResponsibles(
  db: SupabaseClient,
  lookups: BitrixLookups,
  maps: PreloadedMaps,
  bitrixIds: Set<string>
): Promise<void> {
  const missing = [...bitrixIds].filter((id) => id && !maps.responsibleByBitrix.has(id));
  if (missing.length === 0) return;
  const toInsert: { display_name: string; bitrix_user_id: string }[] = [];
  for (const id of missing) {
    const displayName = (await lookups.userName(id)) ?? id;
    toInsert.push({ display_name: displayName, bitrix_user_id: id });
  }
  const { data } = await db
    .from("responsibles")
    .insert(toInsert)
    .select("id, bitrix_user_id");
  for (const r of data ?? []) {
    if (r.bitrix_user_id) maps.responsibleByBitrix.set(String(r.bitrix_user_id), r.id as string);
  }
}

export interface RelatedLeadIndex {
  byLeadSourceId: Map<string, { id: string; created: string | null }>;
  byTitleNorm: Map<string, { id: string; created: string | null }>;
}

/**
 * Índice de leads relacionados para uma página de deals — 2 queries no máximo
 * (por source_id nativo e por título). Substitui o lookup por registro.
 */
export async function loadRelatedLeadIndex(
  db: SupabaseClient,
  page: MappedRecord[]
): Promise<RelatedLeadIndex> {
  const byLeadSourceId = new Map<string, { id: string; created: string | null }>();
  const byTitleNorm = new Map<string, { id: string; created: string | null }>();
  const leadIds = new Set<string>();
  const titles = new Set<string>();
  for (const m of page) {
    if (m.record_type !== "negocio") continue;
    if (m._leadId) leadIds.add(m._leadId);
    if (m.title) titles.add(m.title);
  }

  if (leadIds.size > 0) {
    const { data } = await db
      .from("records")
      .select("id, source_id, source_created_at")
      .eq("source_system", "bitrix")
      .eq("record_type", "lead")
      .in("source_id", [...leadIds]);
    for (const r of data ?? []) {
      byLeadSourceId.set(String(r.source_id), {
        id: r.id as string,
        created: (r.source_created_at as string) ?? null,
      });
    }
  }

  if (titles.size > 0) {
    const { data } = await db
      .from("records")
      .select("id, title, source_created_at")
      .eq("record_type", "lead")
      .in("title", [...titles]);
    for (const r of data ?? []) {
      const key = normalizeName(r.title as string);
      if (!key) continue;
      const created = (r.source_created_at as string) ?? null;
      const prev = byTitleNorm.get(key);
      if (!prev || (created && (!prev.created || created > prev.created))) {
        byTitleNorm.set(key, { id: r.id as string, created });
      }
    }
  }

  return { byLeadSourceId, byTitleNorm };
}

function resolveRelatedLeadFromIndex(
  mapped: MappedRecord,
  idx: RelatedLeadIndex
): { id: string; created: string | null } | null {
  if (mapped.record_type !== "negocio") return null;
  if (mapped._leadId) {
    const byId = idx.byLeadSourceId.get(mapped._leadId);
    if (byId) return byId;
  }
  if (mapped.title) {
    const byTitle = idx.byTitleNorm.get(normalizeName(mapped.title));
    if (byTitle) return byTitle;
  }
  return null;
}

/**
 * Grava uma página de registros já mapeados em ~5 idas ao banco (independente de
 * N): 1 select de existentes, 1 upsert em records, 1 insert em audit_log. Os
 * mapas/índice são pré-carregados pelo chamador (1x por passo).
 */
export async function upsertPage(
  db: SupabaseClient,
  items: MappedRecord[],
  maps: PreloadedMaps,
  relIndex: RelatedLeadIndex,
  formulaDefs: FormulaFieldDef[],
  result: SyncResult,
  entity: "lead" | "negocio",
  customDateKeys: string[] = []
): Promise<void> {
  if (items.length === 0) return;

  const sourceIds = items.map((i) => i.source_id);
  const { data: existingRows } = await db
    .from("records")
    .select(EXISTING_SELECT)
    .eq("source_system", "bitrix")
    .in("source_id", sourceIds);
  const existingList = (existingRows ?? []) as unknown as ExistingRecord[];
  const existingBySourceId = new Map<string, ExistingRecord>(
    existingList.map((r) => [String(r.source_id), r])
  );

  const rows: Record<string, unknown>[] = [];
  const allAudits: AuditEntry[] = [];
  const outcomes: ("inserted" | "updated")[] = [];

  for (const mapped of items) {
    try {
      const existing = existingBySourceId.get(mapped.source_id) ?? null;
      const bid = mapped._assignedById;
      const ownerUserId = bid ? maps.ownerByBitrix.get(bid) ?? null : null;
      const responsibleId = bid ? maps.responsibleByBitrix.get(bid) ?? null : null;
      const operationId = responsibleId
        ? maps.primaryOpByResponsible.get(responsibleId) ?? null
        : null;
      const relatedLead = resolveRelatedLeadFromIndex(mapped, relIndex);
      const refDate = mapped._signatureDate ?? mapped.closed_at;
      const computedLeadTime = relatedLead
        ? leadTimeDays(refDate, relatedLead.created)
        : null;

      const { row, audits, outcome } = computeRecordUpsert(
        mapped,
        existing,
        { ownerUserId, responsibleId, operationId, relatedLead, computedLeadTime },
        formulaDefs,
        customDateKeys
      );
      rows.push(row);
      allAudits.push(...audits);
      outcomes.push(outcome);
    } catch (e) {
      recordError(result, entity, (e as Error).message);
    }
  }

  if (rows.length > 0) {
    const { error } = await db
      .from("records")
      .upsert(rows, { onConflict: "source_system,source_id" });
    if (error) throw new Error(`upsert page (${entity}): ${error.message}`);
  }
  if (allAudits.length > 0) {
    await db.from("audit_log").insert(
      allAudits.map((a) => ({ ...a, user_id: null, origin: "sync_bitrix" as const }))
    );
  }
  for (const outcome of outcomes) recordOutcome(result, entity, outcome);
}

// ------------------------- Backfill / Reconcile -------------------------

interface DealFilter {
  [key: string]: unknown;
}

export interface SyncContext {
  dealMapping: CustomMapEntry[];
  leadMapping: CustomMapEntry[];
  formulaDefs: FormulaFieldDef[];
  customDateKeys: string[];
  // Fuso da ORIGEM por record_type (data_sources.timezone): datetimes são
  // normalizados p/ Brasília no mapper. null = sem conversão.
  timezones: SourceTimezones;
}

export interface SourceTimezones {
  lead: string | null;
  negocio: string | null;
}

// Fuso configurado das fontes Bitrix. Erro de select (ex.: migração 0079 ainda
// não aplicada) degrada para passthrough — sync nunca para por causa disso.
async function loadSourceTimezones(db: SupabaseClient): Promise<SourceTimezones> {
  const tz: SourceTimezones = { lead: null, negocio: null };
  const { data, error } = await db
    .from("data_sources")
    .select("record_type, timezone")
    .in("record_type", ["lead", "negocio"]);
  if (error || !data) return tz;
  for (const row of data) {
    const rt = row.record_type as keyof SourceTimezones;
    if (rt === "lead" || rt === "negocio") {
      tz[rt] = (row.timezone as string | null) || null;
    }
  }
  return tz;
}

/** `since` (YYYY-MM-DDTHH:MM:SS) para uma janela corrida de N dias. */
export function sinceFromDays(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 19);
}

async function fetchAndSyncDeals(
  db: SupabaseClient,
  client: BitrixClient,
  lookups: BitrixLookups,
  ctx: SyncContext,
  categoryId: string,
  extraFilter: DealFilter,
  result: SyncResult
): Promise<void> {
  const deals = await client.listAll<Record<string, unknown>>("crm.deal.list", {
    filter: { CATEGORY_ID: categoryId, ...extraFilter },
    select: ["*", "UF_*"],
  });
  for (const raw of deals) {
    try {
      const mapped = await mapDeal(raw, lookups, ctx.dealMapping, ctx.timezones.negocio);
      const outcome = await upsertRecord(db, mapped, lookups, ctx.formulaDefs, ctx.customDateKeys);
      recordOutcome(result, "negocio", outcome);
    } catch (e) {
      recordError(result, "negocio", (e as Error).message);
    }
  }
}

async function fetchAndSyncLeads(
  db: SupabaseClient,
  client: BitrixClient,
  lookups: BitrixLookups,
  ctx: SyncContext,
  extraFilter: DealFilter,
  result: SyncResult
): Promise<void> {
  const leads = await client.listAll<Record<string, unknown>>("crm.lead.list", {
    filter: { ...extraFilter },
    select: ["*", "UF_*"],
  });
  for (const raw of leads) {
    try {
      const mapped = await mapLead(raw, lookups, ctx.leadMapping, ctx.timezones.lead);
      const outcome = await upsertRecord(db, mapped, lookups, ctx.formulaDefs, ctx.customDateKeys);
      recordOutcome(result, "lead", outcome);
    } catch (e) {
      recordError(result, "lead", (e as Error).message);
    }
  }
}

// Cataloga colunas do Bitrix e monta o contexto de sync (mapas + fórmulas).
export async function buildSyncContext(
  db: SupabaseClient,
  lookups: BitrixLookups
): Promise<SyncContext> {
  await syncFieldCatalog(db, lookups);
  return {
    dealMapping: buildCustomMapping(lookups, "deal"),
    leadMapping: buildCustomMapping(lookups, "lead"),
    formulaDefs: await loadFormulaDefs(db),
    customDateKeys: await loadCustomDateKeys(db),
    timezones: await loadSourceTimezones(db),
  };
}

export function enterpriseCategoryId(lookups: BitrixLookups): string | null {
  return lookups.findCategoryIdByName(DEAL_PIPELINES.enterpriseCategoryName);
}

/**
 * Backfill inicial: leads primeiro (para o LEAD_ID dos deals resolver), depois
 * deals (abertos + fechados na janela) dos pipelines Vendas + Enterprise.
 * `days` (padrão 365) define a janela CORRIDA dos deals fechados — antes usava o
 * início do ano-calendário, que perdia fechados do 2º semestre do ano anterior.
 */
export async function runBackfill(
  db: SupabaseClient,
  client: BitrixClient,
  days = 365
): Promise<SyncResult> {
  const lookups = new BitrixLookups(client, db);
  await lookups.preload();
  const ctx = await buildSyncContext(db, lookups);
  const result = emptyResult();

  const since = sinceFromDays(days);

  // Leads (todos — cobre históricos para o lead time).
  await fetchAndSyncLeads(db, client, lookups, ctx, {}, result);

  // Deals dos dois pipelines, ainda abertos ou fechados na janela corrida.
  const categories: string[] = [DEAL_PIPELINES.vendasCategoryId];
  const entId = enterpriseCategoryId(lookups);
  if (entId) categories.push(entId);

  for (const cat of categories) {
    // Abertos (qualquer data)
    await fetchAndSyncDeals(db, client, lookups, ctx, cat, { CLOSED: "N" }, result);
    // Fechados na janela (últimos N dias)
    await fetchAndSyncDeals(
      db,
      client,
      lookups,
      ctx,
      cat,
      { CLOSED: "Y", ">=DATE_MODIFY": since },
      result
    );
  }

  return result;
}

/**
 * Reconciliação: refaz a busca por DATE_MODIFY >= agora - N dias nos dois
 * pipelines (deals) e nos leads, cobrindo qualquer atualização recente.
 */
export async function runReconcile(
  db: SupabaseClient,
  client: BitrixClient,
  days: number
): Promise<SyncResult> {
  const lookups = new BitrixLookups(client, db);
  await lookups.preload();
  const ctx = await buildSyncContext(db, lookups);
  const result = emptyResult();

  const since = sinceFromDays(days);

  await fetchAndSyncLeads(db, client, lookups, ctx, { ">=DATE_MODIFY": since }, result);

  const categories: string[] = [DEAL_PIPELINES.vendasCategoryId];
  const entId = enterpriseCategoryId(lookups);
  if (entId) categories.push(entId);
  for (const cat of categories) {
    await fetchAndSyncDeals(
      db,
      client,
      lookups,
      ctx,
      cat,
      { ">=DATE_MODIFY": since },
      result
    );
  }

  return result;
}
