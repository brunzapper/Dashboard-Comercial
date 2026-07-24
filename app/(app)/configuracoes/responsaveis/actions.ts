// Versão: 1.1 | Data: 13/07/2026
// Server Actions da tela de Responsáveis (admin): criar, ativar/desativar e
// mapear operações com prioridade (responsible_operations). RLS exige admin.
// v1.1 (13/07/2026): createResponsible — responsáveis criados só no sistema
//   (sem bitrix_user_id). Não aparecem em dropdowns write-back (não há usuário
//   Bitrix p/ onde gravar); o guard em lib/records/actions.ts também os pula.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { isSettingsAreaDenied } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";

export interface ResponsibleState {
  ok?: boolean;
  message?: string;
}

async function ensureAdmin(): Promise<boolean> {
  const s = await getSessionInfo();
  if (!s || !s.roles.includes("admin")) return false;
  // Override individual `deny` da área barra também a escrita (não só a page).
  return !(await isSettingsAreaDenied("responsaveis"));
}

export async function createResponsible(
  _prev: ResponsibleState,
  formData: FormData
): Promise<ResponsibleState> {
  if (!(await ensureAdmin())) {
    return { ok: false, message: "Apenas administradores." };
  }
  const name = String(formData.get("display_name") ?? "").trim();
  if (!name) return { ok: false, message: "Informe o nome." };

  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  // bitrix_user_id fica null: responsável só do sistema.
  const { error } = await supabase
    .from("responsibles")
    .insert({
      display_name: name,
      // Carimbo de org (multi-org, 0090).
      ...(orgId ? { organization_id: orgId } : {}),
    });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/configuracoes/responsaveis");
  return { ok: true, message: `Responsável "${name}" criado.` };
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
