// Versão: 1.1 | Data: 09/07/2026
// Sync da planilha "Estudo de Fechamentos" (aba Site) → records. Fonte PUSH
// (o Apps Script empurra a cada hora via /api/sync/sheets) — por isso não
// implementa o contrato SyncAdapter (backfill/reconcile) de lib/sync/adapter;
// expõe apenas `syncEstudoFechamentosRows`, chamada pela rota a cada request.
//
// Upsert idempotente por chave natural hash(nome normalizado + created_at).
// Reaproveita o conflito por campo (isProtected/valuesDiffer) e a resolução
// de operação primária de lib/sync/shared — o MESMO princípio do sync do
// Bitrix (lib/sync/bitrix/sync.ts).
// v1.1 (09/07/2026): Fase 7 — materializa campos calculados (computeFormulaFields)
//   em custom_fields, igual ao sync do Bitrix.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  computeFormulaFields,
  loadFormulaDefs,
  type FormulaFieldDef,
} from "@/lib/records/formulas";
import {
  emptyResult,
  isProtected,
  leadTimeDays,
  normalizeName,
  primaryOperationId,
  valuesDiffer,
  type ExistingRecord,
  type SyncResult,
} from "@/lib/sync/shared";

export interface SheetSiteRow {
  name: string;
  email: string | null;
  created_at: string; // yyyy-MM-dd
  consultor: string | null;
  products: string | null;
  mrr: number | null;
  plan: string | null;
  seats: number | null;
  contract: number | null;
  etapa_crm: string | null;
  canal: string | null;
  campanha: string | null;
  // Fallback calculado no Apps Script via "Inbound Zapper" / Leads Base —
  // usado só quando o app não encontra um lead relacionado por e-mail.
  lead_created_at: string | null;
  lead_time_days: number | null;
}

const CORE_SYNC_FIELDS = ["stage", "value", "mrr", "sale_type", "channel"] as const;

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sourceIdFor(name: string, createdAt: string): string {
  const key = `${normalizeName(name)}|${createdAt.trim()}`;
  return createHash("sha256").update(key).digest("hex");
}

// Responsável para vendas do site: casa por nome normalizado contra
// responsibles.display_name; se não achar (e não for vazio/"-"), cria um novo
// (mesma política de auto-criar-e-curar do Bitrix, sem bitrix_user_id).
async function resolveResponsibleByName(
  db: SupabaseClient,
  consultor: string | null
): Promise<string | null> {
  const name = strOrNull(consultor);
  if (!name || name === "-") return null;

  const { data: all } = await db
    .from("responsibles")
    .select("id, display_name");
  const target = normalizeName(name);
  const found = (all ?? []).find(
    (r) => normalizeName(r.display_name as string) === target
  );
  if (found) return found.id as string;

  const { data: created } = await db
    .from("responsibles")
    .insert({ display_name: name })
    .select("id")
    .maybeSingle();
  return (created?.id as string | undefined) ?? null;
}

