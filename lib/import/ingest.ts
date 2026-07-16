// Versão: 1.0 | Data: 16/07/2026
// Motor server-side do import em massa (CSV hoje; a futura API de ingestão
// chama exatamente esta função com um mapeamento salvo). Espelha os princípios
// dos adapters de sync (lib/sync/sheets/adapter.ts, lib/sync/bitrix/sync.ts):
//   - idempotente por chave natural: source_id = sha256(fonte + colunas de
//     dedup) sob o índice único uq_records_source (source_system='csv');
//   - conflito por campo: valor editado manualmente no app depois do último
//     import NUNCA é sobrescrito (isProtected/valuesDiffer);
//   - lote com poucas idas ao banco: 1 select dos existentes + 1 insert em
//     lote + updates pontuais + 1 insert de auditoria (origin 'import_csv');
//   - campos calculados materializados (computeFormulaFields), como no sync.
// Requer service role (INSERT em records é admin-only na RLS) — o chamador
// (server action) valida a sessão/papel ANTES de chegar aqui.
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildDateContext,
  computeFormulaFields,
  loadCustomDateKeys,
  loadFormulaDefs,
} from "@/lib/records/formulas";
import {
  emptyResult,
  isProtected,
  normalizeName,
  primaryOperationId,
  recordError,
  recordOutcome,
  valuesDiffer,
  type ExistingRecord,
  type SyncResult,
} from "@/lib/sync/shared";
import {
  CORE_IMPORT_COLUMNS,
  coerceValue,
  coreTargetKind,
  type ColumnMapping,
} from "@/lib/import/csv";

export const IMPORT_SOURCE_SYSTEM = "csv";

export interface IngestOptions {
  sourceKey: string;
  recordType: string;
  mapping: ColumnMapping[];
  // Colunas do CSV que formam a chave de dedup; vazio = hash da linha inteira
  // (todas as colunas mapeadas), na ordem do mapping.
  dedupColumns: string[];
  // Autor do import (auditoria das atualizações).
  userId: string | null;
}

interface BuiltRow {
  sourceId: string;
  core: Record<string, unknown>;
  custom: Record<string, unknown>;
  responsibleName: string | null;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Chave natural da linha: fonte + valores (normalizados) das colunas de dedup. */
export function sourceIdForRow(
  sourceKey: string,
  row: Record<string, unknown>,
  dedupColumns: string[],
  mapping: ColumnMapping[]
): string {
  const cols =
    dedupColumns.length > 0
      ? dedupColumns
      : mapping.filter((m) => m.target !== "ignore").map((m) => m.csvColumn);
  const parts = cols.map((c) => normalizeName(String(row[c] ?? "")));
  return sha256(`${sourceKey}|${parts.join("|")}`);
}

function buildRow(
  opts: IngestOptions,
  row: Record<string, unknown>
): BuiltRow | null {
  const core: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};
  let responsibleName: string | null = null;
  let hasValue = false;

  for (const m of opts.mapping) {
    const raw = row[m.csvColumn];
    if (m.target === "ignore") continue;
    if (m.target === "responsible") {
      const name = raw == null ? "" : String(raw).trim();
      if (name && name !== "-") {
        responsibleName = name;
        hasValue = true;
      }
      continue;
    }
    if (m.target.startsWith("core:")) {
      const col = m.target.slice("core:".length);
      if (!CORE_IMPORT_COLUMNS.has(col)) continue; // whitelist
      const value = coerceValue(coreTargetKind(col), raw);
      core[col] = value;
      if (value != null) hasValue = true;
      continue;
    }
    if (m.target.startsWith("custom:")) {
      const key = m.target.slice("custom:".length);
      if (!key) continue;
      const value = coerceValue(m.dataType ?? "texto", raw);
      custom[key] = value;
      if (value != null) hasValue = true;
    }
  }

  if (!hasValue) return null; // linha vazia (só separadores) — pula
  // Fechamento: closed acompanha closed_at quando a coluna foi mapeada.
  if ("closed_at" in core) core.closed = core.closed_at != null;
  return {
    sourceId: sourceIdForRow(opts.sourceKey, row, opts.dedupColumns, opts.mapping),
    core,
    custom,
    responsibleName,
  };
}

