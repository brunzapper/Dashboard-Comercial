// Versão: 1.0 | Data: 05/07/2026
// Server Actions da tela de Responsáveis (admin): ativar/desativar e mapear
// operações com prioridade (responsible_operations). RLS exige admin.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

async function ensureAdmin(): Promise<boolean> {
  const s = await getSessionInfo();
  return !!s && s.roles.includes("admin");
}

export async function setResponsibleActive(
  id: string,
  active: boolean
): Promise<void> {
  if (!(await ensureAdmin())) return;
  const supabase = await createClient();
  await supabase.from("responsibles").update({ active }).eq("id", id);
  revalidatePath("/configuracoes/responsaveis");
}

export async function addResponsibleOperation(
  responsibleId: string,
  operationId: string,
  priority: number
): Promise<void> {
  if (!(await ensureAdmin())) return;
  if (!operationId) return;
  const supabase = await createClient();
  await supabase
    .from("responsible_operations")
    .upsert(
      { responsible_id: responsibleId, operation_id: operationId, priority },
      { onConflict: "responsible_id,operation_id" }
    );
  revalidatePath("/configuracoes/responsaveis");
}

export async function removeResponsibleOperation(
  responsibleId: string,
  operationId: string
): Promise<void> {
  if (!(await ensureAdmin())) return;
  const supabase = await createClient();
  await supabase
    .from("responsible_operations")
    .delete()
    .eq("responsible_id", responsibleId)
    .eq("operation_id", operationId);
  revalidatePath("/configuracoes/responsaveis");
}
