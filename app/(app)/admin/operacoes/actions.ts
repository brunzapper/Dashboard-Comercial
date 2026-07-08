// Versão: 1.0 | Data: 05/07/2026
// Server Actions da tela de Operações (admin). Suporta aninhamento
// (parent_operation_id). RLS de operations exige papel admin para escrever.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

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
  const { error } = await supabase
    .from("operations")
    .insert({ name, parent_operation_id: parent });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/operacoes");
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
  revalidatePath("/admin/operacoes");
}

export async function deleteOperation(id: string): Promise<void> {
  const err = await ensureAdmin();
  if (err) return;
  const supabase = await createClient();
  await supabase.from("operations").delete().eq("id", id);
  revalidatePath("/admin/operacoes");
}