// Resolve (ou cria) responsáveis por nome — mesma política do adapter da
// planilha (lib/sync/sheets/adapter.ts), em lote por chunk.
async function resolveResponsibles(
  db: SupabaseClient,
  names: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (names.length === 0) return map;
  const { data: all } = await db
    .from("responsibles")
    .select("id, display_name");
  for (const r of all ?? []) {
    map.set(normalizeName(r.display_name as string), r.id as string);
  }
  for (const name of names) {
    const key = normalizeName(name);
    if (!key || map.has(key)) continue;
    const { data: created } = await db
      .from("responsibles")
      .insert({ display_name: name })
      .select("id")
      .maybeSingle();
    if (created?.id) map.set(key, created.id as string);
  }
  return map;
}

const EXISTING_COLS =
  "id, source_id, title, currency, closed, field_modified_at, last_synced_at, " +
  "custom_fields, responsible_id, operation_id, related_lead_id, lead_time_days, " +
  "value, mrr, stage, pipeline, channel, sale_type, closed_at, opened_at, " +
  "source_created_at";

function formulaCoreContext(
  recordType: string,
  eff: (col: string) => unknown
): Record<string, unknown> {
  return {
    value: eff("value"),
    mrr: eff("mrr"),
    lead_time_days: eff("lead_time_days"),
    title: eff("title"),
    record_type: recordType,
    source_system: IMPORT_SOURCE_SYSTEM,
    stage: eff("stage"),
    sale_type: eff("sale_type"),
    channel: eff("channel"),
    currency: eff("currency"),
    closed: eff("closed"),
  };
}

function dateCtxFor(
  eff: (col: string) => unknown,
  custom: Record<string, unknown>,
  customDateKeys: string[]
) {
  return buildDateContext(
    {
      closed_at: (eff("closed_at") as string | null) ?? null,
      opened_at: (eff("opened_at") as string | null) ?? null,
      source_created_at: (eff("source_created_at") as string | null) ?? null,
    },
    custom,
    customDateKeys
  );
}

