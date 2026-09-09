// Versão: 1.1 | Data: 09/09/2026
// v1.1 (09/09/2026): passo `record.update` (altera campos de um registro que já
//   existe) e ensaio (`dryRun`). O update NÃO escreve por conta própria: monta
//   `FieldWrite[]` e chama `executeFieldWrites` — o mesmo executor único do
//   `set_field`, com carimbo field_modified_at + locally_modified_at, UM recalc,
//   audit `origin='automation'` e webhook. Devolver a alteração ao CRM não
//   acontece aqui: para isso o esquema declara um passo `bitrix.entity.update`,
//   que é explícito sobre o que vai para onde.
// Passo `record.create` do Workflow (0125): grava o registro LOCAL espelhando
// a entidade que os passos anteriores criaram no CRM.
//
// Escreve com o client RLS DO USUÁRIO — nunca service role. A muralha é a
// policy `records_insert` (0091), cujo ramo 2 já autoriza exatamente esta
// forma: `edit_record_values` + source_system='bitrix' + source_id não nulo +
// base com manual_entry + (view_all_records ou responsável do próprio
// usuário). É a mesma linha que o checkbox "Criar também no Bitrix" de
// /registros produz, e é o que faz o próximo sync ADOTAR o registro via
// (source_system, source_id) em vez de criar uma duplicata.
//
// Campos calculados NÃO são materializados aqui: o executor chama
// `recalcFormulaFieldsForRecords` depois do lote, que é o choke point único de
// recálculo (mesmo caminho do auto-match pós-sync e da inserção por IA).
import type { SupabaseClient } from "@supabase/supabase-js";

import { coerce, coerceCore } from "@/lib/records/coerce";
import { isCoreDef } from "@/lib/records/core-defs";
import { EDITABLE_CORE_COLUMNS } from "@/lib/config/core-writeback";
import { fieldAppliesToSource } from "@/lib/sources";
import type { DataType, FieldDefinition } from "@/lib/records/types";

import {
  executeFieldWrites,
  type FieldWrite,
} from "@/lib/kanban/automations/move";

import { resolveTemplate, resolvesEmpty, type WorkflowRefContext } from "../refs";
import type {
  WorkflowRecordCreateStep,
  WorkflowRecordUpdateStep,
} from "../types";

export interface RecordStepSource {
  key: string;
  recordType: string;
  manualEntry: boolean;
}

export interface RecordStepDeps {
  /** Usuário autenticado — dono da linha e autor da auditoria. */
  userId: string;
  /** Responsável já resolvido pelo servidor (o form nunca decide sozinho). */
  responsibleId: string | null;
  operationId: string | null;
  /** Papéis do usuário — gating de `editable_by_roles`, como em createRecord. */
  roles: string[];
  orgId: string | null;
}

export interface RecordStepResult {
  recordId: string | null;
  skippedFields: string[];
  warnings: string[];
  /** Ensaio: o que TERIA sido gravado (undefined fora do dryRun). */
  payload?: Record<string, unknown>;
  /** Só o update: passo pulado por falta de alvo (skipIfEmpty). */
  skipped?: boolean;
}

interface FieldDefRow {
  field_key: string;
  data_type: string;
  editable_by_roles: string[] | null;
  applies_to: string[] | null;
  source_system: string | null;
}

