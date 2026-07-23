// Versão: 1.1 | Data: 20/07/2026
// Server Actions da tela de Operações (admin). Suporta aninhamento
// (parent_operation_id). RLS de operations exige papel admin para escrever.
// v1.1 (20/07/2026): updateOperationFilter — FILTROS DE PERFIL da operação
// (operations.filter, 0083; WidgetFilter[] com `sources` opcional por
// condição), consumidos pelo filtro de Operação da visualização
// (lib/config/operation-scope.ts).
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import type { WidgetFilter } from "@/lib/widgets/types";

export interface OpState {
  ok?: boolean;
  message?: string;
}

async function ensureAdmin(): Promise<string | null> {
  const s = await getSessionInfo();
  if (!s) return "Sessão expirada.";
  if (!s.roles.includes("admin")) return "Apenas administradores.";
  return null;
}

export async function createOperation(
  _prev: OpState,
  formData: FormData
): Promise<OpState> {
  const err = await ensureAdmin();
  if (err) return { ok: false, message: err };
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "Informe o nome." };
  const parent = String(formData.get("parent_operation_id") ?? "") || null;

  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  const { error } = await supabase
    .from("operations")
    .insert({
      name,
      parent_operation_id: parent,
      // Carimbo de org (multi-org, 0090).
      ...(orgId ? { organization_id: orgId } : {}),
    });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/configuracoes/operacoes");
  return { ok: true, message: `Operação "${name}" criada.` };
}

export async function updateOperation(
  id: string,
  patch: { name?: string; active?: boolean; parent_operation_id?: string | null }
): Promise<void> {
  const err = await ensureAdmin();
  if (err) return;
  if (patch.parent_operation_id === id) return; // evita pai = ele mesmo
  const supabase = await createClient();
  await supabase.from("operations").update(patch).eq("id", id);
  revalidatePath("/configuracoes/operacoes");
}

export async function deleteOperation(id: string): Promise<void> {
  const err = await ensureAdmin();
  if (err) return;
  const supabase = await createClient();
  await supabase.from("operations").delete().eq("id", id);
  revalidatePath("/configuracoes/operacoes");
}

// Ops aceitos no perfil (mesmo vocabulário do editor de sub-fontes + os
// normalizados *_ci — "diferente de" com null contando).
const PROFILE_OPS = new Set([
  "eq",
  "neq",
  "eq_ci",
  "neq_ci",
  "in",
  "ilike",
  "gt",
  "gte",
  "lt",
  "lte",
  "is_null",
  "not_null",
]);
const NO_VALUE_OPS = new Set(["is_null", "not_null"]);

export async function updateOperationFilter(
  id: string,
  filter: WidgetFilter[]
): Promise<OpState> {
  const err = await ensureAdmin();
  if (err) return { ok: false, message: err };
  if (!Array.isArray(filter)) return { ok: false, message: "Filtro inválido." };
  const clean: WidgetFilter[] = [];
  for (const f of filter) {
    const field = String(f?.field ?? "").trim();
    const op = String(f?.op ?? "");
    if (!field || !PROFILE_OPS.has(op)) {
      return { ok: false, message: "Condição inválida no perfil." };
    }
    const sources = Array.isArray(f.sources)
      ? f.sources.map(String).filter(Boolean)
      : undefined;
    if (NO_VALUE_OPS.has(op)) {
      clean.push({
        field,
        op: op as WidgetFilter["op"],
        ...(sources && sources.length > 0
          ? { sources: sources as WidgetFilter["sources"] }
          : {}),
      });
      continue;
    }
    const value = f.value;
    const scalarOk =
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean";
    const listOk =
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((v) => typeof v === "string" || typeof v === "number");
    if (op === "in" ? !listOk : !scalarOk) {
      return { ok: false, message: `Valor inválido na condição de "${field}".` };
    }
    clean.push({
      field,
      op: op as WidgetFilter["op"],
      value,
      ...(sources && sources.length > 0
        ? { sources: sources as WidgetFilter["sources"] }
        : {}),
    });
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("operations")
    .update({ filter: clean })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/configuracoes/operacoes");
  return { ok: true, message: "Perfil da operação salvo." };
}
