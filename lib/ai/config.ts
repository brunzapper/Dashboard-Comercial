// Versão: 1.0 | Data: 23/07/2026
// Carregamento da config de IA POR ORGANIZAÇÃO (tabela ai_provider_config,
// 0096). SÓ NO SERVIDOR (service role + decifra a chave). Dois níveis:
//   loadOrgAiConfigPublic → provider/model/hasKey (NUNCA o ciphertext nem a
//     chave); seguro para RSC/telas (Home, Configurações).
//   loadOrgAiConfig       → inclui a chave DECIFRADA; use APENAS na action de
//     geração, no momento de chamar o provedor.
// O ciphertext jamais é retornado ao cliente; a chave-mestra é KEY_ENCRYPTION_KEY.
import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { decryptSecret } from "@/lib/crypto/secretbox";
import { isAiProvider } from "./models";
import type { AiProvider } from "./types";

export interface OrgAiConfigPublic {
  provider: AiProvider;
  model: string;
  hasKey: boolean;
}

export interface OrgAiConfig extends OrgAiConfigPublic {
  /** Chave decifrada — nunca sai do servidor. */
  apiKey: string;
}

interface ConfigRow {
  provider: string;
  model: string;
  api_key_ciphertext: string | null;
}

async function loadRow(orgId: string): Promise<ConfigRow | null> {
  const db = createServiceClient();
  const { data } = await db
    .from("ai_provider_config")
    .select("provider, model, api_key_ciphertext")
    .eq("organization_id", orgId)
    .maybeSingle();
  return (data as ConfigRow | null) ?? null;
}

/** Metadados públicos (sem segredo). null = não configurado para a org. */
export async function loadOrgAiConfigPublic(
  orgId: string | null
): Promise<OrgAiConfigPublic | null> {
  if (!orgId) return null;
  const row = await loadRow(orgId);
  if (!row || !isAiProvider(row.provider)) return null;
  return {
    provider: row.provider,
    model: row.model,
    hasKey: Boolean(row.api_key_ciphertext),
  };
}

/** Config completa com a chave decifrada. null = ausente/sem chave/corrompida. */
export async function loadOrgAiConfig(
  orgId: string | null
): Promise<OrgAiConfig | null> {
  if (!orgId) return null;
  const row = await loadRow(orgId);
  if (!row || !isAiProvider(row.provider) || !row.api_key_ciphertext) return null;
  let apiKey: string;
  try {
    apiKey = decryptSecret(row.api_key_ciphertext);
  } catch {
    // Formato inválido ou KEY_ENCRYPTION_KEY trocada: trata como não configurado.
    return null;
  }
  return {
    provider: row.provider,
    model: row.model,
    hasKey: true,
    apiKey,
  };
}
