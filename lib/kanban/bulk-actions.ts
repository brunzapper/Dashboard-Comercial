// Versão: 1.0 | Data: 27/07/2026
// Server Actions das AÇÕES EM MASSA do kanban. Contrato: resultado POR ITEM
// ({ id, ok, message }) — o cliente aplica otimista e reverte SÓ o que falhou.
// Client do USUÁRIO (RLS manda: `.select` pós-update/delete vazio = negado
// naquele item); teto de 200 itens por chamada (o cliente fatia); SEM
// revalidatePath (o quadro reconcilia via fila otimista + refresh debounced —
// padrão saveQuickTableCells). Mover em massa espelha moveRecordCard
// (Personalizar = upsert de posicionamentos; bucket de data = computeDateOnMove
// por item — ação EXPLÍCITA do usuário, diferente de automação; valor = escrita
// batelada enxuta com UM recalc + UM insert de audit + write-back opcional).
// Excluir REGISTROS é gate de ADMIN na action (espelha a RLS records_delete,
// 0091) além do diálogo de confirmação na UI; mocks são pulados por item
// (congelados no produto). Exclusão emite record.deleted (integrações não
// podem ficar cegas a hard-delete).
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { emitWebhookEvent } from "@/lib/webhooks/emit";
import {
  enqueueWriteBacks,
  type WriteBackChange,
} from "@/lib/sync/bitrix/writeback";
import { coreWriteBackFieldId } from "@/lib/config/core-writeback";
import { recalcFormulaFieldsForRecords } from "@/lib/records/recalc";
import type { DataType } from "@/lib/records/types";
import { todayBrasiliaIso } from "@/lib/date/today";
import { computeDateOnMove } from "./date-move";
import {
  KANBAN_NO_VALUE_KEY,
  KANBAN_OVERFLOW_KEY,
  type KanbanDateBucket,
} from "./types";
import {
  BULK_MAX_ITEMS,
  chunk,
  fanOut,
  mapLimited,
  resultsFromReturned,
  type BulkActionState,
  type BulkItemResult,
} from "./bulk-helpers";

export type { BulkActionState, BulkItemResult };

const CHUNK = 200;
const CONCURRENCY = 5;

export interface BulkMoveInput {
  items: { recordId: string; currentDateValue: string | null }[];
  targetKey: string;
  groupField?: string;
  dateField?: string;
  dateBucket?: KanbanDateBucket;
  writeBack?: boolean;
  custom?: { ownerKind: "widget" | "board"; ownerId: string };
}

interface FreshRecord {
  id: string;
  is_mock: boolean | null;
  record_type: string;
  source_system: string | null;
  source_id: string | null;
  custom_fields: Record<string, unknown> | null;
  field_modified_at: Record<string, string> | null;
  [k: string]: unknown;
}

