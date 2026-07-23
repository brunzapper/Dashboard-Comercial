// Versão: 1.2 | Data: 23/07/2026
// Server Actions da tela de Usuários (admin): provisionamento de contas,
// atribuição de papéis, reset de senha, desativação/exclusão e mapeamento
// Bitrix (bitrix_user_map). Sem signup público — só quem tem
// manage_users_roles opera aqui.
// v1.2 (23/07/2026): multi-org (0089/0092) — conta nova entra como membro da
//   org ATIVA; conceder/remover o papel `admin` exige Administrador de
//   Organização (RLS 0092 é o backstop); org_admin/Owner não podem ser
//   desativados nem excluídos (triggers/FK da 0089 são o backstop).
// v1.1 (12/07/2026): setBitrixMapping também grava responsibles.user_id — fonte
//   da verdade da visibilidade (RLS de records segue o vínculo vivo responsável).
//
// SEGURANÇA: criar/resetar/desativar/excluir usam a service role key
// (createServiceClient), que BYPASSA a RLS. O guard ensureManageUsers() é a
// única barreira nessas operações — por isso ele abre toda action.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo, type SessionInfo } from "@/lib/auth/session";
import { getActiveOrg } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Alvo protegido? (org_admin de alguma org, ou o Owner do sistema.) Consultas
// via service role — as memberships de outros usuários não são visíveis pela
// RLS. Os triggers/FK da 0089 são a barreira definitiva; aqui é a mensagem
// amigável.
async function protectedUserReason(userId: string): Promise<string | null> {
  const service = createServiceClient();
  const [{ data: owner }, { data: adminRows }] = await Promise.all([
    service.from("app_owner").select("user_id").eq("user_id", userId).maybeSingle(),
    service
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userId)
      .eq("is_org_admin", true)
      .limit(1),
  ]);
  if (owner) return "Esta conta é o Owner do sistema e não pode ser alterada.";
  if (adminRows && adminRows.length > 0) {
    return "Esta conta é Administrador de Organização e não pode ser removida/desativada.";
  }
  return null;
}

// ISOLAMENTO multi-org (0089/0090): reset de senha / desativar / excluir usam a
// service role (bypassa RLS) sobre um userId arbitrário. O alvo PRECISA ser
// membro da org ATIVA do caller — sem esta trava, um admin de uma org agiria
// sobre contas de outra. Consulta via service role (as memberships de outros
// usuários não são visíveis pela RLS do caller). Sem org ativa (single-tenant
// pré-0089) mantém o comportamento antigo.
async function targetInActiveOrg(userId: string): Promise<boolean> {
  const org = await getActiveOrg();
  if (!org) return true;
  const service = createServiceClient();
  const { data } = await service
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", org.id)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

export interface ActionResult {
  error?: string;
  success?: string;
}

/**
 * Exige a permissão manage_users_roles. Retorna a sessão quando autorizado, ou
 * null caso contrário (as actions abortam com uma mensagem quando é null).
 */
async function ensureManageUsers(): Promise<SessionInfo | null> {
  const session = await getSessionInfo();
  if (!session || !session.permissions.includes("manage_users_roles")) {
    return null;
  }
  return session;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;
// Duração usada como "desativado" — ~100 anos de ban (soft-disable do Supabase).
const BAN_FOREVER = "876000h";

/** Cria um usuário (email + senha definidos pelo admin) e, opcionalmente, já
 *  atribui um papel inicial. Usado com useActionState. */
export async function createUser(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await ensureManageUsers();
  if (!session) return { error: "Sem permissão para gerenciar usuários." };

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "").trim();

  if (!EMAIL_RE.test(email)) {
    return { error: "Informe um email válido." };
  }
  if (password.length < MIN_PASSWORD) {
    return { error: `A senha precisa ter ao menos ${MIN_PASSWORD} caracteres.` };
  }

  const service = createServiceClient();
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error || !data.user) {
    const msg = error?.message ?? "";
    if (/already|registered|exists/i.test(msg)) {
      return { error: "Já existe um usuário com esse email." };
    }
    return { error: "Não foi possível criar o usuário." };
  }

  // Membership na org ATIVA (multi-org, 0089): sem ela o usuário novo não
  // enxerga NADA (RLS org-scoped). Via service role — escrita de
  // organization_members não tem policy authenticated de propósito.
  const org = await getActiveOrg();
  if (org) {
    const { error: memberErr } = await service
      .from("organization_members")
      .upsert(
        { organization_id: org.id, user_id: data.user.id },
        { onConflict: "organization_id,user_id" }
      );
    if (memberErr) {
      return {
        error: `Usuário criado, mas falhou o vínculo com a organização: ${memberErr.message}`,
      };
    }
  }

  if (role) {
    // RLS já permite (o caller tem manage_users_roles), mas usamos o client
    // autenticado para respeitar a política. Papel `admin` na criação exige
    // Administrador de Organização (0092) — o insert falharia na RLS; aqui a
    // mensagem amigável.
    if (role === "admin" && !org?.isOrgAdmin) {
      return {
        error:
          "Usuário criado, mas só o Administrador de Organização concede o papel Administrador.",
      };
    }
    const supabase = await createClient();
    await supabase
      .from("user_roles")
      .upsert(
        { user_id: data.user.id, role_key: role },
        { onConflict: "user_id,role_key" }
      );
  }

  revalidatePath("/configuracoes/usuarios");
  return { success: `Usuário ${email} criado.` };
}

