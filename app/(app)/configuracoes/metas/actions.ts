// Versão: 1.1 | Data: 23/07/2026
// Server Actions da tela de Metas (goals) — admin. RLS de goals exige admin.
// v1.1 (23/07/2026): multi-org (0090) — carimbo de organization_id em goals/
//   non_working_days/sync_config e onConflict das PKs compostas.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import {
  GOAL_METRICS_CONFIG_KEY,
  loadGoalMetrics,
} from "@/lib/config/goal-metrics";
import { goalMetricKeyFromLabel } from "@/lib/metas/metrics";

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

  const orgId = await getActiveOrgId();
  const row = {
    period_year: year,
    period_month: month,
    scope,
    operation_id: operationId,
    responsible_id: responsibleId,
    metric,
    target,
    ...(orgId ? { organization_id: orgId } : {}),
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

// ===================== Métricas de meta (registry) =====================
// `goals.metric` sempre foi texto livre (0016). O registry dá vocabulário às
// chaves: builtins + custom em sync_config 'goal_metrics'. Criar uma métrica
// aqui NÃO cria consulta — o realizado é sempre a consulta do próprio widget.

export async function createGoalMetric(label: string): Promise<GoalState> {
  const err = await ensureAdmin();
  if (err) return { ok: false, message: err };
  const clean = String(label ?? "").trim();
  if (!clean) return { ok: false, message: "Informe o nome da métrica." };
  const key = goalMetricKeyFromLabel(clean);
  if (!key) return { ok: false, message: "Nome inválido para gerar a chave." };

  const supabase = await createClient();
  const registry = await loadGoalMetrics(supabase);
  if (registry.some((m) => m.key === key))
    return { ok: false, message: `Métrica "${key}" já existe.` };

  // sync_config tem PK (organization_id, key) desde a 0090.
  const orgId = await getActiveOrgId();
  let regQuery = supabase
    .from("sync_config")
    .select("value")
    .eq("key", GOAL_METRICS_CONFIG_KEY);
  if (orgId) regQuery = regQuery.eq("organization_id", orgId);
  const { data } = await regQuery.maybeSingle();
  const current = Array.isArray(data?.value) ? (data.value as unknown[]) : [];
  const { error } = await supabase
    .from("sync_config")
    .upsert(
      {
        key: GOAL_METRICS_CONFIG_KEY,
        value: [...current, { key, label: clean }],
        ...(orgId ? { organization_id: orgId } : {}),
      },
      { onConflict: "organization_id,key" }
    );
  if (error) return { ok: false, message: error.message };
  revalidatePath("/configuracoes/metas");
  return { ok: true, message: `Métrica "${clean}" criada (chave ${key}).` };
}

// ===================== Dias não úteis (0081) =====================
// Calendário global de feriados/paradas consumido pelos utilitários de dia
// útil (lib/date/business-days.ts). Upsert por dia; o import CSV do manager
// chama esta mesma action com o lote já parseado no browser.

const MAX_NON_WORKING_ROWS = 500;

export async function upsertNonWorkingDays(
  rows: { day: string; label?: string }[]
): Promise<GoalState> {
  const err = await ensureAdmin();
  if (err) return { ok: false, message: err };
  const clean = rows
    .map((r) => ({
      day: String(r.day ?? "").slice(0, 10),
      label: String(r.label ?? "").trim().slice(0, 200),
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day));
  if (clean.length === 0)
    return { ok: false, message: "Nenhuma data válida para salvar." };
  if (clean.length > MAX_NON_WORKING_ROWS)
    return {
      ok: false,
      message: `Máximo de ${MAX_NON_WORKING_ROWS} datas por importação.`,
    };
  // Última ocorrência de um dia duplicado no lote vence. PK composta
  // (organization_id, day) desde a 0090 — calendário POR org.
  const orgId = await getActiveOrgId();
  const byDay = new Map(
    clean.map((r) => [
      r.day,
      { ...r, ...(orgId ? { organization_id: orgId } : {}) },
    ])
  );
  const supabase = await createClient();
  const { error } = await supabase
    .from("non_working_days")
    .upsert(Array.from(byDay.values()), {
      onConflict: "organization_id,day",
    });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/configuracoes/metas");
  return { ok: true, message: `${byDay.size} dia(s) não útil(eis) salvo(s).` };
}

export async function deleteNonWorkingDay(day: string): Promise<void> {
  const err = await ensureAdmin();
  if (err) return;
  const iso = String(day ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
  const supabase = await createClient();
  await supabase.from("non_working_days").delete().eq("day", iso);
  revalidatePath("/configuracoes/metas");
}
