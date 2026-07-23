// Versão: 1.1 | Data: 23/07/2026
// Server Actions de autenticação. Login por email/senha; sem signup público.
// v1.1 (23/07/2026): multi-org (0089) — pós-login: usuário comum (1 org) tem
//   o cookie da org gravado e entra direto; multi-org ou Owner vai à tela
//   /escolher-organizacao. Logout limpa o cookie da org.
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getMemberships, ORG_COOKIE } from "@/lib/auth/org";
import { getIsOwner } from "@/lib/auth/owner";

export interface LoginState {
  error?: string;
}

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirectTo") ?? "/") || "/";

  if (!email || !password) {
    return { error: "Informe email e senha." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Email ou senha inválidos." };
  }

  // Só redireciona para caminhos internos (evita open redirect).
  const safeRedirect = redirectTo.startsWith("/") ? redirectTo : "/";

  // Multi-org (0089): Owner ou membro de 2+ orgs escolhe o contexto; usuário
  // comum entra direto (cookie da única org — redundante, mas deixa o estado
  // explícito). Pré-migração (sem memberships) segue o fluxo antigo.
  const [memberships, isOwner] = await Promise.all([
    getMemberships(),
    getIsOwner(),
  ]);
  if (isOwner || memberships.length > 1) {
    redirect("/escolher-organizacao");
  }
  if (memberships.length === 1) {
    const cookieStore = await cookies();
    cookieStore.set(ORG_COOKIE, memberships[0].organization_id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  redirect(safeRedirect);
}

export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete(ORG_COOKIE);
  redirect("/login");
}
