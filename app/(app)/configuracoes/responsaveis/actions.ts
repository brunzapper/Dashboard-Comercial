// Versão: 1.2 | Data: 26/07/2026
// Server Actions da tela de Responsáveis (admin): criar, ativar/desativar e
// mapear operações com prioridade (responsible_operations). RLS exige admin.
// v1.2 (26/07/2026): setResponsibleCanonical — agrupamento de exibição (0101):
//   marca um responsável como apelido de outro ("nome usado"), mantendo o
//   grupo PLANO (alvo apelido resolve pro principal dele; filhos do que vira
//   apelido repontam ANTES — falha parcial deixa estado válido). Reversível
//   (canonical_id = null); records.responsible_id nunca é repontado.
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

const DENIED = { ok: false as const, message: "Apenas administradores." };

export async function setResponsibleActive(
  id: string,
  active: boolean
): Promise<ResponsibleState> {
  if (!(await ensureAdmin())) return DENIED;
  const supabase = await createClient();
  const { error } = await supabase
    .from("responsibles")
    .update({ active })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/configuracoes/responsaveis");
  return { ok: true };
}

export async function setResponsibleCanonical(
  id: string,
  canonicalId: string | null
): Promise<ResponsibleState> {
  if (!(await ensureAdmin())) return DENIED;
  const supabase = await createClient();
  if (!canonicalId) {
    // Desfazer: só a própria linha volta a ser principal (filhos, se houver,
    // permanecem apontando para ela).
    const { error } = await supabase
      .from("responsibles")
      .update({ canonical_id: null })
      .eq("id", id);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/configuracoes/responsaveis");
    return { ok: true };
  }
  if (canonicalId === id) {
    return { ok: false, message: "Um responsável não pode ser apelido dele mesmo." };
  }
  const { data: rows } = await supabase
    .from("responsibles")
    .select("id, canonical_id, organization_id")
    .in("id", [id, canonicalId]);
  const me = (rows ?? []).find((r) => r.id === id);
  const target = (rows ?? []).find((r) => r.id === canonicalId);
  if (!me || !target) {
    return { ok: false, message: "Responsável não encontrado." };
  }
  // Multi-org (0090): apelido e principal sempre da MESMA organização.
  if ((me.organization_id ?? null) !== (target.organization_id ?? null)) {
    return { ok: false, message: "Responsáveis de organizações diferentes." };
  }
  // Grupo plano: alvo que já é apelido resolve para o principal DELE; alvo
  // cujo principal sou eu criaria ciclo — recusa.
  const root = (target.canonical_id as string | null) ?? (target.id as string);
  if (root === id) {
    return { ok: false, message: "Esse vínculo criaria um ciclo de apelidos." };
  }
  // Filhos do que vira apelido repontam ANTES da própria linha: uma falha no
  // 2º passo deixa o grafo plano e válido (nunca uma cadeia).
  const { error: childrenError } = await supabase
    .from("responsibles")
    .update({ canonical_id: root })
    .eq("canonical_id", id);
  if (childrenError) return { ok: false, message: childrenError.message };
  const { error } = await supabase
    .from("responsibles")
    .update({ canonical_id: root })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/configuracoes/responsaveis");
  return { ok: true };
}

export async function addResponsibleOperation(
  responsibleId: string,
  operationId: string,
  priority: number
): Promise<ResponsibleState> {
  if (!(await ensureAdmin())) return DENIED;
  if (!operationId) return { ok: false, message: "Escolha a operação." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("responsible_operations")
    .upsert(
      { responsible_id: responsibleId, operation_id: operationId, priority },
      { onConflict: "responsible_id,operation_id" }
    );
  if (error) return { ok: false, message: error.message };
  revalidatePath("/configuracoes/responsaveis");
  return { ok: true };
}

export async function removeResponsibleOperation(
  responsibleId: string,
  operationId: string
): Promise<ResponsibleState> {
  if (!(await ensureAdmin())) return DENIED;
  const supabase = await createClient();
  const { error } = await supabase
    .from("responsible_operations")
    .delete()
    .eq("responsible_id", responsibleId)
    .eq("operation_id", operationId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/configuracoes/responsaveis");
  return { ok: true };
}
