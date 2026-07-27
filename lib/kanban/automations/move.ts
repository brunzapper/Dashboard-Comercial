// Versão: 1.0 | Data: 27/07/2026
// Executor SERVICE-ROLE dos movimentos decididos pelas automações do kanban.
// Não refatora updateRecord (acoplado à sessão/FormData) — replica o MÍNIMO de
// efeitos, como o sync faz: coluna Personalizar = upsert de kanban_placements
// (dado da VISÃO, não toca no registro); coluna por VALOR = escrita do campo
// (core/custom/relação) com carimbo field_modified_at[campo] +
// locally_modified_at (protege da Sync — o ponto da automação), e efeitos em
// LOTE após os updates: UM recalcFormulaFieldsForRecords, UM insert de
// audit_log (origin 'automation', user_id null), write-back opcional
// (settings.writeBack, gating espelhado do updateRecord) e webhook
// record.updated por registro (integrações veem movimento automatizado; volume
// limitado pelo teto de moves do engine). Guardas duplicadas (defesa em
// profundidade): is_mock e alvo overflow nunca passam daqui.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { DataType, FieldDefinition, RecordRow } from "@/lib/records/types";
import { recalcFormulaFieldsForRecords } from "@/lib/records/recalc";
import { coreWriteBackFieldId } from "@/lib/config/core-writeback";
import {
  enqueueWriteBacks,
  type WriteBackChange,
} from "@/lib/sync/bitrix/writeback";
import { emitWebhookEvent } from "@/lib/webhooks/emit";
import {
  KANBAN_NO_VALUE_KEY,
  KANBAN_OVERFLOW_KEY,
  type KanbanSettings,
} from "../types";
import { mapLimited } from "../bulk-helpers";
import type { AutomationOwner } from "./types";
import type { PlannedMove } from "./evaluate";

export interface AutomationMoveBatch {
  moves: PlannedMove[];
  // Registros dos cards (carregados pelo engine) — evita reler o quadro.
  recordById: Map<string, RecordRow>;
  settings: KanbanSettings;
  owner: AutomationOwner;
  orgId: string | null;
  // field_definitions da org (coerção do valor custom + gating de write-back).
  defs: FieldDefinition[];
}

export interface AutomationMoveResult {
  okIds: string[];
  failed: { recordId: string; message: string }[];
  // Movimentos EXECUTADOS por regra (bookkeeping last_moved_count).
  movedByRule: Map<string, number>;
}

const CHUNK = 200;
const CONCURRENCY = 5;

