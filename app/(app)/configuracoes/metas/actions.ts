// Versão: 1.0 | Data: 05/07/2026
// Server Actions da tela de Metas (goals) — admin. RLS de goals exige admin.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export interface GoalState {
  ok?: boolean;
  message?: string;
}

async function ensureAdmin(): Promise<string | null> {
  const s = await getSessionInfo();
  if (!s) return "Sessão expirada.";
  if (!s.roles.includes("admin")) return "Apenas administradores.";
  return null;
}

export async function createGoal(
  _prev: GoalState,
  formData: FormData
): Promise<GoalState> {
  const err = await ensureAdmin();
  if (err) return { ok: false, message: err };

  const year = Number(formData.get("period_year")) || new Date().getFullYear();
  const monthRaw = String(formData.get("period_month") ?? "");
  const month = monthRaw === "" ? null : Number(monthRaw);
  const scope = String(formData.get("scope") ?? "global");
  const metric = String(formData.get("metric") ?? "mrr");
  const target = Number(formData.get("target"));
  if (Number.isNaN(target)) return { ok: false, message: "Informe o alvo." };

  const operationId =
    scope === "operation" ? String(formData.get("operation_id") ?? "") || null : null;
  const responsibleId =
    scope === "responsible"
      ? String(formData.get("responsible_id") ?? "") || null
      : null;
  if (scope === "operation" && !operationId)
    return { ok: false, message: "Selecione a operação." };
  if (scope === "responsible" && !responsibleId)
    return { ok: false, message: "Selecione o responsável." };

  const supabase = await createClient();
  // Upsert manual: o índice único usa coalesce() (expressão), então não dá para
  // usar onConflict por colunas — procuramos a meta existente e atualizamos.
  let find = supabase
    .from("goals")
    .select("id")
    .eq("period_year", year)
    .eq("scope", scope)
    .eq("metric", metric);
  find = month == null ? find.is("period_month", null) : find.eq("period_month", month);
  find = operationId ? find.eq("operation_id", operationId) : find.is("operation_id", null);
  find = responsibleId
    ? find.eq("responsible_id", responsibleId)
    : find.is("responsible_id", null);
  const { data: existing } = await find.maybeSingle();

  const row = {
    period_year: year,
    period_month: month,
    scope,
    operation_id: operationId,
    responsible_id: responsibleId,
    metric,
    target,
  };
  const { error } = existing?.id
    ? await supabase.from("goals").update({ target }).eq("id", existing.id)
    : await supabase.from("goals").insert(row);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/configuracoes/metas");
  return { ok: true, message: "Meta salva." };
}

export async function deleteGoal(id: string): Promise<void> {
  const err = await ensureAdmin();
  if (err) return;
  const supabase = await createClient();
  await supabase.from("goals").delete().eq("id", id);
  revalidatePath("/configuracoes/metas");
}
