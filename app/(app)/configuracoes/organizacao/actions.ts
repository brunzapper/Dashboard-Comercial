// Versão: 1.0 | Data: 23/07/2026
// Server Actions da aba Configurações → Organização (multi-org, 0089): o
// Administrador de Organização edita o BRANDING exibido no sidebar/título —
// nome do sistema (app_name, ex.: "Dashboard Comercial") e nome da empresa
// (name, ex.: "Zapper"). A RLS organizations_update (só org_admin) é a
// barreira definitiva.
"use server";

import { revalidatePath } from "next/cache";

import { getActiveOrg } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";

export interface OrgBrandingState {
  ok?: boolean;
  message?: string;
}

export async function saveOrgBranding(
  _prev: OrgBrandingState,
  formData: FormData
): Promise<OrgBrandingState> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, message: "Organização não encontrada." };
  if (!org.isOrgAdmin) {
    return { ok: false, message: "Apenas o Administrador de Organização." };
  }

  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const appName = String(formData.get("app_name") ?? "").trim().slice(0, 80);
  if (!name) return { ok: false, message: "Informe o nome da empresa." };
  if (!appName) return { ok: false, message: "Informe o nome do sistema." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ name, app_name: appName })
    .eq("id", org.id);
  if (error) return { ok: false, message: error.message };
  // Branding entra pelo layout raiz autenticado → revalida o app inteiro.
  revalidatePath("/", "layout");
  return { ok: true, message: "Branding salvo." };
}
