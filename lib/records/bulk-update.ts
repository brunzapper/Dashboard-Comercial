// Versão: 1.0 | Data: 31/07/2026
// Escrita EM LOTE de valores de registros — choke point do apply do contrato
// registros-update (lib/ai/update-records.ts). Padrão batelada de
// moveRecordCardsBulk (lib/kanban/bulk-actions.ts) generalizado p/ N campos
// por registro: leitura fresca chunked, UPDATE por item com `.select("id")`
// (RLS nega por item — client do USUÁRIO, nunca service role), UM
// recalcFormulaFieldsForRecords, UM insert de audit_log (linha por
// registro×campo, origin 'app', user real) e webhook record.updated por
// registro com o array completo de mudanças. Coerção pela régua do
// updateRecord (coerce/coerceCore — datas core ancoradas em Brasília,
// invariante 11), NUNCA a simplificada do kanban. Idempotente por item: valor
// efetivo igual não escreve ("Sem alterações."); mock é pulado e reportado.
// Write-back Bitrix fica FORA no v1 (escrita local; carimbos
// field_modified_at + locally_modified_at protegem do reconcile).
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getActiveOrgId } from "@/lib/auth/org";
import { emitWebhookEvent } from "@/lib/webhooks/emit";
import { recalcFormulaFieldsForRecords } from "@/lib/records/recalc";
import { coerce, coerceCore, coreEquals } from "@/lib/records/coerce";
import type { DataType } from "@/lib/records/types";
import {
  BULK_MAX_ITEMS,
  chunk,
  mapLimited,
  type BulkItemResult,
} from "@/lib/kanban/bulk-helpers";
import type { EntryFieldSpec } from "@/lib/import/records/types";
import type { UpdateChangeValue } from "@/lib/import/records/update-types";

const CHUNK = 200;
const CONCURRENCY = 5;

export interface BulkUpdateInput {
  /** Alterações CANÔNICAS por chave do contrato (null = limpar o campo). */
  changes: Record<string, UpdateChangeValue>;
  /** Presente só quando "alteracoes" tocou a relação (UUID resolvido). */
  responsibleId?: string | null;
  operationId?: string | null;
  /** Catálogo dos ALVOS (RecordsUpdateContext.fields — tipos p/ coerção). */
  fields: EntryFieldSpec[];
  /** Autor (audit_log.user_id). */
  userId: string;
}

export interface BulkUpdateOutcome {
  results: BulkItemResult[];
  /** Registros efetivamente ESCRITOS (sem os no-op/pulados/negados). */
  changedCount: number;
}

interface FreshRow {
  id: string;
  is_mock: boolean | null;
  custom_fields: Record<string, unknown> | null;
  field_modified_at: Record<string, string> | null;
  responsible_id: string | null;
  operation_id: string | null;
  [k: string]: unknown;
}

interface AuditRow {
  record_id: string;
  field: string;
  old_value: unknown;
  new_value: unknown;
}

/**
 * Aplica o MESMO conjunto de alterações a até 200 registros. O chamador já
 * validou o contrato e resolveu os ids (prévia server-side); aqui re-checamos
 * o estado FRESCO (mock/permissão/no-op) por item — defesa em profundidade.
 */
