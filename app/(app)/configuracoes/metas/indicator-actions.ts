// Versão: 1.1 | Data: 02/10/2026
// v1.1 (02/10/2026): `moveIndicator` — a ORDEM dos indicadores (sort_order)
//   ganhou controle na tela (antes só o preset a definia).
// Server Actions do catálogo de INDICADORES (0149) — admin.
//
// Gate: sessão + papel admin + área `metas` não negada (mesma régua das
// actions de goals). A RLS de `indicators` (escrita admin da org) é a muralha;
// a org é CARIMBADA explicitamente (sem ela, usuário de outra org falharia
// ALTO no WITH CHECK — nunca vaza linha para a org padrão).
// A chave é IMUTÁVEL depois de criada: é a de goals.metric e dos refs `meta:`
// gravados em fórmulas; renomear o RÓTULO nunca move a chave.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { isSettingsAreaDenied } from "@/lib/auth/access";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import {
  validateIndicatorSave,
  type IndicatorInput,
} from "@/lib/indicators/validate";

export interface IndicatorActionState {
  ok: boolean;
  message?: string;
  id?: string;
}

async function ensureAdmin(): Promise<string | null> {
  const s = await getSessionInfo();
  if (!s) return "Sessão expirada.";
  if (!s.roles.includes("admin")) return "Apenas administradores.";
  if (await isSettingsAreaDenied("metas")) return "Acesso a esta área foi bloqueado.";
  return null;
}

export async function saveIndicator(
  id: string | null,
  input: IndicatorInput
): Promise<IndicatorActionState> {
  const err = await ensureAdmin();
  if (err) return { ok: false, message: err };
  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, message: "Organização ativa não encontrada." };
  const v = await validateIndicatorSave(supabase, orgId, input);
  if (!v.ok) return v;

  if (id) {
    // A chave não muda na edição (o update nunca a envia).
    const { key: _key, ...rest } = v.row;
    void _key;
    const { error } = await supabase
      .from("indicators")
      .update(rest)
      .eq("id", id)
      .eq("organization_id", orgId);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/configuracoes/metas");
    return { ok: true, id, message: "Indicador salvo." };
  }
  const session = await getSessionInfo();
  const { data, error } = await supabase
    .from("indicators")
    .insert({ ...v.row, organization_id: orgId, created_by: session?.user.id ?? null })
    .select("id")
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      message: error.code === "23505" ? `Já existe um indicador com a chave "${v.row.key}".` : error.message,
    };
  }
  revalidatePath("/configuracoes/metas");
  return { ok: true, id: (data?.id as string) ?? undefined, message: "Indicador criado." };
}

/**
 * Excluir o indicador NÃO apaga as metas (linhas de `goals` com a mesma
 * chave): a meta é dado operacional e segue valendo para `meta:`/goalLine —
 * só o realizado/unidade deixam de existir.
 */
export async function deleteIndicator(id: string): Promise<IndicatorActionState> {
  const err = await ensureAdmin();
  if (err) return { ok: false, message: err };
  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  let q = supabase.from("indicators").delete().eq("id", id);
  if (orgId) q = q.eq("organization_id", orgId);
  const { error } = await q;
  if (error) return { ok: false, message: error.message };
  revalidatePath("/configuracoes/metas");
  return { ok: true };
}

/**
 * v1.1: sobe/desce um indicador na lista (troca o sort_order com o vizinho).
 * A ordem é a da lista de Indicadores e dos seletores da Tree/Tabela Livre.
 */
export async function moveIndicator(
  id: string,
  dir: "up" | "down"
): Promise<IndicatorActionState> {
  const err = await ensureAdmin();
  if (err) return { ok: false, message: err };
  const supabase = await createClient();
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, message: "Organização ativa não encontrada." };
  const { data, error } = await supabase
    .from("indicators")
    .select("id, sort_order, label")
    .eq("organization_id", orgId)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  if (error || !data) return { ok: false, message: error?.message ?? "Falha ao ler." };
  const list = data as { id: string; sort_order: number }[];
  const i = list.findIndex((r) => r.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return { ok: true };
  // Ordens repetidas (preset/import) viram uma sequência limpa antes da troca.
  const order = list.map((r) => r.id);
  [order[i], order[j]] = [order[j], order[i]];
  for (const [k, rid] of order.entries()) {
    const want = (k + 1) * 10;
    if (list.find((r) => r.id === rid)?.sort_order === want) continue;
    const { error: e } = await supabase
      .from("indicators")
      .update({ sort_order: want })
      .eq("id", rid)
      .eq("organization_id", orgId);
    if (e) return { ok: false, message: e.message };
  }
  revalidatePath("/configuracoes/metas");
  return { ok: true };
}