// Mesma coerção do updateRecord p/ valor custom (chave da coluna → tipo).
function coerceCustom(dataType: DataType | undefined, s: string): unknown {
  if (dataType === "numero" || dataType === "moeda") {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (dataType === "booleano")
    return s === "true" ? true : s === "false" ? false : null;
  return s;
}

/** Move N cards de registro para uma coluna (uma chamada por coluna destino). */
export async function moveRecordCardsBulk(
  input: BulkMoveInput
): Promise<BulkActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (input.targetKey === KANBAN_OVERFLOW_KEY) {
    return { ok: false, message: 'A coluna "Outros" não recebe cards.' };
  }
  const ids = input.items.map((i) => i.recordId);
  if (ids.length === 0) return { ok: true, results: [] };
  if (ids.length > BULK_MAX_ITEMS) {
    return { ok: false, message: `Máximo de ${BULK_MAX_ITEMS} cards por chamada.` };
  }
  const supabase = await createClient();

  // Estado atual (RLS recorta): mocks e não-encontrados falham por item.
  const freshById = new Map<string, FreshRecord>();
  for (const slice of chunk(ids, CHUNK)) {
    const { data, error } = await supabase
      .from("records")
      .select(
        "id, is_mock, record_type, source_system, source_id, custom_fields, field_modified_at, stage, pipeline, channel, sale_type, responsible_id, operation_id"
      )
      .in("id", slice);
    if (error) return { ok: false, message: error.message };
    for (const r of (data ?? []) as FreshRecord[]) freshById.set(r.id, r);
  }
  const results: BulkItemResult[] = [];
  const movable: typeof input.items = [];
  for (const item of input.items) {
    const rec = freshById.get(item.recordId);
    if (!rec) {
      results.push({
        id: item.recordId,
        ok: false,
        message: "Registro não encontrado (ou sem permissão).",
      });
    } else if (rec.is_mock) {
      results.push({
        id: item.recordId,
        ok: false,
        message: "Registro de demonstração (congelado).",
      });
    } else {
      movable.push(item);
    }
  }
  if (movable.length === 0) return { ok: true, results };

  // ---- Colunas "Personalizar": upsert multi-linha (all-or-nothing por lote;
  // RLS de kanban_placements é por QUADRO, então o resultado único vale p/
  // todos os itens do lote). Não toca no registro. ----
  if (input.custom) {
    const ownerCol =
      input.custom.ownerKind === "widget" ? "widget_id" : "board_id";
    for (const slice of chunk(movable, CHUNK)) {
      const { data, error } = await supabase
        .from("kanban_placements")
        .upsert(
          slice.map((m, j) => ({
            [ownerCol]: input.custom!.ownerId,
            record_id: m.recordId,
            column_key: input.targetKey,
            position: -(Date.now() + j),
            updated_by: session.user.id,
          })),
          { onConflict: `${ownerCol},record_id` }
        )
        .select("id");
      const sliceIds = slice.map((m) => m.recordId);
      if (error) {
        results.push(...fanOut(sliceIds, false, error.message));
      } else if (!data || data.length === 0) {
        results.push(
          ...fanOut(sliceIds, false, "Sem permissão para mover neste quadro.")
        );
      } else {
        results.push(...fanOut(sliceIds, true));
      }
    }
    return { ok: true, results };
  }

  // ---- Valor de campo / bucket de data: escrita batelada enxuta ----
  const isDate = Boolean(input.dateBucket && input.dateField);
  const field = isDate ? input.dateField! : input.groupField || "stage";
  const isCustomField = field.startsWith("custom:");
  const customKey = isCustomField ? field.slice("custom:".length) : null;

  // Def do campo custom (coerção + gating de write-back) — 1 consulta.
  interface CustomDefRow {
    data_type: DataType;
    label: string | null;
    source_system: string | null;
    source_field_id: string | null;
  }
  let customDef: CustomDefRow | null = null;
  if (customKey) {
    const { data } = await supabase
      .from("field_definitions")
      .select("data_type, label, source_system, source_field_id")
      .eq("field_key", customKey)
      .maybeSingle();
    customDef = (data as CustomDefRow | null) ?? null;
  }

  const now = new Date().toISOString();
  const audits: {
    record_id: string;
    field: string;
    old_value: unknown;
    new_value: unknown;
  }[] = [];

  const writeResults = await mapLimited(movable, CONCURRENCY, async (item) => {
    const rec = freshById.get(item.recordId)!;
    // Valor destino: coluna de valor limpa com "Sem valor"; bucket calcula a
    // data concreta relativa ao valor atual do card (regras D9).
    let rawValue: string | null;
    if (isDate) {
      rawValue =
        input.targetKey === KANBAN_NO_VALUE_KEY
          ? null
          : computeDateOnMove(
              item.currentDateValue ?? null,
              input.dateBucket!,
              input.targetKey,
              todayBrasiliaIso()
            );
      if (input.targetKey !== KANBAN_NO_VALUE_KEY && rawValue == null) {
        return {
          id: item.recordId,
          ok: false,
          message: "Não foi possível calcular a data da coluna destino.",
        };
      }
    } else {
      rawValue = input.targetKey === KANBAN_NO_VALUE_KEY ? null : input.targetKey;
    }
    const fmod = { ...(rec.field_modified_at ?? {}) };
    const updates: Record<string, unknown> = { locally_modified_at: now };
    let auditField: string;
    let oldValue: unknown;
    let newValue: unknown;
    if (customKey) {
      const custom = { ...(rec.custom_fields ?? {}) };
      oldValue = custom[customKey] ?? null;
      newValue =
        rawValue == null ? null : coerceCustom(customDef?.data_type, rawValue);
      custom[customKey] = newValue;
      updates.custom_fields = custom;
      fmod[customKey] = now;
      auditField = customKey;
    } else {
      oldValue = rec[field] ?? null;
      newValue = rawValue;
      updates[field] = newValue;
      fmod[field] = now;
      auditField = field;
    }
    updates.field_modified_at = fmod;
    const { data, error } = await supabase
      .from("records")
      .update(updates)
      .eq("id", item.recordId)
      .select("id");
    if (error) return { id: item.recordId, ok: false, message: error.message };
    if (!data || data.length === 0) {
      return {
        id: item.recordId,
        ok: false,
        message: "Sem permissão para editar este registro.",
      };
    }
    audits.push({
      record_id: item.recordId,
      field: auditField,
      old_value: oldValue,
      new_value: newValue,
    });
    return { id: item.recordId, ok: true } as BulkItemResult;
  });
  results.push(...writeResults);
  const okIds = writeResults.filter((r) => r.ok).map((r) => r.id);
  if (okIds.length === 0) return { ok: true, results };

  // ---- Efeitos em lote (a escrita já está persistida; best-effort) ----
  try {
    await recalcFormulaFieldsForRecords(okIds);
  } catch (e) {
    console.warn("[kanban-bulk] recalc pós-move falhou:", e);
  }
  if (audits.length > 0) {
    await supabase.from("audit_log").insert(
      audits.map((a) => ({
        record_id: a.record_id,
        user_id: session.user.id,
        field: a.field,
        old_value: a.old_value ?? null,
        new_value: a.new_value ?? null,
        origin: "app" as const,
      }))
    );
  }

  const orgId = await getActiveOrgId();
  const auditByRecord = new Map(audits.map((a) => [a.record_id, a]));

  // Write-back opcional (settings.kanban.writeBack — mesma marca do
  // moveRecordCard): campo custom de Sync ou coluna core mapeada.
  if (input.writeBack) {
    for (const id of okIds) {
      const rec = freshById.get(id);
      const audit = auditByRecord.get(id);
      if (!rec || !audit || rec.source_system !== "bitrix" || !rec.source_id)
        continue;
      const entity =
        rec.record_type === "negocio"
          ? ("deal" as const)
          : rec.record_type === "lead"
            ? ("lead" as const)
            : null;
      if (!entity) continue;
      const changes: WriteBackChange[] = [];
      if (customDef) {
        if (customDef.source_system === "bitrix" && customDef.source_field_id) {
          changes.push({
            fieldKey: audit.field,
            sourceFieldId: customDef.source_field_id,
            label: customDef.label ?? null,
            newValue: audit.new_value ?? null,
          });
        }
      } else {
        const sfid = coreWriteBackFieldId(audit.field, entity);
        // responsible_id exigiria tradução p/ usuário Bitrix — fora do bulk.
        if (sfid && audit.field !== "responsible_id") {
          changes.push({
            fieldKey: audit.field,
            sourceFieldId: sfid,
            label: audit.field,
            newValue: audit.new_value ?? null,
          });
        }
      }
      if (changes.length > 0) {
        try {
          await enqueueWriteBacks(createServiceClient(), {
            recordId: id,
            entity,
            sourceId: rec.source_id,
            createdBy: session.user.id,
            changes,
          });
        } catch {
          // best-effort — a fila indisponível nunca desfaz a edição local.
        }
      }
    }
  }

  for (const id of okIds) {
    const a = auditByRecord.get(id);
    if (!a) continue;
    await emitWebhookEvent(
      "record.updated",
      {
        recordId: id,
        changes: [
          {
            field: a.field,
            old_value: a.old_value ?? null,
            new_value: a.new_value ?? null,
          },
        ],
      },
      orgId
    );
  }
  return { ok: true, results };
}

