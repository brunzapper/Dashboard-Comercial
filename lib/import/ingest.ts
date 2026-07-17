// Versão: 2.0 | Data: 17/07/2026
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
// v2.0 (17/07/2026): modo MATCH POR COLUNA (opts.match) — em vez do namespace
// 'csv', cada linha procura um registro existente da FONTE (record_type,
// qualquer source_system) pelo valor de uma coluna escolhida. Linha com match
// atualiza (se updateExisting), sem match insere (se insertNew) ou é REJEITADA
// (contador noMatch — proteção contra inserção por falha de match). Fontes
// Bitrix com writeBack: updates enfileiram bitrix_writeback_queue e inclusões
// criam a entidade via createBitrixEntity (source_id real).
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
  enqueueWriteBacks,
  type WriteBackChange,
  type WriteBackEntity,
} from "@/lib/sync/bitrix/writeback";
import {
  createBitrixEntity,
  type BitrixCreateCustom,
} from "@/lib/sync/bitrix/create";
import { coreWriteBackFieldId } from "@/lib/config/core-writeback";
import {
  CORE_IMPORT_COLUMNS,
  coerceValue,
  coreTargetKind,
  type ColumnMapping,
  type MatchConfig,
} from "@/lib/import/csv";

export const IMPORT_SOURCE_SYSTEM = "csv";

export interface IngestOptions {
  sourceKey: string;
  recordType: string;
  mapping: ColumnMapping[];
  // Colunas do CSV que formam a chave de dedup; vazio = hash da linha inteira
  // (todas as colunas mapeadas), na ordem do mapping. Ignorado com `match`.
  dedupColumns: string[];
  // Modo match por coluna (upsert em fonte existente) — ver lib/import/csv.ts.
  match?: MatchConfig;
  // Autor do import (auditoria das atualizações).
  userId: string | null;
  // Origem na auditoria: 'import_csv' (wizard, padrão) ou 'api' (ingestão
  // via /api/ingest/<fonte> — ver 0074). Mesmo motor, fronts diferentes.
  auditOrigin?: "import_csv" | "api";
}

interface BuiltRow {
  sourceId: string;
  // Valor de match da linha (modo match; trim, igualdade exata).
  matchValue: string | null;
  core: Record<string, unknown>;
  custom: Record<string, unknown>;
  responsibleName: string | null;
}