export async function runRecordCreateStep(
  step: WorkflowRecordCreateStep,
  context: WorkflowRefContext,
  db: SupabaseClient,
  source: RecordStepSource,
  deps: RecordStepDeps,
  opts: { dryRun?: boolean } = {}
): Promise<RecordStepResult> {
  const warnings: string[] = [];
  const skippedFields: string[] = [];

  const resolve = (template: string): string => {
    const r = resolveTemplate(template, context);
    warnings.push(...r.warnings);
    return r.value.trim();
  };

  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    record_type: source.recordType,
    source_system: "manual",
    source_id: null,
    is_mock: false,
    owner_user_id: deps.userId,
    responsible_id: deps.responsibleId,
    operation_id: deps.operationId,
    // Data de criação "na origem" = agora, como na criação manual (é o
    // default_period_field mais comum e o que /registros ordena).
    source_created_at: now,
    locally_modified_at: now,
  };
  if (deps.orgId) row.organization_id = deps.orgId;

  const fmod: Record<string, string> = {};
  const audits: { field: string; new_value: unknown }[] = [];
  if (deps.responsibleId) {
    fmod.responsible_id = now;
    audits.push({ field: "responsible_id", new_value: deps.responsibleId });
  }

  // Colunas do núcleo declaradas no esquema. Fora de EDITABLE_CORE_COLUMNS não
  // entra: são as colunas que o app sabe escrever com coerção (invariante 11 —
  // coerceCore ancora datas naive em Brasília).
  for (const [col, spec] of Object.entries(step.params.core)) {
    const dtype = EDITABLE_CORE_COLUMNS[col] as DataType | undefined;
    if (!dtype) {
      skippedFields.push(col);
      continue;
    }
    const raw = resolve(spec.value);
    if (raw === "") continue;
    const val = coerceCore(dtype, raw);
    if (val == null) continue;
    row[col] = val;
    fmod[col] = now;
    audits.push({ field: col, new_value: val });
  }

  // `title` é obrigatório em `records` — sem ele o insert falha no banco com
  // uma mensagem que ninguém entende. Erro alto e claro aqui.
  if (!row.title || String(row.title).trim() === "") {
    throw new Error(
      "O passo de registro local não produziu um nome (title) — confira o campo do formulário que alimenta esse valor."
    );
  }

  // Campos personalizados: só os da base (applies_to) editáveis pelo papel —
  // mesmo gating de createRecord.
  const custom: Record<string, unknown> = {};
  const customKeys = Object.keys(step.params.custom);
  if (customKeys.length > 0) {
    let defsQuery = db
      .from("field_definitions")
      .select("field_key, data_type, editable_by_roles, applies_to, source_system")
      .in("field_key", customKeys);
    if (deps.orgId) defsQuery = defsQuery.eq("organization_id", deps.orgId);
    const { data: defsData } = await defsQuery;
    const defs = (defsData ?? []) as FieldDefRow[];
    const byKey = new Map(defs.map((d) => [d.field_key, d]));

    for (const [key, spec] of Object.entries(step.params.custom)) {
      const def = byKey.get(key);
      // Linha CORE (0086) grava pela coluna do núcleo, nunca em custom_fields.
      if (!def || isCoreDef(def)) {
        skippedFields.push(key);
        continue;
      }
      const dt = def.data_type as DataType;
      if (dt === "calculado" || dt === "calculado_agg") {
        skippedFields.push(key);
        continue;
      }
      if (!fieldAppliesToSource(def.applies_to, source.key)) {
        skippedFields.push(key);
        continue;
      }
      const roleAllows = (def.editable_by_roles ?? []).some((r) =>
        deps.roles.includes(r)
      );
      if (!roleAllows) {
        skippedFields.push(key);
        continue;
      }
      const raw = resolve(spec.value);
      if (raw === "") continue;
      const val = coerce(dt, raw);
      if (val == null) continue;
      custom[key] = val;
      fmod[key] = now;
      audits.push({ field: key, new_value: val });
    }
  }

  // Vínculo com a entidade do CRM. `last_synced_at = null` deixa os campos
  // preenchidos PROTEGIDOS (field_modified_at sem sync posterior) até a
  // primeira reconciliação.
  if (step.params.linkSourceIdFrom) {
    const linked = context.steps[step.params.linkSourceIdFrom];
    if (linked?.id) {
      row.source_system = "bitrix";
      row.source_id = linked.id;
      row.last_synced_at = null;
    }
    // Passo de origem pulado/desligado: a linha nasce 'manual'. É o ramo 1 da
    // RLS e continua válido — o registro simplesmente não tem par no CRM.
  }

  row.custom_fields = custom;
  row.field_modified_at = fmod;

  if (opts.dryRun) {
    // Ensaio: a linha NÃO é gravada. O payload sai como seria inserido, com o
    // sentinela do passo anterior onde estaria o id vindo do CRM.
    return { recordId: null, skippedFields, warnings, payload: row };
  }

  const { data: inserted, error } = await db
    .from("records")
    .insert(row)
    .select("id")
    .single();
  if (error) {
    throw new Error(
      `Falha ao gravar o registro local${row.source_id ? " (a entidade no CRM JÁ foi criada; o sync a importará)" : ""}: ${error.message}`
    );
  }
  const recordId = inserted.id as string;

  if (audits.length > 0) {
    await db.from("audit_log").insert(
      audits.map((a) => ({
        record_id: recordId,
        user_id: deps.userId,
        field: a.field,
        old_value: null,
        new_value: a.new_value ?? null,
        origin: "app" as const,
      }))
    );
  }

  return { recordId, skippedFields, warnings };
}