/** Cria UMA tarefa por card selecionado (título comum; prazo/resp. opcionais). */
export async function createTasksBulk(input: {
  recordIds: string[];
  title: string;
  due_date?: string | null;
  responsible_id?: string | null;
  locked?: boolean;
}): Promise<BulkActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const title = input.title.trim().slice(0, 300);
  if (!title) return { ok: false, message: "Informe o título da tarefa." };
  const ids = [...new Set(input.recordIds)].filter(Boolean);
  if (ids.length === 0) return { ok: true, results: [] };
  if (ids.length > BULK_MAX_ITEMS) {
    return { ok: false, message: `Máximo de ${BULK_MAX_ITEMS} cards por chamada.` };
  }
  const supabase = await createClient();
  const viewAll = session.permissions.includes("view_all_records");
  // Coerção de responsável (espelha createTask): vendedor só atribui aos seus.
  let responsibleId = input.responsible_id ?? null;
  if (!viewAll && responsibleId != null) {
    const { data: own } = await supabase
      .from("responsibles")
      .select("id")
      .eq("user_id", session.user.id)
      .eq("active", true);
    const ownIds = (own ?? []).map((r) => r.id as string);
    responsibleId = ownIds.includes(responsibleId)
      ? responsibleId
      : (ownIds[0] ?? null);
  }
  const dueDate =
    input.due_date && /^\d{4}-\d{2}-\d{2}$/.test(input.due_date)
      ? input.due_date
      : null;
  const orgId = await getActiveOrgId();
  const results: BulkItemResult[] = [];
  const createdIds: string[] = [];
  for (const slice of chunk(ids, CHUNK)) {
    const { data, error } = await supabase
      .from("tasks")
      .insert(
        slice.map((recordId, j) => ({
          ...(orgId ? { organization_id: orgId } : {}),
          title,
          record_id: recordId,
          due_date: dueDate,
          responsible_id: responsibleId,
          created_by: session.user.id,
          position: -(Date.now() + j),
          locked: Boolean(input.locked),
        }))
      )
      .select("id, record_id");
    if (error) {
      results.push(...fanOut(slice, false, error.message));
      continue;
    }
    const byRecord = new Map(
      (data ?? []).map((t) => [t.record_id as string, t.id as string])
    );
    for (const recordId of slice) {
      const taskId = byRecord.get(recordId);
      if (taskId) {
        createdIds.push(taskId);
        results.push({ id: recordId, ok: true });
      } else {
        results.push({ id: recordId, ok: false, message: "Tarefa não criada." });
      }
    }
  }
  for (const taskId of createdIds) {
    await emitWebhookEvent("task.created", { taskId, title }, orgId);
  }
  return { ok: true, results };
}

