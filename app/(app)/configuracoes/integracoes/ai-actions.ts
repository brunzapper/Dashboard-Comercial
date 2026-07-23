// Versão: 1.0 | Data: 23/07/2026
// Server Actions da config de IA por organização (Configurações → Integrações,
// admin): provedor + modelo + chave de API para a geração DIRETA de dashboards.
// Padrão de segredo idêntico ao dos webhooks: a chave é CIFRADA (AES-GCM) antes
// de persistir e NUNCA volta em claro ao cliente; escrita via service client
// (a tabela 0096 não tem policy de escrita), carimbando organization_id.
"use server";

import { revalidatePath } from "next/cache";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createServiceClient } from "@/lib/supabase/service";
import { encryptSecret } from "@/lib/crypto/secretbox";
import { isAiProvider } from "@/lib/ai/models";

export interface AiConfigActionState {
  ok?: boolean;
  message?: string;
}

async function ensureAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; message: string }
> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.roles.includes("admin")) {
    return { ok: false, message: "Apenas administradores." };
  }
  return { ok: true, userId: session.user.id };
}

export async function saveAiProviderConfig(input: {
  provider: string;
  model: string;
  apiKey?: string;
}): Promise<AiConfigActionState> {
  const auth = await ensureAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };

  const provider = input.provider;
  if (!isAiProvider(provider)) {
    return { ok: false, message: "Provedor inválido." };
  }
  const model = String(input.model ?? "").trim();
  if (!model) return { ok: false, message: "Informe o modelo." };
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";

  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, message: "Organização ativa não encontrada." };

  const db = createServiceClient();

  // 1ª configuração exige a chave; edições posteriores podem só trocar
  // provedor/modelo (a chave existente é preservada — não a reenviamos).
  const { data: existing } = await db
    .from("ai_provider_config")
    .select("api_key_ciphertext")
    .eq("organization_id", orgId)
    .maybeSingle();
  const hasKey = Boolean(
    (existing as { api_key_ciphertext?: string | null } | null)?.api_key_ciphertext
  );
  if (!apiKey && !hasKey) {
    return { ok: false, message: "Informe a chave de API do provedor." };
  }

  const row: Record<string, unknown> = {
    organization_id: orgId,
    provider,
    model,
    updated_by: auth.userId,
  };
  if (apiKey) row.api_key_ciphertext = encryptSecret(apiKey);

  const { error } = await db
    .from("ai_provider_config")
    .upsert(row, { onConflict: "organization_id" });
  if (error) {
    return { ok: false, message: `Falha ao salvar a configuração: ${error.message}` };
  }

  revalidatePath("/configuracoes/integracoes");
  revalidatePath("/");
  return { ok: true, message: "Configuração de IA salva." };
}

export async function clearAiProviderConfig(): Promise<AiConfigActionState> {
  const auth = await ensureAdmin();
  if (!auth.ok) return { ok: false, message: auth.message };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, message: "Organização ativa não encontrada." };

  const db = createServiceClient();
  const { error } = await db
    .from("ai_provider_config")
    .delete()
    .eq("organization_id", orgId);
  if (error) {
    return { ok: false, message: `Falha ao remover a configuração: ${error.message}` };
  }

  revalidatePath("/configuracoes/integracoes");
  revalidatePath("/");
  return { ok: true, message: "Configuração de IA removida." };
}