// Lead relacionado por e-mail (o mais recente, em caso de múltiplos leads).
async function resolveRelatedLeadByEmail(
  db: SupabaseClient,
  email: string | null
): Promise<{ id: string; created: string | null } | null> {
  if (!email) return null;
  const { data } = await db
    .from("records")
    .select("id, source_created_at")
    .eq("record_type", "lead")
    .ilike("custom_fields->>email", email)
    .order("source_created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.id) return null;
  return { id: data.id as string, created: (data.source_created_at as string) ?? null };
}

async function upsertSheetRow(
  db: SupabaseClient,
  row: SheetSiteRow,
  formulaDefs: FormulaFieldDef[]
): Promise<"inserted" | "updated"> {
  const sourceId = sourceIdFor(row.name, row.created_at);

  const { data: existingRow } = await db
    .from("records")
    .select(
      "id, custom_fields, field_modified_at, last_synced_at, responsible_id, operation_id, related_lead_id, lead_time_days, " +
        CORE_SYNC_FIELDS.join(", ")
    )
    .eq("source_system", "sheet_site")
    .eq("source_id", sourceId)
    .maybeSingle();
  const existing = existingRow as ExistingRecord | null;

  const responsibleId = await resolveResponsibleByName(db, row.consultor);
  const operationId = await primaryOperationId(db, responsibleId);
  const relatedLead = await resolveRelatedLeadByEmail(db, row.email);

  // Lead time: prioriza o lead relacionado encontrado no app; sem match,
  // usa o valor já calculado pelo Apps Script (via Leads Base).
  const computedLeadTime = relatedLead
    ? leadTimeDays(row.created_at, relatedLead.created)
    : row.lead_time_days;

  const custom_fields: Record<string, unknown> = {
    products: row.products,
    seats: row.seats,
    campanha: row.campanha,
    email: row.email,
  };
  if (!relatedLead && row.lead_created_at) {
    custom_fields.lead_created_at_planilha = row.lead_created_at;
  }

  const now = new Date().toISOString();

  if (!existing) {
    if (formulaDefs.length > 0) {
      Object.assign(
        custom_fields,
        computeFormulaFields(
          { value: numOrNull(row.contract), mrr: numOrNull(row.mrr), lead_time_days: computedLeadTime },
          custom_fields,
          formulaDefs
        )
      );
    }
    const { error } = await db.from("records").insert({
      record_type: "venda_site",
      source_system: "sheet_site",
      source_id: sourceId,
      owner_user_id: null,
      responsible_id: responsibleId,
      operation_id: operationId,
      related_lead_id: relatedLead?.id ?? null,
      lead_time_days: computedLeadTime,
      title: row.name,
      stage: row.etapa_crm,
      value: row.contract,
      mrr: row.mrr,
      sale_type: row.plan,
      channel: row.canal,
      source_created_at: row.created_at,
      custom_fields,
      field_modified_at: {},
      last_synced_at: now,
    });
    if (error) throw new Error(`insert ${sourceId}: ${error.message}`);
    return "inserted";
  }

  const mapped: Record<string, unknown> = {
    stage: row.etapa_crm,
    value: row.contract,
    mrr: row.mrr,
    sale_type: row.plan,
    channel: row.canal,
  };

  const updates: Record<string, unknown> = { last_synced_at: now };
  const audits: {
    record_id: string;
    field: string;
    old_value: unknown;
    new_value: unknown;
  }[] = [];

  for (const f of CORE_SYNC_FIELDS) {
    if (isProtected(f, existing)) continue;
    if (valuesDiffer(existing[f], mapped[f])) {
      audits.push({ record_id: existing.id, field: f, old_value: existing[f], new_value: mapped[f] });
      updates[f] = mapped[f];
    }
  }

  const mergedCustom: Record<string, unknown> = { ...(existing.custom_fields ?? {}) };
  for (const [key, val] of Object.entries(custom_fields)) {
    if (isProtected(key, existing)) continue;
    if (valuesDiffer(mergedCustom[key], val)) {
      audits.push({ record_id: existing.id, field: key, old_value: mergedCustom[key] ?? null, new_value: val ?? null });
      mergedCustom[key] = val;
    }
  }
  updates.custom_fields = mergedCustom;

  if (!isProtected("responsible_id", existing) && responsibleId) {
    if (valuesDiffer(existing.responsible_id, responsibleId)) {
      updates.responsible_id = responsibleId;
    }
    if (!isProtected("operation_id", existing) && !existing.operation_id && operationId) {
      updates.operation_id = operationId;
    }
  }

  if (!isProtected("related_lead_id", existing) && relatedLead) {
    updates.related_lead_id = relatedLead.id;
    updates.lead_time_days = computedLeadTime;
  } else if (!isProtected("related_lead_id", existing) && !existing.related_lead_id) {
    updates.lead_time_days = computedLeadTime;
  }

  // Campos calculados: sempre recomputados a partir dos valores efetivos.
  if (formulaDefs.length > 0) {
    const eff = (col: string) => (col in updates ? updates[col] : existing[col]);
    Object.assign(
      mergedCustom,
      computeFormulaFields(
        {
          value: numOrNull(eff("value")),
          mrr: numOrNull(eff("mrr")),
          lead_time_days: numOrNull(
            "lead_time_days" in updates ? updates.lead_time_days : existing.lead_time_days
          ),
        },
        mergedCustom,
        formulaDefs
      )
    );
    updates.custom_fields = mergedCustom;
  }

  const { error } = await db.from("records").update(updates).eq("id", existing.id);
  if (error) throw new Error(`update ${sourceId}: ${error.message}`);

  if (audits.length > 0) {
    await db.from("audit_log").insert(
      audits.map((a) => ({ ...a, user_id: null, origin: "sync_sheet" as const }))
    );
  }
  return "updated";
}

export async function syncEstudoFechamentosRows(
  db: SupabaseClient,
  rows: SheetSiteRow[]
): Promise<SyncResult> {
  const result = emptyResult();
  const formulaDefs = await loadFormulaDefs(db);
  for (const row of rows) {
    if (!row.name || !row.created_at) {
      result.skipped += 1;
      continue;
    }
    try {
      const outcome = await upsertSheetRow(db, row, formulaDefs);
      result[outcome] += 1;
    } catch {
      result.errors += 1;
    }
  }
  return result;
}
