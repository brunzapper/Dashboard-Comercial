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
import { leadTimeDays, primaryOperationId } from "@/lib/sync/shared";
import { computeFormulaFields, loadFormulaDefs } from "@/lib/records/formulas";
import type { DataType } from "@/lib/records/types";

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

  const supabase = await createClient();

  const { data: existingRow } = await supabase
    .from("records")
    .select(
      "id, record_type, custom_fields, field_modified_at, responsible_id, operation_id, related_lead_id, source_created_at, closed_at, value, mrr, lead_time_days"
    )
    .eq("id", recordId)
    .maybeSingle();
  const existing = existingRow as ExistingForEdit | null;
  if (!existing) return { ok: false, message: "Registro não encontrado." };

  const { data: defs } = await supabase
    .from("field_definitions")
    .select("field_key, data_type, editable_by_roles");

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

  // Campos personalizados editáveis pelo papel do usuário
  let customChanged = false;
  for (const def of defs ?? []) {
    // Calculados são derivados — nunca editados manualmente.
    if ((def.data_type as DataType) === "calculado") continue;
    const editable = ((def.editable_by_roles as string[]) ?? []).some((r) =>
      roles.includes(r)
    );
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
    const calc = computeFormulaFields(
      {
        value: numOrNull(existing.value),
        mrr: numOrNull(existing.mrr),
        lead_time_days: numOrNull(effLeadTime),
      },
      custom,
      formulaDefs
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

  revalidatePath("/registros");
  return { ok: true, message: "Registro atualizado." };
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
