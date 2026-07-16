// Versão: 1.2 | Data: 16/07/2026
// Server Actions de edição de registros. Gravação com o client do usuário
// (RLS: records_update exige edit_record_values E owner/view_all). Toda edição
// grava field_modified_at[campo]=now (protege do sync) + audit_log origin 'app'.
// v1.1 (09/07/2026): Fase 7 — recomputa os campos calculados do registro após a
//   edição manual (dependem de value/mrr/lead_time_days e de custom numéricos).
// v1.2 (16/07/2026): createRecord — criação MANUAL de registros em fontes com
//   manual_entry (0061): source_system='manual', source_id nulo, RLS força o
//   vendedor ao próprio responsável; recomputo de calculados compartilhado com
//   updateRecord (applyCalcFields); searchLeads generalizado em searchRecords.
"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  enqueueWriteBacks,
  type WriteBackChange,
} from "@/lib/sync/bitrix/writeback";
import { leadTimeDays, primaryOperationId } from "@/lib/sync/shared";
import {
  anyMoneyDef,
  buildDateContext,
  buildRecordCurrencyContext,
  computeFormulaFields,
  loadCurrencyMaterials,
  loadCustomDateKeys,
  loadFormulaDefs,
} from "@/lib/records/formulas";
import type { DataType } from "@/lib/records/types";
import {
  EDITABLE_CORE_COLUMNS,
  coreWriteBackFieldId,
} from "@/lib/config/core-writeback";
import { fieldAppliesToSource } from "@/lib/sources";
import { loadSources } from "@/lib/config/sources";

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface EditActionState {
  ok?: boolean;
  message?: string;
}

const RELATIONS = ["responsible_id", "operation_id", "related_lead_id"] as const;

function coerce(dataType: DataType, raw: FormDataEntryValue | null): unknown {
  const s = raw == null ? "" : String(raw).trim();
  if (s === "") return null;
  if (dataType === "numero" || dataType === "moeda") {
    const n = Number(s.replace(/\./g, "").replace(",", "."));
    return Number.isNaN(Number(s)) ? (Number.isNaN(n) ? null : n) : Number(s);
  }
  if (dataType === "booleano") {
    return s === "true" ? true : s === "false" ? false : null;
  }
  return s;
}

interface ExistingForEdit {
  id: string;
  record_type: string;
  source_system: string | null;
  source_id: string | null;
  custom_fields: Record<string, unknown> | null;
  field_modified_at: Record<string, string> | null;
  responsible_id: string | null;
  operation_id: string | null;
  related_lead_id: string | null;
  source_created_at: string | null;
  closed_at: string | null;
  value: number | null;
  mrr: number | null;
  lead_time_days: number | null;
  // Colunas do núcleo editáveis (comparação/audit/write-back).
  title: string | null;
  stage: string | null;
  currency: string | null;
  channel: string | null;
  sale_type: string | null;
  closed: boolean | null;
  opened_at: string | null;
  pipeline: string | null;
}

