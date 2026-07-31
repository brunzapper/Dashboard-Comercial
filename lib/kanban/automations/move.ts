// Versão: 1.1 | Data: 31/07/2026
// Executor SERVICE-ROLE das ações decididas pelas automações do kanban.
// Não refatora updateRecord (acoplado à sessão/FormData) — replica o MÍNIMO de
// efeitos, como o sync faz: coluna Personalizar = upsert de kanban_placements
// (dado da VISÃO, não toca no registro); escrita de CAMPO (move por valor E
// set_field — executor ÚNICO executeFieldWrites) com carimbo
// field_modified_at[campo] + locally_modified_at (protege da Sync — o ponto
// da automação), e efeitos em LOTE após os updates: UM
// recalcFormulaFieldsForRecords, UM insert de audit_log (origin 'automation',
// user_id null), write-back opcional (settings.writeBack, gating espelhado do
// updateRecord) e webhook record.updated por registro (integrações veem
// escrita automatizada; volume limitado pelo teto de ações do engine).
// Guardas duplicadas (defesa em profundidade): is_mock e alvo overflow nunca
// passam daqui. Org EXPLÍCITA em toda consulta (service role).
// v1.1 (31/07/2026): branch "por VALOR" extraído p/ executeFieldWrites e
// reusado por executeAutomationSets (ação set_field) — carimbos, recalc,
// audit, write-back e webhook num lugar só.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { DataType, FieldDefinition, RecordRow } from "@/lib/records/types";
import { recalcFormulaFieldsForRecords } from "@/lib/records/recalc";
import {
  coreWriteBackFieldId,
  EDITABLE_CORE_COLUMNS,
} from "@/lib/config/core-writeback";
import {
  enqueueWriteBacks,
  type WriteBackChange,
} from "@/lib/sync/bitrix/writeback";
import { emitWebhookEvent } from "@/lib/webhooks/emit";
import { applyAllocationForSettings } from "../allocation-field";
import {
  KANBAN_NO_VALUE_KEY,
  KANBAN_OVERFLOW_KEY,
  type KanbanSettings,
} from "../types";
import { mapLimited } from "../bulk-helpers";
import type { AutomationOwner } from "./types";
import type { PlannedMove, PlannedSet } from "./evaluate";

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
  // Ações EXECUTADAS por regra (bookkeeping last_moved_count).
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

/** Uma escrita de campo planejada (move por valor OU set_field). */
export interface FieldWrite {
  recordId: string;
  /** Coluna core crua ou `custom:<key>`. */
  field: string;
  /** Valor cru (string) ou null (limpar — só o move "Sem valor" usa). */
  value: string | null;
  ruleId: string;
}

interface FieldWriteBatch {
  writes: FieldWrite[];
  recordById: Map<string, RecordRow>;
  settings: KanbanSettings;
  orgId: string | null;
  defs: FieldDefinition[];
}

interface FieldWriteOutcome {
  okWrites: FieldWrite[];
  failed: { recordId: string; message: string }[];
}

/**
 * Executor ÚNICO de escrita de valor em registros pelas automações: estado
 * fresco chunked (org explícita), UPDATE por item com carimbos, UM recalc,
 * UM insert de audit (origin 'automation'), write-back gateado
 * (settings.writeBack + campo Bitrix mapeado) e webhook em lote. Campo core =
 * coluna de EDITABLE_CORE_COLUMNS (o avaliador/save barram o resto); custom
 * coerce pelo data_type da def.
 */