/**
 * Conclui tarefas em massa: por REGISTRO (todas as abertas dos cards
 * selecionados — modo registros) ou por TAREFA (cards do modo tarefas).
 */
export async function completeTasksBulk(input: {
  recordIds?: string[];
  taskIds?: string[];
}): Promise<BulkActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  const now = new Date().toISOString();
  const orgId = await getActiveOrgId();

  // ---- modo tarefas: conclui as selecionadas ----
  if (input.taskIds && input.taskIds.length > 0) {
    const ids = [...new Set(input.taskIds)].filter(Boolean);
    if (ids.length > BULK_MAX_ITEMS) {
      return { ok: false, message: `Máximo de ${BULK_MAX_ITEMS} por chamada.` };
    }
    const done: string[] = [];
    for (const slice of chunk(ids, CHUNK)) {
      const { data, error } = await supabase
        .from("tasks")
        .update({ completed_at: now, completed_by: session.user.id })
        .in("id", slice)
        .is("completed_at", null)
        .select("id");
      if (error) return { ok: false, message: error.message };
      for (const t of data ?? []) done.push(t.id as string);
    }
    for (const taskId of done) {
      await emitWebhookEvent("task.completed", { taskId }, orgId);
    }
    return {
      ok: true,
      results: resultsFromReturned(
        ids,
        done,
        "Sem permissão (ou tarefa já concluída)."
      ),
    };
  }

  // ---- modo registros: conclui as ABERTAS dos cards selecionados ----
  const recordIds = [...new Set(input.recordIds ?? [])].filter(Boolean);
  if (recordIds.length === 0) return { ok: true, results: [] };
  if (recordIds.length > BULK_MAX_ITEMS) {
    return { ok: false, message: `Máximo de ${BULK_MAX_ITEMS} por chamada.` };
  }
  // Abertas visíveis (RLS recorta) → update → diff por registro.
  const openByRecord = new Map<string, string[]>();
  for (const slice of chunk(recordIds, CHUNK)) {
    const { data, error } = await supabase
      .from("tasks")
      .select("id, record_id")
      .in("record_id", slice)
      .is("completed_at", null);
    if (error) return { ok: false, message: error.message };
    for (const t of data ?? []) {
      const rid = t.record_id as string;
      if (!openByRecord.has(rid)) openByRecord.set(rid, []);
      openByRecord.get(rid)!.push(t.id as string);
    }
  }
  const allTaskIds = [...openByRecord.values()].flat();
  const done = new Set<string>();
  for (const slice of chunk(allTaskIds, CHUNK)) {
    const { data, error } = await supabase
      .from("tasks")
      .update({ completed_at: now, completed_by: session.user.id })
      .in("id", slice)
      .select("id");
    if (error) return { ok: false, message: error.message };
    for (const t of data ?? []) done.add(t.id as string);
  }
  for (const taskId of done) {
    await emitWebhookEvent("task.completed", { taskId }, orgId);
  }
  const results: BulkItemResult[] = recordIds.map((rid) => {
    const own = openByRecord.get(rid) ?? [];
    const missing = own.filter((t) => !done.has(t));
    if (own.length === 0)
      return { id: rid, ok: true, message: "Sem tarefas abertas." };
    if (missing.length > 0)
      return {
        id: rid,
        ok: false,
        message: `${missing.length} tarefa(s) sem permissão para concluir.`,
      };
    return { id: rid, ok: true };
  });
  return { ok: true, results };
}