export interface RecordUpdateStepDeps {
  /** Catálogo de campos da org — decide o alvo válido e a coerção. */
  defs: FieldDefinition[];
  orgId: string | null;
}

/**
 * Passo `record.update`: altera campos de um registro que JÁ existe (o que
 * disparou a automação, via {{ctx.triggerRecordId}}, ou o criado por um passo
 * anterior).
 *
 * Alvo válido = coluna do núcleo que o app sabe escrever (EDITABLE_CORE_COLUMNS
 * — a MESMA base do `setFieldTargetError` que gateia o `set_field`) ou campo
 * personalizado não-calculado. O resto é PULADO e reportado, nunca escrito às
 * escuras. Valor que resolve vazio não é enviado: limpar campo não é o que
 * "não trouxe valor" quer dizer.
 */
export async function runRecordUpdateStep(
  step: WorkflowRecordUpdateStep,
  context: WorkflowRefContext,
  db: SupabaseClient,
  deps: RecordUpdateStepDeps,
  opts: { dryRun?: boolean } = {}
): Promise<RecordStepResult> {
  const warnings: string[] = [];
  const skippedFields: string[] = [];

  if (step.params.skipIfEmpty && resolvesEmpty(step.params.skipIfEmpty, context)) {
    return { recordId: null, skippedFields, warnings, skipped: true };
  }

  const target = resolveTemplate(step.params.recordIdFrom, context);
  warnings.push(...target.warnings);
  const recordId = target.value.trim();
  if (recordId === "") {
    throw new Error(
      `O passo "${step.label}" não resolveu o registro a alterar.`
    );
  }

  const defByKey = new Map(deps.defs.map((d) => [d.field_key as string, d]));
  const writes: FieldWrite[] = [];
  const preview: Record<string, string> = {};

  for (const [ref, spec] of Object.entries(step.params.fields)) {
    const resolved = resolveTemplate(spec.value, context);
    warnings.push(...resolved.warnings);
    const value = resolved.value.trim();
    if (value === "") continue;

    if (ref.startsWith("custom:")) {
      const def = defByKey.get(ref.slice("custom:".length));
      const dt = def?.data_type as DataType | undefined;
      if (!def || dt === "calculado" || dt === "calculado_agg") {
        skippedFields.push(ref);
        continue;
      }
    } else if (!EDITABLE_CORE_COLUMNS[ref]) {
      skippedFields.push(ref);
      continue;
    }

    preview[ref] = value;
    writes.push({ recordId, field: ref, value, ruleId: step.id });
  }

  if (opts.dryRun) {
    return {
      recordId,
      skippedFields,
      warnings,
      payload: { recordId, fields: preview },
    };
  }

  if (writes.length > 0) {
    const outcome = await executeFieldWrites(db, {
      writes,
      // O `old_value` de coluna do núcleo na auditoria sai daqui; sem o
      // registro em mãos a auditoria registra a alteração sem o valor antigo.
      recordById: new Map(),
      // Devolver ao CRM é decisão EXPLÍCITA do esquema: um passo
      // `bitrix.entity.update` diz o que vai para lá, com o campo de destino.
      writeBack: false,
      orgId: deps.orgId,
      defs: deps.defs,
    });
    if (outcome.failed.length > 0) {
      throw new Error(outcome.failed[0].message);
    }
  }

  return { recordId, skippedFields, warnings };
}
