// Versão: 1.0 | Data: 09/09/2026
// Server Actions dos atributos de registro (0131).
//
// Duas operações e uma distinção que é o coração do pedido:
//  - PAUSAR mantém a participação (o registro segue com o atributo, a árvore
//    segue existindo, a automação apenas para de produzir);
//  - REMOVER tira o registro da funcionalidade.
// São ações diferentes de propósito — "pausar" que apaga é o que faz alguém
// perder o histórico por engano.
//
// O gate é a RLS da 0131 (admin/gestor OU o responsável do registro): nada de
// service role aqui. Escrita otimista em background na UI, então as actions
// aceitam `{ revalidate: false }` (padrão §4.10).
"use server";

import { revalidatePath } from "next/cache";

import { getActiveOrgId } from "@/lib/auth/org";
import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

import type { AttributeStatus } from "./registry";

export interface AttributeActionState {
  ok?: boolean;
  message?: string;
}

/**
 * Liga/pausa a participação. NÃO remove: o registro continua com o atributo e
 * com todo o histórico — é o "desativar sem excluir" que o pedido descreve.
 */
export async function setRecordAttributeStatus(
  attributeId: string,
  status: AttributeStatus,
  opts: { revalidate?: boolean } = {}
): Promise<AttributeActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("record_attributes")
    .update({ status })
    .eq("id", attributeId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, message: `Falha ao salvar: ${error.message}` };
  if (!data) {
    // A RLS recusou (nem admin, nem responsável) — a linha existe, o usuário
    // é que não a governa. Dizer isso é melhor que "não encontrado".
    return {
      ok: false,
      message: "Você não pode alterar este acompanhamento — fale com um administrador.",
    };
  }

  if (opts.revalidate !== false) revalidatePath("/registros");
  return {
    ok: true,
    message: status === "pausado" ? "Acompanhamento pausado." : "Acompanhamento retomado.",
  };
}

/**
 * Concede o atributo à mão (o caminho normal é a automação conceder). Ensure:
 * conceder de novo NÃO reativa um atributo pausado — pausar é uma decisão de
 * quem opera, e a rodada seguinte da automação a desfaria em silêncio.
 */
export async function grantRecordAttribute(
  recordId: string,
  attributeKey: string,
  opts: { revalidate?: boolean } = {}
): Promise<AttributeActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, message: "Organização ativa não identificada." };

  const supabase = await createClient();
  const { error } = await supabase.from("record_attributes").upsert(
    {
      organization_id: orgId,
      record_id: recordId,
      attribute_key: attributeKey,
      created_by: session.user.id,
    },
    { onConflict: "record_id,attribute_key", ignoreDuplicates: true }
  );
  if (error) return { ok: false, message: `Falha ao conceder: ${error.message}` };

  if (opts.revalidate !== false) revalidatePath("/registros");
  return { ok: true };
}

/** Remove a participação (some com o atributo). Não é o mesmo que pausar. */
export async function removeRecordAttribute(
  attributeId: string,
  opts: { revalidate?: boolean } = {}
): Promise<AttributeActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("record_attributes")
    .delete()
    .eq("id", attributeId);
  if (error) return { ok: false, message: `Falha ao remover: ${error.message}` };

  if (opts.revalidate !== false) revalidatePath("/registros");
  return { ok: true, message: "Atributo removido." };
}