interface FieldDefLite {
  field_key: string;
  label: string | null;
  data_type: string;
  source_system: string | null;
  source_field_id: string | null;
  write_back: boolean | null;
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

// source_id de um INSERT no modo match: com alvo source_id, o próprio valor
// (fica re-encontrável em reimports sob source_system='csv'); senão, hash
// determinístico do valor de match.
function matchInsertSourceId(
  sourceKey: string,
  match: MatchConfig,
  matchValue: string
): string {
  if (match.targetField === "source_id") return matchValue;
  return sha256(`${sourceKey}|match:${match.targetField}|${normalizeName(matchValue)}`);
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

  const matchValue = opts.match
    ? String(row[opts.match.csvColumn] ?? "").trim()
    : null;
  return {
    sourceId:
      opts.match && matchValue
        ? matchInsertSourceId(opts.sourceKey, opts.match, matchValue)
        : sourceIdForRow(opts.sourceKey, row, opts.dedupColumns, opts.mapping),
    matchValue,
    core,
    custom,
    responsibleName,
  };
}

// Resolve (ou cria) responsáveis por nome — mesma política do adapter da
// planilha (lib/sync/sheets/adapter.ts), em lote por chunk. Também devolve o
// vínculo Bitrix (bitrix_user_id) por responsável, p/ o write-back do import.
async function resolveResponsibles(
  db: SupabaseClient,
  names: string[]
): Promise<{
  byName: Map<string, string>;
  bitrixUserById: Map<string, string | null>;
}> {
  const byName = new Map<string, string>();
  const bitrixUserById = new Map<string, string | null>();
  if (names.length === 0) return { byName, bitrixUserById };
  const { data: all } = await db
    .from("responsibles")
    .select("id, display_name, bitrix_user_id");
  for (const r of all ?? []) {
    byName.set(normalizeName(r.display_name as string), r.id as string);
    bitrixUserById.set(
      r.id as string,
      (r.bitrix_user_id as string | null) ?? null
    );
  }
  for (const name of names) {
    const key = normalizeName(name);
    if (!key || byName.has(key)) continue;
    const { data: created } = await db
      .from("responsibles")
      .insert({ display_name: name })
      .select("id")
      .maybeSingle();
    if (created?.id) {
      byName.set(key, created.id as string);
      bitrixUserById.set(created.id as string, null);
    }
  }
  return { byName, bitrixUserById };
}

const EXISTING_COLS =
  "id, source_id, source_system, title, currency, closed, field_modified_at, last_synced_at, " +
  "custom_fields, responsible_id, operation_id, related_lead_id, lead_time_days, " +
  "value, mrr, stage, pipeline, channel, sale_type, closed_at, opened_at, " +
  "source_created_at";

function formulaCoreContext(
  recordType: string,
  sourceSystem: string,
  eff: (col: string) => unknown
): Record<string, unknown> {
  return {
    value: eff("value"),
    mrr: eff("mrr"),
    lead_time_days: eff("lead_time_days"),
    title: eff("title"),
    record_type: recordType,
    source_system: sourceSystem,
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

interface UpdateDeps {
  now: string;
  formulaDefs: Awaited<ReturnType<typeof loadFormulaDefs>>;
  customDateKeys: string[];
  responsibleIdOf: (b: BuiltRow) => string | null;
  operationByResponsible: Map<string, string | null>;
  audits: {
    record_id: string;
    field: string;
    old_value: unknown;
    new_value: unknown;
  }[];
}

// Atualização com conflito por campo (compartilhada pelos modos dedup e
// match). Retorna os campos efetivamente alterados (p/ write-back) ou null
// quando nada mudou. Lança em erro de banco.
async function applyUpdateToExisting(
  db: SupabaseClient,
  opts: IngestOptions,
  b: BuiltRow,
  existing: ExistingRecord,
  deps: UpdateDeps
): Promise<{ field: string; newValue: unknown }[] | null> {
  const { now, formulaDefs, customDateKeys, responsibleIdOf, operationByResponsible, audits } = deps;
  const updates: Record<string, unknown> = { last_synced_at: now };
  const changed: { field: string; newValue: unknown }[] = [];

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
      changed.push({ field: col, newValue: value ?? null });
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
      changed.push({ field: key, newValue: value ?? null });
    }
  }

  const responsibleId = responsibleIdOf(b);
  if (
    responsibleId &&
    !isProtected("responsible_id", existing) &&
    valuesDiffer(existing.responsible_id, responsibleId)
  ) {
    updates.responsible_id = responsibleId;
    changed.push({ field: "responsible_id", newValue: responsibleId });
    if (!isProtected("operation_id", existing) && !existing.operation_id) {
      updates.operation_id = operationByResponsible.get(responsibleId) ?? null;
    }
  }

  if (changed.length === 0) return null;

  // Campos calculados: recomputados sobre os valores efetivos.
  if (formulaDefs.length > 0) {
    const eff = (col: string) =>
      col in updates ? updates[col] : existing[col];
    Object.assign(
      mergedCustom,
      computeFormulaFields(
        formulaCoreContext(
          opts.recordType,
          (existing.source_system as string | null) ?? IMPORT_SOURCE_SYSTEM,
          eff
        ),
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
  return changed;
}

// Campos alterados que gravam de volta no Bitrix: custom marcado (write_back +
// source_field_id) e colunas do núcleo mapeadas (CORE_WRITEBACK) — o toggle do
// import é o "força" equivalente ao dos Registros. Responsável traduz o uuid
// local para o id de usuário do Bitrix (sem vínculo = fica local).
function collectWriteBackChanges(
  changed: { field: string; newValue: unknown }[],
  defsByKey: Map<string, FieldDefLite>,
  entity: WriteBackEntity,
  bitrixUserById: Map<string, string | null>
): WriteBackChange[] {
  const changes: WriteBackChange[] = [];
  for (const c of changed) {
    const d = defsByKey.get(c.field);
    if (d) {
      if (d.source_system !== "bitrix" || !d.source_field_id) continue;
      if (!d.write_back) continue;
      changes.push({
        fieldKey: c.field,
        sourceFieldId: d.source_field_id,
        label: d.label ?? null,
        newValue: c.newValue ?? null,
      });
      continue;
    }
    const sfid = coreWriteBackFieldId(c.field, entity);
    if (!sfid) continue;
    if (c.field === "responsible_id") {
      const respUuid = c.newValue == null ? null : String(c.newValue);
      const bitrixUserId = respUuid
        ? (bitrixUserById.get(respUuid) ?? null)
        : null;
      if (!bitrixUserId) continue;
      changes.push({
        fieldKey: c.field,
        sourceFieldId: sfid,
        label: c.field,
        newValue: bitrixUserId,
      });
      continue;
    }
    changes.push({
      fieldKey: c.field,
      sourceFieldId: sfid,
      label: c.field,
      newValue: c.newValue ?? null,
    });
  }
  return changes;
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
  const match = opts.match ?? null;

  const [formulaDefs, customDateKeys] = await Promise.all([
    loadFormulaDefs(db),
    loadCustomDateKeys(db),
  ]);

  // 1) Constrói as linhas; deduplica DENTRO do chunk (primeira vence). No modo
  //    match a chave do chunk é o próprio valor de match.
  const byKey = new Map<string, BuiltRow>();
  for (const raw of rows) {
    const built = buildRow(opts, raw);
    if (!built) {
      recordOutcome(result, entity, "skipped");
      continue;
    }
    if (match && !built.matchValue) {
      recordError(
        result,
        entity,
        `valor de match vazio na coluna "${match.csvColumn}"`
      );
      continue;
    }
    const key = match ? `m|${built.matchValue}` : built.sourceId;
    if (byKey.has(key)) {
      recordOutcome(result, entity, "skipped"); // duplicada no próprio arquivo
      continue;
    }
    byKey.set(key, built);
  }
  if (byKey.size === 0) return result;
  const built = [...byKey.values()];

  // 2) Responsáveis (resolve/cria) + operação primária.
  const names = [...new Set(built.map((b) => b.responsibleName).filter(Boolean))] as string[];
  const { byName: responsibleByName, bitrixUserById } =
    await resolveResponsibles(db, names);
  const operationByResponsible = new Map<string, string | null>();
  for (const id of new Set(responsibleByName.values())) {
    operationByResponsible.set(id, await primaryOperationId(db, id));
  }
  const responsibleIdOf = (b: BuiltRow): string | null =>
    b.responsibleName
      ? (responsibleByName.get(normalizeName(b.responsibleName)) ?? null)
      : null;

  // 3) Existentes deste chunk.
  //    - modo dedup: (source_system='csv', source_id) — chave uq_records_source;
  //    - modo match: registros da FONTE (record_type, is_mock=false) cujo campo
  //      de match casa com algum valor do chunk (sub-lotes p/ URL curta).
  const existingByKey = new Map<string, ExistingRecord[]>();
  if (!match) {
    const { data: existingRows, error: selectError } = await db
      .from("records")
      .select(EXISTING_COLS)
      .eq("source_system", IMPORT_SOURCE_SYSTEM)
      .in("source_id", built.map((b) => b.sourceId));
    if (selectError) {
      recordError(result, entity, `select existentes: ${selectError.message}`);
      return result;
    }
    for (const r of existingRows ?? []) {
      const key = ((r as { source_id?: string }).source_id ?? "") as string;
      (existingByKey.get(key) ?? existingByKey.set(key, []).get(key))!.push(
        r as unknown as ExistingRecord
      );
    }
  } else {
    const matchColumn = match.targetField.startsWith("custom:")
      ? `custom_fields->>${match.targetField.slice("custom:".length)}`
      : match.targetField.startsWith("core:")
        ? match.targetField.slice("core:".length)
        : "source_id";
    const values = built.map((b) => b.matchValue as string);
    const LOOKUP_BATCH = 100;
    for (let i = 0; i < values.length; i += LOOKUP_BATCH) {
      const slice = values.slice(i, i + LOOKUP_BATCH);
      const { data: existingRows, error: selectError } = await db
        .from("records")
        .select(EXISTING_COLS + `, match_value:${matchColumn}`)
        .eq("record_type", opts.recordType)
        .eq("is_mock", false)
        .in(matchColumn, slice);
      if (selectError) {
        recordError(result, entity, `select existentes: ${selectError.message}`);
        return result;
      }
      for (const r of existingRows ?? []) {
        const key = String(
          (r as { match_value?: unknown }).match_value ?? ""
        ).trim();
        if (!key) continue;
        (existingByKey.get(key) ?? existingByKey.set(key, []).get(key))!.push(
          r as unknown as ExistingRecord
        );
      }
    }
  }

  const existingOf = (b: BuiltRow): ExistingRecord[] =>
    existingByKey.get(match ? (b.matchValue as string) : b.sourceId) ?? [];

  // Write-back do modo match: só fontes Bitrix (lead/negocio).
  const wbEntity: WriteBackEntity | null =
    match?.writeBack && entity === "lead"
      ? "lead"
      : match?.writeBack && entity === "negocio"
        ? "deal"
        : null;
  let defsByKey = new Map<string, FieldDefLite>();
  if (wbEntity) {
    const { data: defs } = await db
      .from("field_definitions")
      .select(
        "field_key, label, data_type, source_system, source_field_id, write_back"
      );
    defsByKey = new Map(
      ((defs ?? []) as FieldDefLite[]).map((d) => [d.field_key, d])
    );
  }

  // 4) Inserts.
  //    - Sem match (modo dedup) ou linha sem correspondente com insertNew: em
  //      lote sob source_system='csv'.
  //    - insertNew + write-back Bitrix: criação SÍNCRONA no CRM linha a linha
  //      (o wizard reduz o chunk p/ caber no teto de tempo).
  const insertable = built.filter((b) => {
    if (existingOf(b).length !== 0) return false;
    if (match && !match.insertNew) {
      // ☐ "Incluir novos": linha sem match é rejeitada — NUNCA insere.
      result.noMatch = (result.noMatch ?? 0) + 1;
      recordOutcome(result, entity, "skipped");
      return false;
    }
    return true;
  });

  const buildInsertRow = (b: BuiltRow) => {
    const responsibleId = responsibleIdOf(b);
    const custom = { ...b.custom };
    if (formulaDefs.length > 0) {
      const eff = (col: string) => b.core[col] ?? null;
      Object.assign(
        custom,
        computeFormulaFields(
          formulaCoreContext(opts.recordType, IMPORT_SOURCE_SYSTEM, eff),
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
  };

  if (wbEntity && insertable.length > 0) {
    // Criação no Bitrix + espelho local com o source_id retornado.
    for (const b of insertable) {
      try {
        const responsibleId = responsibleIdOf(b);
        const customs: BitrixCreateCustom[] = [];
        for (const [key, value] of Object.entries(b.custom)) {
          if (value == null) continue;
          const d = defsByKey.get(key);
          if (d?.source_system === "bitrix" && d.source_field_id) {
            customs.push({
              sourceFieldId: d.source_field_id,
              label: d.label ?? key,
              value,
            });
          }
        }
        const created = await createBitrixEntity({
          entity: wbEntity,
          core: {
            title: (b.core.title as string | null) ?? null,
            value: (b.core.value as number | null) ?? null,
            mrr: (b.core.mrr as number | null) ?? null,
            currency: (b.core.currency as string | null) ?? null,
            channel: (b.core.channel as string | null) ?? null,
            sale_type: (b.core.sale_type as string | null) ?? null,
            closed_at: (b.core.closed_at as string | null) ?? null,
            opened_at: (b.core.opened_at as string | null) ?? null,
          },
          customs,
          assignedBitrixUserId: responsibleId
            ? (bitrixUserById.get(responsibleId) ?? null)
            : null,
        });
        const row = {
          ...buildInsertRow(b),
          source_system: "bitrix",
          source_id: created.sourceId,
        };
        const { error: insertError } = await db.from("records").insert(row);
        if (insertError) throw new Error(insertError.message);
        recordOutcome(result, entity, "inserted");
      } catch (e) {
        recordError(result, entity, (e as Error).message);
      }
    }
  } else if (insertable.length > 0) {
    const insertRows = insertable.map(buildInsertRow);
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

  // 5) Updates pontuais com conflito por campo.
  const audits: UpdateDeps["audits"] = [];
  const deps: UpdateDeps = {
    now,
    formulaDefs,
    customDateKeys,
    responsibleIdOf,
    operationByResponsible,
    audits,
  };
  for (const b of built) {
    const candidates = existingOf(b);
    if (candidates.length === 0) continue;
    if (candidates.length > 1) {
      result.ambiguous = (result.ambiguous ?? 0) + 1;
      recordError(
        result,
        entity,
        `match ambíguo: "${b.matchValue}" casa ${candidates.length} registros`
      );
      continue;
    }
    if (match && !match.updateExisting) {
      result.alreadyExists = (result.alreadyExists ?? 0) + 1;
      recordOutcome(result, entity, "skipped");
      continue;
    }
    const existing = candidates[0];
    try {
      const changed = await applyUpdateToExisting(db, opts, b, existing, deps);
      if (!changed) {
        recordOutcome(result, entity, "skipped");
        continue;
      }
      recordOutcome(result, entity, "updated");
      // Write-back: registro do Bitrix + toggle ligado → enfileira os campos
      // alterados graváveis (a fila é drenada pelo tick, nada síncrono).
      if (wbEntity && existing.source_system === "bitrix" && existing.source_id) {
        const changes = collectWriteBackChanges(
          changed,
          defsByKey,
          wbEntity,
          bitrixUserById
        );
        if (changes.length > 0) {
          try {
            await enqueueWriteBacks(db, {
              recordId: existing.id,
              entity: wbEntity,
              sourceId: existing.source_id as string,
              createdBy: opts.userId,
              changes,
            });
          } catch {
            // best-effort: a fila nunca derruba o import.
          }
        }
      }
    } catch (e) {
      recordError(result, entity, (e as Error).message);
    }
  }

  if (audits.length > 0) {
    await db.from("audit_log").insert(
      audits.map((a) => ({
        ...a,
        user_id: opts.userId,
        origin: opts.auditOrigin ?? "import_csv",
      }))
    );
  }

  return result;
}
