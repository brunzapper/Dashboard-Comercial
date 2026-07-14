// Versão: 1.1 | Data: 09/07/2026
// Server Actions de edição de registros. Gravação com o client do usuário
// (RLS: records_update exige edit_record_values E owner/view_all). Toda edição
// grava field_modified_at[campo]=now (protege do sync) + audit_log origin 'app'.
// v1.1 (09/07/2026): Fase 7 — recomputa os campos calculados do registro após a
//   edição manual (dependem de value/mrr/lead_time_days e de custom numéricos).
"use server";

import { revalidatePath } from "next/cache";

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

  // Recomputa os campos calculados a partir dos valores efetivos do registro.
  const formulaDefs = await loadFormulaDefs(supabase);
  if (formulaDefs.length > 0) {
    const effLeadTime =
      "lead_time_days" in updates ? updates.lead_time_days : existing.lead_time_days;
    // Valor efetivo de uma coluna do núcleo (edição desta chamada > registro).
    const eff = (col: string): unknown =>
      col in updates
        ? updates[col]
        : ((existing as unknown as Record<string, unknown>)[col] ?? null);
    // Calc-fields monetários convertem os operandos p/ a moeda de destino.
    // Usa a moeda/datas EFETIVAS: se esta edição troca a Moeda do registro, o
    // carimbo (<key>__cur) já sai na moeda nova na mesma gravação.
    const conv = anyMoneyDef(formulaDefs)
      ? buildRecordCurrencyContext(
          {
            currency: (eff("currency") as string | null) ?? null,
            closed_at: existing.closed_at,
            opened_at: (eff("opened_at") as string | null) ?? null,
            source_created_at: existing.source_created_at,
          },
          await loadCurrencyMaterials(supabase)
        )
      : undefined;
    // Contexto de datas (próprias + custom) para aritmética de datas. Operandos
    // match:<fonte> ficam para o recalc (regra de "pular" em computeFormulaFields).
    const dateCtx = buildDateContext(
      {
        closed_at: existing.closed_at,
        opened_at: (eff("opened_at") as string | null) ?? null,
        source_created_at: existing.source_created_at,
      },
      custom,
      await loadCustomDateKeys(supabase)
    );
    const calc = computeFormulaFields(
      {
        value: numOrNull(eff("value") ?? existing.value),
        mrr: numOrNull(eff("mrr") ?? existing.mrr),
        lead_time_days: numOrNull(effLeadTime),
        // Colunas textuais/booleanas do núcleo (condicionais SE/E/OU).
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
      },
      custom,
      formulaDefs,
      conv,
      dateCtx
    );
    let calcChanged = false;
    for (const [k, v] of Object.entries(calc)) {
      if (String(custom[k] ?? "") !== String(v ?? "")) {
        custom[k] = v;
        calcChanged = true;
      }
    }
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

export interface LeadOption {
  id: string;
  label: string;
}

/** Busca leads do sistema por nome (para o combobox de lead relacionado). */
export async function searchLeads(query: string): Promise<LeadOption[]> {
  const session = await getSessionInfo();
  if (!session) return [];
  const q = query.trim();
  const supabase = await createClient();
  let builder = supabase
    .from("records")
    .select("id, title, source_created_at")
    .eq("record_type", "lead")
    .order("source_created_at", { ascending: false })
    .limit(20);
  if (q) builder = builder.ilike("title", `%${q}%`);
  const { data } = await builder;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    label: (r.title as string) ?? "(sem nome)",
  }));
}