export async function updateRecordValuesBulk(
  supabase: SupabaseClient,
  recordIds: string[],
  input: BulkUpdateInput
): Promise<BulkUpdateOutcome> {
  const ids = [...new Set(recordIds)].filter(Boolean);
  if (ids.length === 0) return { results: [], changedCount: 0 };
  if (ids.length > BULK_MAX_ITEMS) {
    throw new Error(`Máximo de ${BULK_MAX_ITEMS} registros por chamada.`);
  }

  const specByKey = new Map(input.fields.map((f) => [f.key, f]));

  // Planejamento das escritas por família (core/custom) a partir das chaves do
  // contrato — relações chegam resolvidas em responsibleId/operationId.
  const coreChanges: { col: string; dataType: DataType; value: unknown }[] = [];
  const customChanges: { key: string; value: unknown }[] = [];
  for (const [key, raw] of Object.entries(input.changes)) {
    if (key === "responsible_id" || key === "operation_id") continue;
    const spec = specByKey.get(key);
    if (!spec) throw new Error(`Alteração fora do catálogo: "${key}".`);
    if (spec.kind === "core") {
      const dt = spec.dataType as DataType;
      coreChanges.push({
        col: key,
        dataType: dt,
        value: raw == null ? null : coerceCore(dt, String(raw)),
      });
    } else {
      customChanges.push({
        key: key.slice("custom:".length),
        value: raw == null ? null : coerce(spec.dataType as DataType, String(raw)),
      });
    }
  }
  const touchResponsible = input.responsibleId !== undefined;
  const touchOperation = input.operationId !== undefined;

  // Estado fresco (RLS recorta): colunas core alteradas + insumos fixos.
  const coreCols = coreChanges.map((c) => c.col);
  const selectCols = [
    "id",
    "is_mock",
    "custom_fields",
    "field_modified_at",
    "responsible_id",
    "operation_id",
    ...coreCols,
  ];
  const freshById = new Map<string, FreshRow>();
  for (const slice of chunk(ids, CHUNK)) {
    const { data, error } = await supabase
      .from("records")
      .select([...new Set(selectCols)].join(", "))
      .in("id", slice);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as unknown as FreshRow[]) freshById.set(r.id, r);
  }

  const now = new Date().toISOString();
  const audits: AuditRow[] = [];
  const changedIds: string[] = [];

  const results = await mapLimited(ids, CONCURRENCY, async (id) => {
    const rec = freshById.get(id);
    if (!rec) {
      return {
        id,
        ok: false,
        message: "Registro não encontrado (ou sem permissão).",
      } as BulkItemResult;
    }
    if (rec.is_mock) {
      return {
        id,
        ok: false,
        message: "Registro de demonstração (congelado).",
      } as BulkItemResult;
    }

    const updates: Record<string, unknown> = {};
    const fmod = { ...(rec.field_modified_at ?? {}) };
    const itemAudits: AuditRow[] = [];

    for (const c of coreChanges) {
      const old = rec[c.col] ?? null;
      if (coreEquals(c.dataType, old, c.value)) continue;
      updates[c.col] = c.value;
      fmod[c.col] = now;
      itemAudits.push({
        record_id: id,
        field: c.col,
        old_value: old,
        new_value: c.value,
      });
    }

    if (customChanges.length > 0) {
      const custom = { ...(rec.custom_fields ?? {}) };
      let customChanged = false;
      for (const c of customChanges) {
        const old = custom[c.key] ?? null;
        if (String(old ?? "") === String(c.value ?? "")) continue;
        custom[c.key] = c.value;
        fmod[c.key] = now;
        itemAudits.push({
          record_id: id,
          field: c.key,
          old_value: old,
          new_value: c.value,
        });
        customChanged = true;
      }
      if (customChanged) updates.custom_fields = custom;
    }

    if (touchResponsible) {
      const val = input.responsibleId ?? null;
      if (val !== (rec.responsible_id ?? null)) {
        updates.responsible_id = val;
        fmod.responsible_id = now;
        itemAudits.push({
          record_id: id,
          field: "responsible_id",
          old_value: rec.responsible_id,
          new_value: val,
        });
      }
    }
    if (touchOperation) {
      const val = input.operationId ?? null;
      if (val !== (rec.operation_id ?? null)) {
        updates.operation_id = val;
        fmod.operation_id = now;
        itemAudits.push({
          record_id: id,
          field: "operation_id",
          old_value: rec.operation_id,
          new_value: val,
        });
      }
    }

    if (Object.keys(updates).length === 0) {
      return { id, ok: true, message: "Sem alterações." } as BulkItemResult;
    }
    updates.field_modified_at = fmod;
    updates.locally_modified_at = now;

    const { data, error } = await supabase
      .from("records")
      .update(updates)
      .eq("id", id)
      .select("id");
    if (error) return { id, ok: false, message: error.message } as BulkItemResult;
    if (!data || data.length === 0) {
      return {
        id,
        ok: false,
        message: "Sem permissão para editar este registro.",
      } as BulkItemResult;
    }
    audits.push(...itemAudits);
    changedIds.push(id);
    return { id, ok: true } as BulkItemResult;
  });

  if (changedIds.length === 0) return { results, changedCount: 0 };

  // ---- Efeitos em lote (escrita já persistida; best-effort) ----
  try {
    await recalcFormulaFieldsForRecords(changedIds);
  } catch (e) {
    console.warn("[registros-update] recalc pós-escrita falhou:", e);
  }
  if (audits.length > 0) {
    await supabase.from("audit_log").insert(
      audits.map((a) => ({
        record_id: a.record_id,
        user_id: input.userId,
        field: a.field,
        old_value: a.old_value ?? null,
        new_value: a.new_value ?? null,
        origin: "app" as const,
      }))
    );
  }

  const orgId = await getActiveOrgId();
  const auditsByRecord = new Map<string, AuditRow[]>();
  for (const a of audits) {
    auditsByRecord.set(a.record_id, [
      ...(auditsByRecord.get(a.record_id) ?? []),
      a,
    ]);
  }
  for (const id of changedIds) {
    const list = auditsByRecord.get(id);
    if (!list || list.length === 0) continue;
    await emitWebhookEvent(
      "record.updated",
      {
        recordId: id,
        changes: list.map((a) => ({
          field: a.field,
          old_value: a.old_value ?? null,
          new_value: a.new_value ?? null,
        })),
      },
      orgId
    );
  }

  return { results, changedCount: changedIds.length };
}
