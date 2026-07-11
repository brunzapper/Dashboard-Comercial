// Versão: 1.0 | Data: 11/07/2026
// Server Actions da tela de Usuários (admin): provisionamento de contas,
// atribuição de papéis, reset de senha, desativação/exclusão e mapeamento
// Bitrix (bitrix_user_map). Sem signup público — só quem tem
// manage_users_roles opera aqui.
//
// SEGURANÇA: criar/resetar/desativar/excluir usam a service role key
// (createServiceClient), que BYPASSA a RLS. O guard ensureManageUsers() é a
// única barreira nessas operações — por isso ele abre toda action.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo, type SessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

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

  if (role) {
    // RLS já permite (o caller tem manage_users_roles), mas usamos o client
    // autenticado para respeitar a política.
    const supabase = await createClient();
    await supabase
      .from("user_roles")
      .upsert(
        { user_id: data.user.id, role_key: role },
        { onConflict: "user_id,role_key" }
      );
  }

  revalidatePath("/admin/usuarios");
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

  revalidatePath("/admin/usuarios");
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

  const service = createServiceClient();
  const { error } = await service.auth.admin.updateUserById(userId, {
    password: newPassword,
  });
  if (error) return { error: "Não foi possível redefinir a senha." };

  revalidatePath("/admin/usuarios");
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

  const service = createServiceClient();
  const { error } = await service.auth.admin.updateUserById(userId, {
    ban_duration: disabled ? BAN_FOREVER : "none",
  });
  if (error) return { error: "Não foi possível atualizar o status do usuário." };

  revalidatePath("/admin/usuarios");
  return {};
}

/** Exclui permanentemente um usuário (cascata em user_roles via FK). */
export async function deleteUser(userId: string): Promise<ActionResult> {
  const session = await ensureManageUsers();
  if (!session) return { error: "Sem permissão." };

  if (userId === session.user.id) {
    return { error: "Você não pode excluir a própria conta." };
  }

  const service = createServiceClient();
  const { error } = await service.auth.admin.deleteUser(userId);
  if (error) return { error: "Não foi possível excluir o usuário." };

  revalidatePath("/admin/usuarios");
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

  revalidatePath("/admin/usuarios");
  return {};
}
