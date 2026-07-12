// Versão: 1.0 | Data: 12/07/2026
// Configurações → Conta: o próprio usuário troca a sua senha. Vale para qualquer
// papel (admin/gestor/vendedor). Diferente do reset da tela de Usuários (que usa
// a service role para OUTROS usuários), aqui usamos o client autenticado: o
// Supabase só deixa `updateUser({ password })` mexer no dono da sessão. Exigimos
// a senha ATUAL e a revalidamos com signInWithPassword antes de aplicar.
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export interface ChangePasswordState {
  error?: string;
  success?: string;
}

const MIN_PASSWORD = 6;

export async function changeOwnPassword(
  _prevState: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const session = await getSessionInfo();
  if (!session) return { error: "Sessão expirada. Entre novamente." };

  const email = session.user.email;
  if (!email) return { error: "Sua conta não tem email para revalidar a senha." };

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!currentPassword || !newPassword) {
    return { error: "Preencha a senha atual e a nova senha." };
  }
  if (newPassword.length < MIN_PASSWORD) {
    return { error: `A nova senha precisa ter ao menos ${MIN_PASSWORD} caracteres.` };
  }
  if (newPassword !== confirmPassword) {
    return { error: "A confirmação não bate com a nova senha." };
  }
  if (newPassword === currentPassword) {
    return { error: "A nova senha precisa ser diferente da atual." };
  }

  const supabase = await createClient();

  // Revalida a senha atual (mesmo usuário; só reconfirma a sessão).
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (signInError) {
    return { error: "Senha atual incorreta." };
  }

  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword,
  });
  if (updateError) {
    return { error: "Não foi possível alterar a senha. Tente novamente." };
  }

  return { success: "Senha alterada com sucesso." };
}