/**
 * EXCLUI registros de verdade (cascade: tarefas/posicionamentos/conexões).
 * Gate de ADMIN na action (espelha a RLS records_delete); mocks pulados por
 * item. A UI SEMPRE confirma antes.
 */
export async function deleteRecordsBulk(
  recordIds: string[]
): Promise<BulkActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.roles.includes("admin")) {
    return {
      ok: false,
      message: "Só administradores podem excluir registros.",
    };
  }
  const ids = [...new Set(recordIds)].filter(Boolean);
  if (ids.length === 0) return { ok: true, results: [] };
  if (ids.length > BULK_MAX_ITEMS) {
    return { ok: false, message: `Máximo de ${BULK_MAX_ITEMS} por chamada.` };
  }
  const supabase = await createClient();
  const results: BulkItemResult[] = [];
  const deletable: string[] = [];
  for (const slice of chunk(ids, CHUNK)) {
    const { data, error } = await supabase
      .from("records")
      .select("id, is_mock")
      .in("id", slice);
    if (error) return { ok: false, message: error.message };
    const found = new Map(
      (data ?? []).map((r) => [r.id as string, Boolean(r.is_mock)])
    );
    for (const id of slice) {
      if (!found.has(id)) {
        results.push({ id, ok: false, message: "Registro não encontrado." });
      } else if (found.get(id)) {
        results.push({
          id,
          ok: false,
          message: "Registro de demonstração (congelado).",
        });
      } else {
        deletable.push(id);
      }
    }
  }
  const orgId = await getActiveOrgId();
  const deleted: string[] = [];
  for (const slice of chunk(deletable, CHUNK)) {
    const { data, error } = await supabase
      .from("records")
      .delete()
      .in("id", slice)
      .select("id");
    if (error) {
      results.push(...fanOut(slice, false, error.message));
      continue;
    }
    for (const r of data ?? []) deleted.push(r.id as string);
    results.push(
      ...resultsFromReturned(
        slice,
        (data ?? []).map((r) => r.id as string),
        "Sem permissão para excluir."
      )
    );
  }
  for (const recordId of deleted) {
    await emitWebhookEvent("record.deleted", { recordId }, orgId);
  }
  return { ok: true, results };
}

/** Exclui tarefas em massa (RLS: travada/de outro usuário falha por item). */
export async function deleteTasksBulk(
  taskIds: string[]
): Promise<BulkActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const ids = [...new Set(taskIds)].filter(Boolean);
  if (ids.length === 0) return { ok: true, results: [] };
  if (ids.length > BULK_MAX_ITEMS) {
    return { ok: false, message: `Máximo de ${BULK_MAX_ITEMS} por chamada.` };
  }
  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  const deleted: { id: string; title: string | null; record_id: string | null }[] =
    [];
  const results: BulkItemResult[] = [];
  for (const slice of chunk(ids, CHUNK)) {
    const { data, error } = await supabase
      .from("tasks")
      .delete()
      .in("id", slice)
      .select("id, title, record_id");
    if (error) {
      results.push(...fanOut(slice, false, error.message));
      continue;
    }
    const rows = (data ?? []).map((t) => ({
      id: t.id as string,
      title: (t.title as string) ?? null,
      record_id: (t.record_id as string | null) ?? null,
    }));
    deleted.push(...rows);
    results.push(
      ...resultsFromReturned(
        slice,
        rows.map((r) => r.id),
        "Sem permissão — a tarefa está travada ou pertence a outro usuário."
      )
    );
  }
  for (const t of deleted) {
    await emitWebhookEvent(
      "task.deleted",
      { taskId: t.id, title: t.title, recordId: t.record_id },
      orgId
    );
  }
  return { ok: true, results };
}