// Coerção de um valor cru (string do form) p/ o tipo de uma coluna do núcleo.
function coerceCore(dataType: DataType, raw: FormDataEntryValue | null): unknown {
  const s = raw == null ? "" : String(raw).trim();
  if (s === "") return null;
  if (dataType === "numero" || dataType === "moeda") {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (dataType === "booleano") {
    return s === "true" ? true : s === "false" ? false : null;
  }
  if (dataType === "data") return s.slice(0, 10);
  return s;
}

// Valores EFETIVOS do núcleo p/ o recomputo de campos calculados (edição usa
// "update > registro"; criação usa os valores do form). Compartilhado por
// updateRecord e createRecord.
interface CalcCoreValues {
  value: unknown;
  mrr: unknown;
  lead_time_days: unknown;
  title: unknown;
  record_type: string;
  source_system: string | null;
  pipeline: unknown;
  stage: unknown;
  stage_semantic: unknown;
  sale_type: unknown;
  channel: unknown;
  currency: unknown;
  closed: unknown;
  closed_at: string | null;
  opened_at: string | null;
  source_created_at: string | null;
}

// Recomputa os campos calculados sobre os valores efetivos e grava em `custom`
// (in-place). Retorna true se algum valor mudou. Calc-fields monetários usam a
// moeda/datas EFETIVAS (se a gravação troca a Moeda, o carimbo <key>__cur já
// sai na moeda nova); operandos match:<fonte> ficam para o recalc (regra de
// "pular" em computeFormulaFields).
async function applyCalcFields(
  supabase: SupabaseClient,
  core: CalcCoreValues,
  custom: Record<string, unknown>
): Promise<boolean> {
  const formulaDefs = await loadFormulaDefs(supabase);
  if (formulaDefs.length === 0) return false;
  const conv = anyMoneyDef(formulaDefs)
    ? buildRecordCurrencyContext(
        {
          currency: (core.currency as string | null) ?? null,
          closed_at: core.closed_at,
          opened_at: core.opened_at,
          source_created_at: core.source_created_at,
        },
        await loadCurrencyMaterials(supabase)
      )
    : undefined;
  const dateCtx = buildDateContext(
    {
      closed_at: core.closed_at,
      opened_at: core.opened_at,
      source_created_at: core.source_created_at,
    },
    custom,
    await loadCustomDateKeys(supabase)
  );
  const calc = computeFormulaFields(
    {
      value: numOrNull(core.value),
      mrr: numOrNull(core.mrr),
      lead_time_days: numOrNull(core.lead_time_days),
      title: core.title,
      record_type: core.record_type,
      source_system: core.source_system,
      pipeline: core.pipeline,
      stage: core.stage,
      stage_semantic: core.stage_semantic,
      sale_type: core.sale_type,
      channel: core.channel,
      currency: core.currency,
      closed: core.closed,
    },
    custom,
    formulaDefs,
    conv,
    dateCtx
  );
  let changed = false;
  for (const [k, v] of Object.entries(calc)) {
    if (String(custom[k] ?? "") !== String(v ?? "")) {
      custom[k] = v;
      changed = true;
    }
  }
  return changed;
}

// Igualdade "normalizada" p/ decidir se uma coluna do núcleo mudou (datas comparam
// só o dia; números por valor; resto por texto).
function coreEquals(dataType: DataType, oldVal: unknown, newVal: unknown): boolean {
  if (dataType === "data") {
    return String(oldVal ?? "").slice(0, 10) === String(newVal ?? "").slice(0, 10);
  }
  if (dataType === "numero" || dataType === "moeda") {
    const a = oldVal == null || oldVal === "" ? null : Number(oldVal);
    const b = newVal == null || newVal === "" ? null : Number(newVal);
    return a === b;
  }
  if (dataType === "booleano") return Boolean(oldVal) === Boolean(newVal);
  return String(oldVal ?? "") === String(newVal ?? "");
}

export async function updateRecord(
  _prev: EditActionState,
  formData: FormData
): Promise<EditActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.permissions.includes("edit_record_values")) {
    return { ok: false, message: "Você não tem permissão para editar registros." };
  }
  const roles = session.roles;
  const recordId = String(formData.get("record_id") ?? "");
  if (!recordId) return { ok: false, message: "Registro não identificado." };

  // Contexto de write-back: `force_sync_write_back` (edições dos Registros gravam
  // sempre no Bitrix); `write_back__<campo>` (dashboard marca a coluna p/ gravar).
  const forceSync = String(formData.get("force_sync_write_back") ?? "") === "1";
  const wbOverride = (key: string) =>
    String(formData.get(`write_back__${key}`) ?? "") === "1";
  // `allow_edit`: a coluna foi marcada como editável no dashboard (pelo dono/admin),
  // liberando a edição para quem tem edit_record_values mesmo sem editable_by_roles.
  const allowEdit = String(formData.get("allow_edit") ?? "") === "1";

  const supabase = await createClient();

  const { data: existingRow } = await supabase
    .from("records")
    .select(
      "id, record_type, source_system, source_id, custom_fields, field_modified_at, responsible_id, operation_id, related_lead_id, source_created_at, closed_at, value, mrr, lead_time_days, title, stage, stage_semantic, currency, channel, sale_type, closed, opened_at, pipeline"
    )
    .eq("id", recordId)
    .maybeSingle();
  const existing = existingRow as ExistingForEdit | null;
  if (!existing) return { ok: false, message: "Registro não encontrado." };

  const { data: defs } = await supabase
    .from("field_definitions")
    .select(
      "field_key, label, data_type, editable_by_roles, source_system, source_field_id, write_back"
    );

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {};
  const fmod: Record<string, string> = { ...(existing.field_modified_at ?? {}) };
  const custom: Record<string, unknown> = { ...(existing.custom_fields ?? {}) };
  const audits: { field: string; old_value: unknown; new_value: unknown }[] = [];

  // Relações (responsável/operação/lead)
  for (const rel of RELATIONS) {
    if (!formData.has(rel)) continue;
    const raw = String(formData.get(rel) ?? "");
    const val = raw === "" ? null : raw;
    if (val !== (existing[rel] ?? null)) {
      updates[rel] = val;
      fmod[rel] = now;
      audits.push({ field: rel, old_value: existing[rel], new_value: val });
    }
  }

  // Colunas do núcleo editáveis (dashboard marca por coluna; Registros libera os
  // campos de Sync). A permissão global edit_record_values já foi conferida acima.
  for (const [col, dtype] of Object.entries(EDITABLE_CORE_COLUMNS)) {
    const key = `core__${col}`;
    if (!formData.has(key)) continue;
    const val = coerceCore(dtype, formData.get(key));
    const old = (existing as unknown as Record<string, unknown>)[col] ?? null;
    if (!coreEquals(dtype, old, val)) {
      updates[col] = val;
      fmod[col] = now;
      audits.push({ field: col, old_value: old, new_value: val });
    }
  }

  // Campos personalizados editáveis pelo papel do usuário (ou campos de Sync com
  // force_sync_write_back — "sempre editáveis nos Registros" para quem tem a permissão).
  let customChanged = false;
  for (const def of defs ?? []) {
    // Calculados são derivados — nunca editados manualmente. Os de agregados
    // nem sequer têm valor por registro.
    if ((def.data_type as DataType) === "calculado") continue;
    if ((def.data_type as DataType) === "calculado_agg") continue;
    const isBitrixSync =
      def.source_system === "bitrix" && Boolean(def.source_field_id);
    const roleAllows = ((def.editable_by_roles as string[]) ?? []).some((r) =>
      roles.includes(r)
    );
    const editable = roleAllows || (forceSync && isBitrixSync) || allowEdit;
    if (!editable) continue;
    const key = `custom__${def.field_key}`;
    if (!formData.has(key)) continue;
    const val = coerce(def.data_type as DataType, formData.get(key));
    const old = custom[def.field_key as string] ?? null;
    if (String(old ?? "") !== String(val ?? "")) {
      custom[def.field_key as string] = val;
      fmod[def.field_key as string] = now;
      audits.push({ field: def.field_key as string, old_value: old, new_value: val });
      customChanged = true;
    }
  }
  if (customChanged) updates.custom_fields = custom;

  // Efeitos colaterais das relações
  if ("responsible_id" in updates && !("operation_id" in updates)) {
    const op = await primaryOperationId(
      supabase,
      updates.responsible_id as string | null
    );
    updates.operation_id = op;
  }
  if ("related_lead_id" in updates) {
    const leadId = updates.related_lead_id as string | null;
    let leadCreated: string | null = null;
    if (leadId) {
      const { data: lead } = await supabase
        .from("records")
        .select("source_created_at")
        .eq("id", leadId)
        .maybeSingle();
      leadCreated = (lead?.source_created_at as string) ?? null;
    }
    const refDate =
      existing.record_type === "venda_site"
        ? existing.source_created_at
        : existing.closed_at;
    updates.lead_time_days = leadCreated
      ? leadTimeDays(refDate, leadCreated)
      : null;
  }

  // Recomputa os campos calculados a partir dos valores efetivos do registro
  // (edição desta chamada > registro) — lógica compartilhada com createRecord.
  {
    const eff = (col: string): unknown =>
      col in updates
        ? updates[col]
        : ((existing as unknown as Record<string, unknown>)[col] ?? null);
    const calcChanged = await applyCalcFields(
      supabase,
      {
        value: eff("value"),
        mrr: eff("mrr"),
        lead_time_days:
          "lead_time_days" in updates
            ? updates.lead_time_days
            : existing.lead_time_days,
        title: eff("title"),
        record_type: existing.record_type,
        source_system: existing.source_system,
        pipeline: eff("pipeline"),
        stage: eff("stage"),
        stage_semantic: eff("stage_semantic"),
        sale_type: eff("sale_type"),
        channel: eff("channel"),
        currency: eff("currency"),
        closed: eff("closed"),
        closed_at: existing.closed_at,
        opened_at: (eff("opened_at") as string | null) ?? null,
        source_created_at: existing.source_created_at,
      },
      custom
    );
    if (calcChanged) updates.custom_fields = custom;
  }

  if (Object.keys(updates).length === 0) {
    return { ok: true, message: "Nada para alterar." };
  }

  updates.field_modified_at = fmod;
  updates.locally_modified_at = now;

  const { error } = await supabase
    .from("records")
    .update(updates)
    .eq("id", recordId);
  if (error) return { ok: false, message: error.message };

  if (audits.length > 0) {
    await supabase.from("audit_log").insert(
      audits.map((a) => ({
        record_id: recordId,
        user_id: session.user.id,
        field: a.field,
        old_value: a.old_value ?? null,
        new_value: a.new_value ?? null,
        origin: "app" as const,
      }))
    );
  }

  // Write-back (fila em background): enfileira as mudanças de campos marcados
  // (write_back) de volta ao Bitrix. A edição local JÁ foi salva; a fila é
  // best-effort (drenada pelo tick) e nunca falha a edição. Relações e campos
  // sem source_field_id do Bitrix são ignorados (não estão em defByKey/bitrix).
  if (existing.source_system === "bitrix" && existing.source_id) {
    const entity =
      existing.record_type === "negocio"
        ? "deal"
        : existing.record_type === "lead"
          ? "lead"
          : null;
    if (entity) {
      const defByKey = new Map(
        (defs ?? []).map((d) => [d.field_key as string, d])
      );
      const changes: WriteBackChange[] = [];
      for (const a of audits) {
        const d = defByKey.get(a.field);
        if (d) {
          // Campo personalizado de Sync: grava se marcado (write_back), forçado
          // pelos Registros (forceSync) ou pela coluna do dashboard (override).
          const isBitrix =
            d.source_system === "bitrix" && Boolean(d.source_field_id);
          if (!isBitrix) continue;
          if (!(d.write_back || forceSync || wbOverride(a.field))) continue;
          changes.push({
            fieldKey: a.field,
            sourceFieldId: d.source_field_id as string,
            label: (d.label as string) ?? null,
            newValue: a.new_value ?? null,
          });
          continue;
        }
        // Coluna do núcleo (ou relação responsável) mapeada p/ o Bitrix: grava
        // quando forçado (Registros) ou marcado na coluna do dashboard.
        const sfid = coreWriteBackFieldId(a.field, entity);
        if (sfid && (forceSync || wbOverride(a.field))) {
          // Responsável (ASSIGNED_BY_ID): o valor gravado no record é o uuid local
          // de `responsibles`. O Bitrix espera o id do usuário, então traduzimos
          // via responsibles.bitrix_user_id. Sem esse vínculo (ou sem responsável),
          // pulamos — a edição fica local. Demais colunas gravam o valor cru.
          if (a.field === "responsible_id") {
            const respUuid = a.new_value == null ? null : String(a.new_value);
            if (!respUuid) continue;
            const { data: resp } = await supabase
              .from("responsibles")
              .select("bitrix_user_id")
              .eq("id", respUuid)
              .maybeSingle();
            const bitrixUserId = (resp?.bitrix_user_id as string | null) ?? null;
            if (!bitrixUserId) continue;
            changes.push({
              fieldKey: a.field,
              sourceFieldId: sfid,
              label: a.field,
              newValue: bitrixUserId,
            });
            continue;
          }
          changes.push({
            fieldKey: a.field,
            sourceFieldId: sfid,
            label: a.field,
            newValue: a.new_value ?? null,
          });
        }
      }
      if (changes.length > 0) {
        try {
          await enqueueWriteBacks(createServiceClient(), {
            recordId,
            entity,
            sourceId: existing.source_id,
            createdBy: session.user.id,
            changes,
          });
        } catch {
          // best-effort: nunca falha a edição local por causa da fila.
        }
      }
    }
  }

  revalidatePath("/registros");
  return { ok: true, message: "Registro atualizado." };
}

