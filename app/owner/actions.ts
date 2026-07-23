// Versão: 1.0 | Data: 23/07/2026
// Server Actions do console do OWNER (multi-org, 0089/0093): criar e excluir
// organizações. TODA action abre com requireOwner() (guard fail-closed —
// lib/auth/owner.ts); as escritas usam service role (organization_members não
// tem policy de escrita) e as funções SQL de provisionamento (EXECUTE só
// service role). Ao criar, o Owner define o Administrador de Organização: ele
// mesmo ou uma conta NOVA (email/senha) — a org nasce VAZIA (só as core defs
// de seed_org_defaults; nada da Zapper).
"use server";

import { revalidatePath } from "next/cache";

import { requireOwner } from "@/lib/auth/owner";
import { createServiceClient } from "@/lib/supabase/service";

export interface OwnerActionState {
  ok?: boolean;
  message?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;

export async function createOrganizationAction(
  _prev: OwnerActionState,
  formData: FormData
): Promise<OwnerActionState> {
  const session = await requireOwner();

  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return { ok: false, message: "Informe o nome da organização." };
  const adminMode = String(formData.get("admin_mode") ?? "self");

  const service = createServiceClient();

  // Administrador de Organização: o próprio Owner ou uma conta nova.
  let adminUserId = session.user.id;
  if (adminMode === "new") {
    const email = String(formData.get("admin_email") ?? "")
      .trim()
      .toLowerCase();
    const password = String(formData.get("admin_password") ?? "");
    if (!EMAIL_RE.test(email)) {
      return { ok: false, message: "Informe um email válido para o administrador." };
    }
    if (password.length < MIN_PASSWORD) {
      return {
        ok: false,
        message: `A senha do administrador precisa ter ao menos ${MIN_PASSWORD} caracteres.`,
      };
    }
    const { data: created, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !created.user) {
      const msg = error?.message ?? "";
      return {
        ok: false,
        message: /already|registered|exists/i.test(msg)
          ? "Já existe um usuário com esse email."
          : "Não foi possível criar o administrador.",
      };
    }
    adminUserId = created.user.id;
  }

  const { data: org, error: orgErr } = await service
    .from("organizations")
    .insert({ name })
    .select("id")
    .single();
  if (orgErr || !org) {
    return { ok: false, message: orgErr?.message ?? "Falha ao criar a organização." };
  }
  const orgId = org.id as string;

  // Membership do admin (única com is_org_admin — índice parcial da 0089).
  const { error: memberErr } = await service
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: adminUserId, is_org_admin: true });
  if (memberErr) {
    return {
      ok: false,
      message: `Organização criada, mas falhou o vínculo do administrador: ${memberErr.message}`,
    };
  }

  // Papel de app "admin" (Administrador comum) para o admin gerir a org nova.
  await service
    .from("user_roles")
    .upsert(
      { user_id: adminUserId, role_key: "admin" },
      { onConflict: "user_id,role_key" }
    );

  // Infra inicial (core defs por org) — função SECURITY DEFINER, service role.
  const { error: seedErr } = await service.rpc("seed_org_defaults", {
    p_org: orgId,
  });
  if (seedErr) {
    return {
      ok: false,
      message: `Organização criada, mas o seed inicial falhou: ${seedErr.message}`,
    };
  }

  revalidatePath("/owner");
  return { ok: true, message: `Organização "${name}" criada.` };
}

export async function deleteOrganizationAction(
  orgId: string,
  confirmName: string
): Promise<OwnerActionState> {
  await requireOwner();
  if (!orgId) return { ok: false, message: "Organização inválida." };

  const service = createServiceClient();
  const { data: org } = await service
    .from("organizations")
    .select("id, name")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) return { ok: false, message: "Organização não encontrada." };
  if (String(confirmName ?? "").trim() !== (org.name as string)) {
    return {
      ok: false,
      message: "Digite o nome exato da organização para confirmar.",
    };
  }

  // delete_organization (0093): liga o GUC e cascateia TUDO da org. A org
  // inicial (Zapper) é recusada pela própria função.
  const { error } = await service.rpc("delete_organization", { p_org: orgId });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/owner");
  return { ok: true, message: `Organização "${org.name}" excluída.` };
}