// Mesma coerção do updateRecord p/ valor de campo custom (string da chave da
// coluna → tipo do campo). "" nunca chega aqui (NO_VALUE vira null antes).
function coerceCustom(dataType: DataType | undefined, s: string): unknown {
  if (dataType === "numero" || dataType === "moeda") {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (dataType === "booleano")
    return s === "true" ? true : s === "false" ? false : null;
  return s;
}

/** Executa os movimentos de UMA rodada (mesmo quadro/config). */
export async function executeAutomationMoves(
  db: SupabaseClient,
  batch: AutomationMoveBatch
): Promise<AutomationMoveResult> {
  const failed: AutomationMoveResult["failed"] = [];
  const okMoves: PlannedMove[] = [];
  const { settings, owner, orgId, defs } = batch;

  // Guardas (defesa em profundidade — o avaliador já barra ambos).
  const moves = batch.moves.filter((m) => {
    if (m.targetKey === KANBAN_OVERFLOW_KEY) {
      failed.push({ recordId: m.recordId, message: 'A coluna "Outros" não recebe cards.' });
      return false;
    }
    const rec = batch.recordById.get(m.recordId);
    if (!rec) {
      failed.push({ recordId: m.recordId, message: "Registro não encontrado." });
      return false;
    }
    if (rec.is_mock) {
      failed.push({ recordId: m.recordId, message: "Registro de demonstração (congelado)." });
      return false;
    }
    return true;
  });

  const finish = (): AutomationMoveResult => {
    const movedByRule = new Map<string, number>();
    for (const m of okMoves)
      movedByRule.set(m.ruleId, (movedByRule.get(m.ruleId) ?? 0) + 1);
    return { okIds: okMoves.map((m) => m.recordId), failed, movedByRule };
  };
  if (moves.length === 0) return finish();

  // ---- Colunas "Personalizar": upsert de posicionamentos (dado da visão) ----
  if (settings.columnSource === "custom") {
    const ownerCol = owner.kind === "widget" ? "widget_id" : "board_id";
    for (let i = 0; i < moves.length; i += CHUNK) {
      const slice = moves.slice(i, i + CHUNK);
      const { error } = await db.from("kanban_placements").upsert(
        slice.map((m, j) => ({
          [ownerCol]: owner.id,
          record_id: m.recordId,
          column_key: m.targetKey,
          // Fracionária: movidos vão ao topo (decrementa p/ manter a ordem).
          position: -(Date.now() + j),
          updated_by: null,
        })),
        { onConflict: `${ownerCol},record_id` }
      );
      if (error) {
        for (const m of slice)
          failed.push({ recordId: m.recordId, message: error.message });
        continue;
      }
      okMoves.push(...slice);
    }
    return finish();
  }

  // ---- Colunas por VALOR: escrita do campo de agrupamento ----
  // (bucket de data nunca chega aqui — o engine recusa o quadro inteiro.)
  const field = settings.groupField || "stage";
  const isCustomField = field.startsWith("custom:");
  const customKey = isCustomField ? field.slice("custom:".length) : null;
  const customDef = customKey
    ? defs.find((d) => d.field_key === customKey)
    : undefined;
  const now = new Date().toISOString();

  // Estado FRESCO dos registros movidos (fmod/custom_fields p/ merge sem
  // clobber de edições concorrentes; source_id p/ o write-back).
  type FreshRow = {
    id: string;
    field_modified_at: Record<string, string> | null;
    custom_fields: Record<string, unknown> | null;
    source_id: string | null;
    is_mock: boolean | null;
  };
  const freshById = new Map<string, FreshRow>();
  for (let i = 0; i < moves.length; i += CHUNK) {
    const slice = moves.slice(i, i + CHUNK).map((m) => m.recordId);
    let q = db
      .from("records")
      .select("id, field_modified_at, custom_fields, source_id, is_mock")
      .in("id", slice);
    if (orgId) q = q.eq("organization_id", orgId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as FreshRow[]) freshById.set(r.id, r);
  }

  const audits: {
    record_id: string;
    field: string;
    old_value: unknown;
    new_value: unknown;
  }[] = [];

  const results = await mapLimited(moves, CONCURRENCY, async (m) => {
    const fresh = freshById.get(m.recordId);
    if (!fresh || fresh.is_mock) {
      return { m, ok: false, message: "Registro não encontrado (ou congelado)." };
    }
    const fmod = { ...(fresh.field_modified_at ?? {}) };
    const updates: Record<string, unknown> = {
      locally_modified_at: now,
    };
    let auditField: string;
    let oldValue: unknown;
    let newValue: unknown;
    if (customKey) {
      const custom = { ...(fresh.custom_fields ?? {}) };
      oldValue = custom[customKey] ?? null;
      newValue =
        m.targetKey === KANBAN_NO_VALUE_KEY
          ? null
          : coerceCustom(customDef?.data_type as DataType | undefined, m.targetKey);
      custom[customKey] = newValue;
      updates.custom_fields = custom;
      fmod[customKey] = now;
      auditField = customKey;
    } else {
      const rec = batch.recordById.get(m.recordId);
      oldValue =
        (rec as unknown as Record<string, unknown> | undefined)?.[field] ?? null;
      newValue = m.targetKey === KANBAN_NO_VALUE_KEY ? null : m.targetKey;
      updates[field] = newValue;
      fmod[field] = now;
      auditField = field;
    }
    updates.field_modified_at = fmod;
    let q = db.from("records").update(updates).eq("id", m.recordId);
    if (orgId) q = q.eq("organization_id", orgId);
    const { error } = await q;
    if (error) return { m, ok: false, message: error.message };
    audits.push({
      record_id: m.recordId,
      field: auditField,
      old_value: oldValue,
      new_value: newValue,
    });
    return { m, ok: true as const, message: "" };
  });
  for (const r of results) {
    if (r.ok) okMoves.push(r.m);
    else failed.push({ recordId: r.m.recordId, message: r.message });
  }
  if (okMoves.length === 0) return finish();
  const okIds = okMoves.map((m) => m.recordId);

  // ---- Efeitos em lote (best-effort — o movimento já está persistido) ----
  try {
    await recalcFormulaFieldsForRecords(okIds);
  } catch (e) {
    console.warn("[kanban-automations] recalc pós-move falhou:", e);
  }
  try {
    if (audits.length > 0) {
      await db.from("audit_log").insert(
        audits.map((a) => ({
          record_id: a.record_id,
          user_id: null,
          field: a.field,
          old_value: a.old_value ?? null,
          new_value: a.new_value ?? null,
          origin: "automation" as const,
        }))
      );
    }
  } catch (e) {
    console.warn("[kanban-automations] audit pós-move falhou:", e);
  }

  // Write-back (settings.writeBack): mesmo gating do updateRecord com a marca
  // da coluna (write_back__<campo>) — o toggle do quadro vale como override.
  if (settings.writeBack) {
    const auditByRecord = new Map(audits.map((a) => [a.record_id, a]));
    for (const m of okMoves) {
      const rec = batch.recordById.get(m.recordId);
      const fresh = freshById.get(m.recordId);
      const audit = auditByRecord.get(m.recordId);
      if (!rec || !fresh?.source_id || !audit) continue;
      if (rec.source_system !== "bitrix") continue;
      const entity =
        rec.record_type === "negocio"
          ? ("deal" as const)
          : rec.record_type === "lead"
            ? ("lead" as const)
            : null;
      if (!entity) continue;
      const changes: WriteBackChange[] = [];
      if (customDef) {
        const isBitrix =
          customDef.source_system === "bitrix" &&
          Boolean(customDef.source_field_id);
        if (isBitrix) {
          changes.push({
            fieldKey: audit.field,
            sourceFieldId: customDef.source_field_id as string,
            label: (customDef.label as string) ?? null,
            newValue: audit.new_value ?? null,
          });
        }
      } else {
        const sfid = coreWriteBackFieldId(audit.field, entity);
        if (sfid) {
          // Responsável precisa de tradução (uuid local → id Bitrix); fora do
          // caso de uso de automação — pulamos (edição fica local).
          if (audit.field !== "responsible_id") {
            changes.push({
              fieldKey: audit.field,
              sourceFieldId: sfid,
              label: audit.field,
              newValue: audit.new_value ?? null,
            });
          }
        }
      }
      if (changes.length > 0) {
        try {
          await enqueueWriteBacks(db, {
            recordId: m.recordId,
            entity,
            sourceId: fresh.source_id,
            createdBy: null,
            changes,
          });
        } catch {
          // best-effort: fila indisponível nunca desfaz o movimento local.
        }
      }
    }
  }

  // Webhook por registro (emitWebhookEvent nunca lança).
  const auditByRecord = new Map(audits.map((a) => [a.record_id, a]));
  for (const m of okMoves) {
    const a = auditByRecord.get(m.recordId);
    if (!a) continue;
    await emitWebhookEvent(
      "record.updated",
      {
        recordId: m.recordId,
        changes: [
          { field: a.field, old_value: a.old_value ?? null, new_value: a.new_value ?? null },
        ],
      },
      orgId
    );
  }

  return finish();
}