export interface UpdateFieldOptions {
  // 'custom' (padrão) grava em custom_fields; 'core' grava numa coluna do núcleo;
  // 'relation' grava uma coluna FK (responsável/operação/lead), sempre local.
  kind?: "custom" | "core" | "relation";
  // Dashboard: esta coluna deve gravar de volta no Bitrix.
  writeBack?: boolean;
  // Registros: campos de Sync sempre gravam no Bitrix (e ficam editáveis).
  forceSyncWriteBack?: boolean;
  // Dashboard: coluna marcada como editável libera a edição p/ quem tem permissão
  // mesmo sem editable_by_roles (só relevante para campos personalizados).
  allowEdit?: boolean;
}

/**
 * Grava um único campo de um registro (edição inline na tabela). Reaproveita
 * `updateRecord` construindo um FormData com só aquele campo — toda a lógica de
 * permissão, coerção, field_modified_at, recomputo de fórmulas, audit_log,
 * write-back e revalidatePath vem de graça. `kind` escolhe custom vs coluna do
 * núcleo; as flags de write-back viram os campos que `updateRecord` já entende.
 */
export async function updateRecordField(
  recordId: string,
  fieldKey: string,
  rawValue: string,
  opts: UpdateFieldOptions = {}
): Promise<EditActionState> {
  const fd = new FormData();
  fd.set("record_id", recordId);
  // 'relation' usa a própria chave da coluna FK (responsible_id/…), que o laço
  // RELATIONS de updateRecord já entende; 'core'/'custom' usam os prefixos.
  if (opts.kind === "relation") {
    if (!(RELATIONS as readonly string[]).includes(fieldKey)) {
      return { ok: false, message: "Relação inválida." };
    }
    fd.set(fieldKey, rawValue);
  } else {
    const key = opts.kind === "core" ? `core__${fieldKey}` : `custom__${fieldKey}`;
    fd.set(key, rawValue);
  }
  if (opts.writeBack) fd.set(`write_back__${fieldKey}`, "1");
  if (opts.forceSyncWriteBack) fd.set("force_sync_write_back", "1");
  if (opts.allowEdit) fd.set("allow_edit", "1");
  return updateRecord({}, fd);
}

