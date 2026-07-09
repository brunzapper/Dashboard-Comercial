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
import type { SupabaseClient } from "@supabase/supabase-js";

import { BitrixClient } from "./client";
import { BitrixLookups } from "./lookups";
import { mapDeal, mapLead, type MappedRecord } from "./mapper";
import { buildCustomMapping, syncFieldCatalog, type CustomMapEntry } from "./catalog";
import { DEAL_PIPELINES } from "@/lib/config/bitrix-field-map";
import {
  computeFormulaFields,
  loadFormulaDefs,
  type FormulaFieldDef,
} from "@/lib/records/formulas";
import {
  emptyResult,
  isProtected,
  leadTimeDays,
  primaryOperationId,
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

/** Insere ou atualiza um registro mapeado, respeitando conflito por campo. */
export async function upsertRecord(
  db: SupabaseClient,
  mapped: MappedRecord,
  lookups: BitrixLookups,
  formulaDefs: FormulaFieldDef[] = []
): Promise<"inserted" | "updated"> {
  const { data: existingRow } = await db
    .from("records")
    .select(
      "id, custom_fields, field_modified_at, last_synced_at, responsible_id, operation_id, related_lead_id, lead_time_days, " +
        CORE_SYNC_FIELDS.join(", ")
    )
    .eq("source_system", mapped.source_system)
    .eq("source_id", mapped.source_id)
    .maybeSingle();
  const existing = existingRow as ExistingRecord | null;

  const ownerUserId = await resolveOwnerUserId(db, mapped._assignedById);
  const responsibleId = await resolveResponsibleId(
    db,
    mapped._assignedById,
    lookups
  );
  const operationId = await primaryOperationId(db, responsibleId);
  const relatedLead = await resolveRelatedLead(db, mapped);
  const refDate = mapped._signatureDate ?? mapped.closed_at;
  const computedLeadTime = relatedLead
    ? leadTimeDays(refDate, relatedLead.created)
    : null;

  const now = new Date().toISOString();

  if (!existing) {
    const custom_fields = { ...mapped.custom_fields };
    if (formulaDefs.length > 0) {
      const calc = computeFormulaFields(
        { value: mapped.value, mrr: mapped.mrr, lead_time_days: computedLeadTime },
        custom_fields,
        formulaDefs
      );
      Object.assign(custom_fields, calc);
    }
    const row: Record<string, unknown> = {
      record_type: mapped.record_type,
      source_system: mapped.source_system,
      source_id: mapped.source_id,
      owner_user_id: ownerUserId,
      responsible_id: responsibleId,
      operation_id: operationId,
      related_lead_id: relatedLead?.id ?? null,
      lead_time_days: computedLeadTime,
      custom_fields,
      field_modified_at: {},
      last_synced_at: now,
    };
    for (const f of CORE_SYNC_FIELDS) row[f] = mapped[f];
    const { error } = await db.from("records").insert(row);
    if (error) throw new Error(`insert ${mapped.source_id}: ${error.message}`);
    return "inserted";
  }

  const updates: Record<string, unknown> = { last_synced_at: now };
  const audits: {
    record_id: string;
    field: string;
    old_value: unknown;
    new_value: unknown;
  }[] = [];

  // Núcleo
  for (const f of CORE_SYNC_FIELDS) {
    if (isProtected(f, existing)) continue;
    if (valuesDiffer(existing[f], mapped[f])) {
      audits.push({ record_id: existing.id, field: f, old_value: existing[f], new_value: mapped[f] });
      updates[f] = mapped[f];
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
  updates.custom_fields = mergedCustom;

  // Owner (derivado; não protegido). Só sobrescreve quando resolvido.
  if (ownerUserId) updates.owner_user_id = ownerUserId;

  // Responsável / Operação (protegíveis)
  if (!isProtected("responsible_id", existing) && responsibleId) {
    if (valuesDiffer(existing.responsible_id, responsibleId)) {
      updates.responsible_id = responsibleId;
    }
    if (!isProtected("operation_id", existing) && !existing.operation_id && operationId) {
      updates.operation_id = operationId;
    }
  }

  // Lead relacionado + lead time (protegíveis via related_lead_id)
  if (!isProtected("related_lead_id", existing) && relatedLead) {
    updates.related_lead_id = relatedLead.id;
    updates.lead_time_days = computedLeadTime;
  }

  // Campos calculados: sempre recomputados a partir dos valores efetivos.
  if (formulaDefs.length > 0) {
    const eff = (col: string) => (col in updates ? updates[col] : existing[col]);
    const calc = computeFormulaFields(
      {
        value: numOrNull(eff("value")),
        mrr: numOrNull(eff("mrr")),
        lead_time_days: numOrNull(
          "lead_time_days" in updates ? updates.lead_time_days : existing.lead_time_days
        ),
      },
      mergedCustom,
      formulaDefs
    );
    Object.assign(mergedCustom, calc);
    updates.custom_fields = mergedCustom;
  }

  const { error } = await db.from("records").update(updates).eq("id", existing.id);
  if (error) throw new Error(`update ${mapped.source_id}: ${error.message}`);

  if (audits.length > 0) {
    await db.from("audit_log").insert(
      audits.map((a) => ({ ...a, user_id: null, origin: "sync_bitrix" as const }))
    );
  }
  return "updated";
}

// ------------------------- Backfill / Reconcile -------------------------

interface DealFilter {
  [key: string]: unknown;
}

interface SyncContext {
  dealMapping: CustomMapEntry[];
  leadMapping: CustomMapEntry[];
  formulaDefs: FormulaFieldDef[];
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
      const mapped = await mapDeal(raw, lookups, ctx.dealMapping);
      const outcome = await upsertRecord(db, mapped, lookups, ctx.formulaDefs);
      result[outcome] += 1;
    } catch {
      result.errors += 1;
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
      const mapped = await mapLead(raw, lookups, ctx.leadMapping);
      const outcome = await upsertRecord(db, mapped, lookups, ctx.formulaDefs);
      result[outcome] += 1;
    } catch {
      result.errors += 1;
    }
  }
}

// Cataloga colunas do Bitrix e monta o contexto de sync (mapas + fórmulas).
async function buildSyncContext(
  db: SupabaseClient,
  lookups: BitrixLookups
): Promise<SyncContext> {
  await syncFieldCatalog(db, lookups);
  return {
    dealMapping: buildCustomMapping(lookups, "deal"),
    leadMapping: buildCustomMapping(lookups, "lead"),
    formulaDefs: await loadFormulaDefs(db),
  };
}

function enterpriseCategoryId(lookups: BitrixLookups): string | null {
  return lookups.findCategoryIdByName(DEAL_PIPELINES.enterpriseCategoryName);
}

/**
 * Backfill inicial: leads primeiro (para o LEAD_ID dos deals resolver), depois
 * deals (abertos + fechados do ano) dos pipelines Vendas + Enterprise.
 */
export async function runBackfill(
  db: SupabaseClient,
  client: BitrixClient
): Promise<SyncResult> {
  const lookups = new BitrixLookups(client, db);
  await lookups.preload();
  const ctx = await buildSyncContext(db, lookups);
  const result = emptyResult();

  const yearStart = `${new Date().getFullYear()}-01-01T00:00:00`;

  // Leads (todos — cobre históricos para o lead time).
  await fetchAndSyncLeads(db, client, lookups, ctx, {}, result);

  // Deals dos dois pipelines, criados/modificados no ano ou ainda abertos.
  const categories: string[] = [DEAL_PIPELINES.vendasCategoryId];
  const entId = enterpriseCategoryId(lookups);
  if (entId) categories.push(entId);

  for (const cat of categories) {
    // Abertos (qualquer data)
    await fetchAndSyncDeals(db, client, lookups, ctx, cat, { CLOSED: "N" }, result);
    // Fechados no ano
    await fetchAndSyncDeals(
      db,
      client,
      lookups,
      ctx,
      cat,
      { CLOSED: "Y", ">=DATE_MODIFY": yearStart },
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

  const since = new Date(Date.now() - days * 86400000)
    .toISOString()
    .slice(0, 19);

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