/** Importa um lote de linhas já parseadas para a fonte dada. */
export async function ingestRows(
  db: SupabaseClient,
  opts: IngestOptions,
  rows: Record<string, unknown>[]
): Promise<SyncResult> {
  const result = emptyResult();
  const entity = opts.recordType;
  const now = new Date().toISOString();

  const [formulaDefs, customDateKeys] = await Promise.all([
    loadFormulaDefs(db),
    loadCustomDateKeys(db),
  ]);

  // 1) Constrói as linhas; deduplica DENTRO do chunk (primeira vence).
  const bySourceId = new Map<string, BuiltRow>();
  for (const raw of rows) {
    const built = buildRow(opts, raw);
    if (!built) {
      recordOutcome(result, entity, "skipped");
      continue;
    }
    if (bySourceId.has(built.sourceId)) {
      recordOutcome(result, entity, "skipped"); // duplicada no próprio arquivo
      continue;
    }
    bySourceId.set(built.sourceId, built);
  }
  if (bySourceId.size === 0) return result;
  const built = [...bySourceId.values()];

  // 2) Responsáveis (resolve/cria) + operação primária.
  const names = [...new Set(built.map((b) => b.responsibleName).filter(Boolean))] as string[];
  const responsibleByName = await resolveResponsibles(db, names);
  const operationByResponsible = new Map<string, string | null>();
  for (const id of new Set(responsibleByName.values())) {
    operationByResponsible.set(id, await primaryOperationId(db, id));
  }
  const responsibleIdOf = (b: BuiltRow): string | null =>
    b.responsibleName
      ? (responsibleByName.get(normalizeName(b.responsibleName)) ?? null)
      : null;

  // 3) Existentes deste chunk (uq_records_source: source_system + source_id).
  const { data: existingRows, error: selectError } = await db
    .from("records")
    .select(EXISTING_COLS)
    .eq("source_system", IMPORT_SOURCE_SYSTEM)
    .in("source_id", built.map((b) => b.sourceId));
  if (selectError) {
    recordError(result, entity, `select existentes: ${selectError.message}`);
    return result;
  }
  const existingBySourceId = new Map<string, ExistingRecord>();
  for (const r of existingRows ?? []) {
    existingBySourceId.set(
      (r as { source_id?: string }).source_id ?? "",
      r as unknown as ExistingRecord
    );
  }

  // 4) Inserts em lote.
  const toInsert = built.filter((b) => !existingBySourceId.has(b.sourceId));
  if (toInsert.length > 0) {
    const insertRows = toInsert.map((b) => {
      const responsibleId = responsibleIdOf(b);
      const custom = { ...b.custom };
      if (formulaDefs.length > 0) {
        const eff = (col: string) => b.core[col] ?? null;
        Object.assign(
          custom,
          computeFormulaFields(
            formulaCoreContext(opts.recordType, eff),
            custom,
            formulaDefs,
            undefined,
            dateCtxFor(eff, custom, customDateKeys)
          )
        );
      }
      return {
        record_type: opts.recordType,
        source_system: IMPORT_SOURCE_SYSTEM,
        source_id: b.sourceId,
        owner_user_id: null,
        responsible_id: responsibleId,
        operation_id: responsibleId
          ? (operationByResponsible.get(responsibleId) ?? null)
          : null,
        ...b.core,
        custom_fields: custom,
        field_modified_at: {},
        last_synced_at: now,
      };
    });
    const { error: insertError } = await db.from("records").insert(insertRows);
    if (insertError) {
      // Isola a(s) linha(s) problemática(s) sem derrubar o lote inteiro.
      for (const row of insertRows) {
        const { error: rowError } = await db.from("records").insert(row);
        if (rowError) recordError(result, entity, rowError.message);
        else recordOutcome(result, entity, "inserted");
      }
    } else {
      for (let i = 0; i < insertRows.length; i++) {
        recordOutcome(result, entity, "inserted");
      }
    }
  }

  // 5) Updates pontuais com conflito por campo (re-import).
  const audits: {
    record_id: string;
    field: string;
    old_value: unknown;
    new_value: unknown;
  }[] = [];
  for (const b of built) {
    const existing = existingBySourceId.get(b.sourceId);
    if (!existing) continue;
    try {
      const updates: Record<string, unknown> = { last_synced_at: now };
      let changed = false;

      for (const [col, value] of Object.entries(b.core)) {
        if (isProtected(col, existing)) continue;
        if (valuesDiffer(existing[col], value)) {
          audits.push({
            record_id: existing.id,
            field: col,
            old_value: existing[col] ?? null,
            new_value: value ?? null,
          });
          updates[col] = value;
          changed = true;
        }
      }

      const mergedCustom: Record<string, unknown> = {
        ...(existing.custom_fields ?? {}),
      };
      for (const [key, value] of Object.entries(b.custom)) {
        if (isProtected(key, existing)) continue;
        if (valuesDiffer(mergedCustom[key], value)) {
          audits.push({
            record_id: existing.id,
            field: key,
            old_value: mergedCustom[key] ?? null,
            new_value: value ?? null,
          });
          mergedCustom[key] = value;
          changed = true;
        }
      }

      const responsibleId = responsibleIdOf(b);
      if (
        responsibleId &&
        !isProtected("responsible_id", existing) &&
        valuesDiffer(existing.responsible_id, responsibleId)
      ) {
        updates.responsible_id = responsibleId;
        changed = true;
        if (!isProtected("operation_id", existing) && !existing.operation_id) {
          updates.operation_id = operationByResponsible.get(responsibleId) ?? null;
        }
      }

      if (!changed) {
        recordOutcome(result, entity, "skipped");
        continue;
      }

      // Campos calculados: recomputados sobre os valores efetivos.
      if (formulaDefs.length > 0) {
        const eff = (col: string) =>
          col in updates ? updates[col] : existing[col];
        Object.assign(
          mergedCustom,
          computeFormulaFields(
            formulaCoreContext(opts.recordType, eff),
            mergedCustom,
            formulaDefs,
            undefined,
            dateCtxFor(eff, mergedCustom, customDateKeys)
          )
        );
      }
      updates.custom_fields = mergedCustom;

      const { error: updateError } = await db
        .from("records")
        .update(updates)
        .eq("id", existing.id);
      if (updateError) throw new Error(updateError.message);
      recordOutcome(result, entity, "updated");
    } catch (e) {
      recordError(result, entity, (e as Error).message);
    }
  }

  if (audits.length > 0) {
    await db.from("audit_log").insert(
      audits.map((a) => ({
        ...a,
        user_id: opts.userId,
        origin: "import_csv" as const,
      }))
    );
  }

  return result;
}