async function executeFieldWrites(
  db: SupabaseClient,
  batch: FieldWriteBatch
): Promise<FieldWriteOutcome> {
  const { settings, orgId, defs } = batch;
  const failed: FieldWriteOutcome["failed"] = [];
  const okWrites: FieldWrite[] = [];
  if (batch.writes.length === 0) return { okWrites, failed };

  const defByKey = new Map(defs.map((d) => [d.field_key as string, d]));
  const customDefOf = (field: string): FieldDefinition | undefined =>
    field.startsWith("custom:")
      ? defByKey.get(field.slice("custom:".length))
      : undefined;

  const now = new Date().toISOString();

  // Estado FRESCO dos registros (fmod/custom_fields p/ merge sem clobber de
  // edições concorrentes; source_id p/ o write-back).
  type FreshRow = {
    id: string;
    field_modified_at: Record<string, string> | null;
    custom_fields: Record<string, unknown> | null;
    source_id: string | null;
    is_mock: boolean | null;
  };
  const freshById = new Map<string, FreshRow>();
  const ids = batch.writes.map((w) => w.recordId);
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
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

  const results = await mapLimited(batch.writes, CONCURRENCY, async (w) => {
    const fresh = freshById.get(w.recordId);
    if (!fresh || fresh.is_mock) {
      return { w, ok: false, message: "Registro não encontrado (ou congelado)." };
    }
    const isCustomField = w.field.startsWith("custom:");
    const customKey = isCustomField ? w.field.slice("custom:".length) : null;
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
        w.value == null
          ? null
          : coerceCustom(
              customDefOf(w.field)?.data_type as DataType | undefined,
              w.value
            );
      custom[customKey] = newValue;
      updates.custom_fields = custom;
      fmod[customKey] = now;
      auditField = customKey;
    } else {
      const rec = batch.recordById.get(w.recordId);
      oldValue =
        (rec as unknown as Record<string, unknown> | undefined)?.[w.field] ??
        null;
      // Coluna core numérica/booleana precisa do tipo certo no payload
      // (Postgres recusa string em coluna numérica); texto passa cru.
      newValue =
        w.value == null
          ? null
          : coerceCustom(EDITABLE_CORE_COLUMNS[w.field], w.value);
      updates[w.field] = newValue;
      fmod[w.field] = now;
      auditField = w.field;
    }
    updates.field_modified_at = fmod;
    let q = db.from("records").update(updates).eq("id", w.recordId);
    if (orgId) q = q.eq("organization_id", orgId);
    const { error } = await q;
    if (error) return { w, ok: false, message: error.message };
    audits.push({
      record_id: w.recordId,
      field: auditField,
      old_value: oldValue,
      new_value: newValue,
    });
    return { w, ok: true as const, message: "" };
  });
  for (const r of results) {
    if (r.ok) okWrites.push(r.w);
    else failed.push({ recordId: r.w.recordId, message: r.message });
  }
  if (okWrites.length === 0) return { okWrites, failed };
  const okIds = okWrites.map((w) => w.recordId);

  // ---- Efeitos em lote (best-effort — a escrita já está persistida) ----
  try {
    await recalcFormulaFieldsForRecords(okIds);
  } catch (e) {
    console.warn("[kanban-automations] recalc pós-escrita falhou:", e);
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
    console.warn("[kanban-automations] audit pós-escrita falhou:", e);
  }

  // Write-back (settings.writeBack): mesmo gating do updateRecord com a marca
  // da coluna (write_back__<campo>) — o toggle do quadro vale como override.
  if (settings.writeBack) {
    const auditByRecord = new Map(audits.map((a) => [a.record_id, a]));
    for (const w of okWrites) {
      const rec = batch.recordById.get(w.recordId);
      const fresh = freshById.get(w.recordId);
      const audit = auditByRecord.get(w.recordId);
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
      const customDef = customDefOf(w.field);
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
      } else if (!w.field.startsWith("custom:")) {
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
            recordId: w.recordId,
            entity,
            sourceId: fresh.source_id,
            createdBy: null,
            changes,
          });
        } catch {
          // best-effort: fila indisponível nunca desfaz a escrita local.
        }
      }
    }
  }

  // Webhook por registro (emitWebhookEvent nunca lança).
  const auditByRecord = new Map(audits.map((a) => [a.record_id, a]));
  for (const w of okWrites) {
    const a = auditByRecord.get(w.recordId);
    if (!a) continue;
    await emitWebhookEvent(
      "record.updated",
      {
        recordId: w.recordId,
        changes: [
          { field: a.field, old_value: a.old_value ?? null, new_value: a.new_value ?? null },
        ],
      },
      orgId
    );
  }

  return { okWrites, failed };
}

function byRuleCount(writes: { ruleId: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const w of writes) out.set(w.ruleId, (out.get(w.ruleId) ?? 0) + 1);
  return out;
}

/** Executa as escritas de campo das regras set_field de UMA rodada. */
export async function executeAutomationSets(
  db: SupabaseClient,
  batch: {
    sets: PlannedSet[];
    recordById: Map<string, RecordRow>;
    settings: KanbanSettings;
    orgId: string | null;
    defs: FieldDefinition[];
  }
): Promise<AutomationMoveResult> {
  const failed: AutomationMoveResult["failed"] = [];
  // Guardas (defesa em profundidade — o avaliador já barra mock).
  const writes: FieldWrite[] = [];
  for (const s of batch.sets) {
    const rec = batch.recordById.get(s.recordId);
    if (!rec) {
      failed.push({ recordId: s.recordId, message: "Registro não encontrado." });
      continue;
    }
    if (rec.is_mock) {
      failed.push({
        recordId: s.recordId,
        message: "Registro de demonstração (congelado).",
      });
      continue;
    }
    writes.push({
      recordId: s.recordId,
      field: s.field,
      value: s.value,
      ruleId: s.ruleId,
    });
  }
  const outcome = await executeFieldWrites(db, {
    writes,
    recordById: batch.recordById,
    settings: batch.settings,
    orgId: batch.orgId,
    defs: batch.defs,
  });
  failed.push(...outcome.failed);
  return {
    okIds: outcome.okWrites.map((w) => w.recordId),
    failed,
    movedByRule: byRuleCount(outcome.okWrites),
  };
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
    // Alocação como campo (invariante 24): espelha a coluna destino no campo
    // do registro (settings/org já em mãos — sem recarregar o dono). Nunca
    // lança; falha não desfaz os placements.
    if (okMoves.length > 0) {
      await applyAllocationForSettings(db, {
        settings,
        orgId,
        moves: okMoves.map((m) => ({
          recordId: m.recordId,
          targetKey: m.targetKey,
        })),
      });
    }
    return finish();
  }

  // ---- Colunas por VALOR: escrita do campo de agrupamento (executor único) ----
  // (bucket de data nunca chega aqui — o engine recusa o quadro inteiro.)
  const field = settings.groupField || "stage";
  const writeByRecord = new Map<string, PlannedMove>();
  const writes: FieldWrite[] = moves.map((m) => {
    writeByRecord.set(m.recordId, m);
    return {
      recordId: m.recordId,
      field,
      value: m.targetKey === KANBAN_NO_VALUE_KEY ? null : m.targetKey,
      ruleId: m.ruleId,
    };
  });
  const outcome = await executeFieldWrites(db, {
    writes,
    recordById: batch.recordById,
    settings,
    orgId,
    defs,
  });
  for (const w of outcome.okWrites) {
    const m = writeByRecord.get(w.recordId);
    if (m) okMoves.push(m);
  }
  failed.push(...outcome.failed);
  return finish();
}