// ===================== Criação manual de registros =====================

export interface CreateRecordState {
  ok?: boolean;
  message?: string;
  // id do registro criado (consumido pelo quick-create do kanban).
  id?: string;
}

/**
 * Cria um registro MANUAL numa fonte com manual_entry (0061). Gravação com o
 * client do usuário: a RLS records_insert exige edit_record_values,
 * source_system='manual', source_id nulo, fonte com manual_entry e — sem
 * view_all_records (vendedor) — responsável vinculado ao próprio usuário
 * (forçado aqui também, p/ mensagem de erro amigável antes do banco).
 * Campos aceitos no FormData: `source` (key da fonte), `core__<coluna>`
 * (EDITABLE_CORE_COLUMNS; title obrigatório), `custom__<field_key>` (gating
 * por editable_by_roles + applies_to), `responsible_id` e `operation_id`.
 */
export async function createRecord(
  _prev: CreateRecordState,
  formData: FormData
): Promise<CreateRecordState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.permissions.includes("edit_record_values")) {
    return { ok: false, message: "Você não tem permissão para criar registros." };
  }
  const roles = session.roles;
  const viewAll = session.permissions.includes("view_all_records");

  const supabase = await createClient();
  const sources = await loadSources(supabase);
  const sourceKey = String(formData.get("source") ?? "");
  const sourceDef = sources.find((s) => s.key === sourceKey);
  if (!sourceDef) return { ok: false, message: "Fonte inválida." };
  if (!sourceDef.manualEntry) {
    return {
      ok: false,
      message: "Esta fonte não aceita criação manual de registros.",
    };
  }

  const title = String(formData.get("core__title") ?? "").trim();
  if (!title) return { ok: false, message: "Informe o nome do registro." };

  // Responsável: sem view_all_records, o registro precisa nascer atribuído a um
  // responsável vinculado ao próprio usuário (espelha a RLS; corrige silencioso
  // quando o form manda outro valor).
  let responsibleId = String(formData.get("responsible_id") ?? "") || null;
  if (!viewAll) {
    const { data: own } = await supabase
      .from("responsibles")
      .select("id")
      .eq("user_id", session.user.id)
      .eq("active", true);
    const ownIds = (own ?? []).map((r) => r.id as string);
    if (ownIds.length === 0) {
      return {
        ok: false,
        message:
          "Seu usuário não está vinculado a um responsável — peça a um administrador (Configurações → Responsáveis).",
      };
    }
    responsibleId =
      responsibleId && ownIds.includes(responsibleId)
        ? responsibleId
        : ownIds[0];
  }

  const now = new Date().toISOString();
  const custom: Record<string, unknown> = {};
  const fmod: Record<string, string> = {};
  const audits: { field: string; new_value: unknown }[] = [];

  const row: Record<string, unknown> = {
    record_type: sourceDef.recordType,
    source_system: "manual",
    source_id: null,
    is_mock: false,
    owner_user_id: session.user.id,
    responsible_id: responsibleId,
    // Data de criação "na origem" = agora (é o default_period_field mais comum
    // e o que a listagem de Registros ordena).
    source_created_at: now,
    locally_modified_at: now,
  };
  if (responsibleId) {
    fmod.responsible_id = now;
    audits.push({ field: "responsible_id", new_value: responsibleId });
  }

  // Colunas do núcleo (title obrigatório; demais opcionais).
  for (const [col, dtype] of Object.entries(EDITABLE_CORE_COLUMNS)) {
    const key = `core__${col}`;
    if (!formData.has(key)) continue;
    const val = coerceCore(dtype, formData.get(key));
    if (val == null) continue;
    row[col] = val;
    fmod[col] = now;
    audits.push({ field: col, new_value: val });
  }

  // Operação: explícita no form ou derivada do responsável (como updateRecord).
  const operationRaw = String(formData.get("operation_id") ?? "");
  if (operationRaw) {
    row.operation_id = operationRaw;
    fmod.operation_id = now;
    audits.push({ field: "operation_id", new_value: operationRaw });
  } else if (responsibleId) {
    row.operation_id = await primaryOperationId(supabase, responsibleId);
  }

  // Campos personalizados: só os da fonte (applies_to) editáveis pelo papel.
  const { data: defs } = await supabase
    .from("field_definitions")
    .select("field_key, data_type, editable_by_roles, applies_to");
  for (const def of defs ?? []) {
    const dt = def.data_type as DataType;
    if (dt === "calculado" || dt === "calculado_agg") continue;
    if (!fieldAppliesToSource(def.applies_to as string[] | null, sourceDef.key)) {
      continue;
    }
    const roleAllows = ((def.editable_by_roles as string[]) ?? []).some((r) =>
      roles.includes(r)
    );
    if (!roleAllows) continue;
    const key = `custom__${def.field_key}`;
    if (!formData.has(key)) continue;
    const val = coerce(dt, formData.get(key));
    if (val == null) continue;
    custom[def.field_key as string] = val;
    fmod[def.field_key as string] = now;
    audits.push({ field: def.field_key as string, new_value: val });
  }

  // Campos calculados já nascem materializados (mesma lógica de updateRecord).
  await applyCalcFields(
    supabase,
    {
      value: row.value ?? null,
      mrr: row.mrr ?? null,
      lead_time_days: null,
      title,
      record_type: sourceDef.recordType,
      source_system: "manual",
      pipeline: row.pipeline ?? null,
      stage: row.stage ?? null,
      stage_semantic: null,
      sale_type: row.sale_type ?? null,
      channel: row.channel ?? null,
      currency: row.currency ?? null,
      closed: row.closed ?? null,
      closed_at: (row.closed_at as string | null) ?? null,
      opened_at: (row.opened_at as string | null) ?? null,
      source_created_at: now,
    },
    custom
  );

  row.custom_fields = custom;
  row.field_modified_at = fmod;

  const { data: inserted, error } = await supabase
    .from("records")
    .insert(row)
    .select("id")
    .single();
  if (error) {
    return { ok: false, message: `Falha ao criar: ${error.message}` };
  }
  const id = inserted.id as string;

  if (audits.length > 0) {
    await supabase.from("audit_log").insert(
      audits.map((a) => ({
        record_id: id,
        user_id: session.user.id,
        field: a.field,
        old_value: null,
        new_value: a.new_value ?? null,
        origin: "app" as const,
      }))
    );
  }

  revalidatePath("/registros");
  return { ok: true, message: "Registro criado.", id };
}

export interface LeadOption {
  id: string;
  label: string;
}

/** Busca registros de uma fonte por nome (comboboxes de vínculo). `recordType`
 *  ausente busca em todas as fontes. RLS decide o que o usuário vê. */
export async function searchRecords(
  recordType: string | null,
  query: string
): Promise<LeadOption[]> {
  const session = await getSessionInfo();
  if (!session) return [];
  const q = query.trim();
  const supabase = await createClient();
  let builder = supabase
    .from("records")
    .select("id, title, source_created_at")
    .eq("is_mock", false)
    .order("source_created_at", { ascending: false, nullsFirst: false })
    .limit(20);
  if (recordType) builder = builder.eq("record_type", recordType);
  if (q) builder = builder.ilike("title", `%${q}%`);
  const { data } = await builder;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    label: (r.title as string) ?? "(sem nome)",
  }));
}

/** Busca leads do sistema por nome (para o combobox de lead relacionado). */
export async function searchLeads(query: string): Promise<LeadOption[]> {
  return searchRecords("lead", query);
}