/** Atribui (enabled) ou remove (não enabled) um papel de um usuário. */
export async function setUserRole(
  userId: string,
  roleKey: string,
  enabled: boolean
): Promise<ActionResult> {
  const session = await ensureManageUsers();
  if (!session) return { error: "Sem permissão." };

  // Trava anti-lockout: não deixa o próprio admin remover o próprio papel admin.
  if (!enabled && roleKey === "admin" && userId === session.user.id) {
    return { error: "Você não pode remover seu próprio papel de administrador." };
  }

  // Papel `admin` (Administrador comum) só é concedido/removido pelo
  // Administrador de Organização (0092 — RLS é o backstop).
  if (roleKey === "admin") {
    const org = await getActiveOrg();
    if (!org?.isOrgAdmin) {
      return {
        error:
          "Só o Administrador de Organização concede ou remove o papel Administrador.",
      };
    }
  }

  const supabase = await createClient();
  if (enabled) {
    const { error } = await supabase
      .from("user_roles")
      .upsert(
        { user_id: userId, role_key: roleKey },
        { onConflict: "user_id,role_key" }
      );
    if (error) return { error: "Não foi possível atribuir o papel." };
  } else {
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role_key", roleKey);
    if (error) return { error: "Não foi possível remover o papel." };
  }

  revalidatePath("/configuracoes/usuarios");
  return {};
}

/** Define uma nova senha para um usuário (o admin comunica ao usuário). */
export async function resetUserPassword(
  userId: string,
  newPassword: string
): Promise<ActionResult> {
  const session = await ensureManageUsers();
  if (!session) return { error: "Sem permissão." };

  if (newPassword.length < MIN_PASSWORD) {
    return { error: `A senha precisa ter ao menos ${MIN_PASSWORD} caracteres.` };
  }
  if (!(await targetInActiveOrg(userId))) {
    return { error: "Usuário não pertence à sua organização." };
  }

  const service = createServiceClient();
  const { error } = await service.auth.admin.updateUserById(userId, {
    password: newPassword,
  });
  if (error) return { error: "Não foi possível redefinir a senha." };

  revalidatePath("/configuracoes/usuarios");
  return { success: "Senha redefinida." };
}

/** Desativa (ban) ou reativa um usuário. Login é recusado enquanto desativado. */
export async function setUserDisabled(
  userId: string,
  disabled: boolean
): Promise<ActionResult> {
  const session = await ensureManageUsers();
  if (!session) return { error: "Sem permissão." };

  if (disabled && userId === session.user.id) {
    return { error: "Você não pode desativar a própria conta." };
  }
  if (!(await targetInActiveOrg(userId))) {
    return { error: "Usuário não pertence à sua organização." };
  }
  if (disabled) {
    const reason = await protectedUserReason(userId);
    if (reason) return { error: reason };
  }

  const service = createServiceClient();
  const { error } = await service.auth.admin.updateUserById(userId, {
    ban_duration: disabled ? BAN_FOREVER : "none",
  });
  if (error) return { error: "Não foi possível atualizar o status do usuário." };

  revalidatePath("/configuracoes/usuarios");
  return {};
}

/** Exclui permanentemente um usuário (cascata em user_roles via FK). */
export async function deleteUser(userId: string): Promise<ActionResult> {
  const session = await ensureManageUsers();
  if (!session) return { error: "Sem permissão." };

  if (userId === session.user.id) {
    return { error: "Você não pode excluir a própria conta." };
  }
  if (!(await targetInActiveOrg(userId))) {
    return { error: "Usuário não pertence à sua organização." };
  }
  // org_admin/Owner: o trigger da 0089 (cascade da membership) e a FK de
  // app_owner derrubariam o delete de qualquer forma — mensagem amigável.
  const reason = await protectedUserReason(userId);
  if (reason) return { error: reason };

  const service = createServiceClient();
  const { error } = await service.auth.admin.deleteUser(userId);
  if (error) return { error: "Não foi possível excluir o usuário." };

  revalidatePath("/configuracoes/usuarios");
  return {};
}

/** Vincula (ou desvincula, com userId vazio) um ID de usuário do Bitrix a um
 *  usuário do Supabase, alimentando bitrix_user_map (dono de registro/RLS). */
export async function setBitrixMapping(
  bitrixId: string,
  userId: string,
  name: string
): Promise<ActionResult> {
  const session = await ensureManageUsers();
  if (!session) return { error: "Sem permissão." };
  if (!bitrixId) return { error: "Bitrix ID ausente." };

  const supabase = await createClient();
  const { error } = await supabase.from("bitrix_user_map").upsert(
    {
      bitrix_id: bitrixId,
      user_id: userId || null,
      name: name || null,
    },
    { onConflict: "bitrix_id" }
  );
  if (error) return { error: "Não foi possível salvar o mapeamento." };

  // Fonte da verdade da visibilidade: responsibles.user_id. A RLS de `records`
  // segue o vínculo VIVO record.responsible_id -> responsibles.user_id, então o
  // vínculo do Bitrix precisa refletir aqui. Grava via service role porque
  // responsibles_write exige 'admin' (a permissão manage_users_roles já foi
  // conferida em ensureManageUsers). Casa pelo bitrix_user_id do responsável.
  const service = createServiceClient();
  const { error: respErr } = await service
    .from("responsibles")
    .update({ user_id: userId || null })
    .eq("bitrix_user_id", bitrixId);
  if (respErr) return { error: "Não foi possível salvar o vínculo do responsável." };

  revalidatePath("/configuracoes/usuarios");
  return {};
}
