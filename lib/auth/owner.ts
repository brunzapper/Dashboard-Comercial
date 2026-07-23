// Versão: 1.0 | Data: 23/07/2026
// Guard do modo OWNER (multi-org, 0089): o fluxo /owner é EXCLUSIVO do dono
// do sistema e "impossível de forçar" — três barreiras server-side, todas
// FAIL-CLOSED:
//   1. env OWNER_USER_ID precisa existir E ser igual ao uid logado (env
//      ausente ⇒ nega SEMPRE — nunca degrada para "qualquer um");
//   2. linha em app_owner (tabela imutável por app — trigger da 0089 bloqueia
//      qualquer escrita, até via service role, sem o GUC de SQL direto);
//   3. requireOwner() roda em TODA page/action do grupo (owner)/ — nunca
//      confie só no layout.
// Nenhuma tela cria/altera o Owner; o cadastro é exclusivamente via banco
// (seed da 0089 ou SQL direto com o GUC).
import { cache } from "react";
import { redirect } from "next/navigation";

import { getOwnerUserId } from "@/lib/env";
import { getSessionInfo, type SessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/** O usuário logado é o Owner? (fail-closed; nunca lança) */
export const getIsOwner = cache(async function getIsOwner(): Promise<boolean> {
  const session = await getSessionInfo();
  if (!session) return false;
  const allowedId = getOwnerUserId();
  if (!allowedId || allowedId !== session.user.id) return false;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("app_owner")
      .select("user_id")
      .eq("user_id", session.user.id)
      .maybeSingle();
    return Boolean(data);
  } catch {
    return false;
  }
});

/** Exige o Owner; qualquer outra conta é redirecionada para a home. */
export async function requireOwner(): Promise<SessionInfo> {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!(await getIsOwner())) redirect("/");
  return session;
}
