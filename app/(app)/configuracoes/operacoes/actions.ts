// Versão: 1.3 | Data: 31/07/2026
// Server Actions da tela de Operações (admin). Suporta aninhamento
// (parent_operation_id). RLS de operations exige papel admin para escrever.
// v1.3 (31/07/2026): sanitização do perfil extraída para o módulo puro
// lib/config/operation-profile.ts (compartilhada com o assistente de IA de
// operações); createOperation devolve o `id` criado (o apply do assistente
// precisa dele p/ perfil/vínculos de operação recém-criada).
// v1.2 (26/07/2026): updateOperation detecta ciclo INDIRETO de pai (A→B→A)
// subindo os ancestrais do novo pai — antes só bloqueava pai = ele mesmo.
// v1.1 (20/07/2026): updateOperationFilter — FILTROS DE PERFIL da operação
// (operations.filter, 0083; WidgetFilter[] com `sources` opcional por
// condição), consumidos pelo filtro de Operação da visualização
// (lib/config/operation-scope.ts).
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { isSettingsAreaDenied } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { sanitizeProfileFilters } from "@/lib/config/operation-profile";
import { createClient } from "@/lib/supabase/server";
import type { WidgetFilter } from "@/lib/widgets/types";

export interface OpState {
  ok?: boolean;
  message?: string;
  // Preenchido pelo createOperation (o apply do assistente de IA usa o id da
  // operação recém-criada para perfil/vínculos no mesmo lote).
  id?: string;
}

async function ensureAdmin(): Promise<string | null> {
  const s = await getSessionInfo();
  if (!s) return "Sessão expirada.";
  if (!s.roles.includes("admin")) return "Apenas administradores.";
  if (await isSettingsAreaDenied("operacoes")) return "Acesso a esta área foi bloqueado.";
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
  const { data: created, error } = await supabase
    .from("operations")
    .insert({
      name,
      parent_operation_id: parent,
      // Carimbo de org (multi-org, 0090).
      ...(orgId ? { organization_id: orgId } : {}),
    })
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  revalidatePath("/configuracoes/operacoes");
  return {
    ok: true,
    message: `Operação "${name}" criada.`,
    id: (created as { id?: string } | null)?.id,
  };
}

export async function updateOperation(
  id: string,
  patch: { name?: string; active?: boolean; parent_operation_id?: string | null }
): Promise<OpState> {
  const err = await ensureAdmin();
  if (err) return { ok: false, message: err };
  if (patch.parent_operation_id === id) {
    return { ok: false, message: "Uma operação não pode ser pai dela mesma." };
  }
  const supabase = await createClient();
  // Ciclo indireto (A→B→…→A): subir os ancestrais do novo pai; alcançar `id`
  // deixaria a árvore inconsistente (operation_subtree sobrevive por usar
  // UNION, mas o roll-up/metas ficariam errados).
  if (patch.parent_operation_id) {
    const { data } = await supabase
      .from("operations")
      .select("id, parent_operation_id");
    const parentById = new Map(
      (data ?? []).map((o) => [
        o.id as string,
        (o.parent_operation_id as string | null) ?? null,
      ])
    );
    const seen = new Set<string>();
    let cur: string | null = patch.parent_operation_id;
    while (cur && !seen.has(cur)) {
      if (cur === id) {
        return {
          ok: false,
          message: "Esse pai criaria um ciclo na árvore de operações.",
        };
      }
      seen.add(cur);
      cur = parentById.get(cur) ?? null;
    }
  }
  const { error } = await supabase
    .from("operations")
    .update(patch)
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/configuracoes/operacoes");
  return { ok: true };
}

export async function deleteOperation(id: string): Promise<OpState> {
  const err = await ensureAdmin();
  if (err) return { ok: false, message: err };
  const supabase = await createClient();
  const { error } = await supabase.from("operations").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/configuracoes/operacoes");
  return { ok: true };
}

export async function updateOperationFilter(
  id: string,
  filter: WidgetFilter[]
): Promise<OpState> {
  const err = await ensureAdmin();
  if (err) return { ok: false, message: err };
  // Vocabulário/sanitização vivem no módulo puro compartilhado com o
  // assistente de IA de operações (lib/config/operation-profile.ts).
  const sanitized = sanitizeProfileFilters(filter);
  if (!sanitized.ok) return { ok: false, message: sanitized.message };
  const supabase = await createClient();
  const { error } = await supabase
    .from("operations")
    .update({ filter: sanitized.clean })
    .eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/configuracoes/operacoes");
  return { ok: true, message: "Perfil da operação salvo." };
}
