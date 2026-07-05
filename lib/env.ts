// Versão: 1.0 | Data: 04/07/2026
// Leitura e validação de variáveis de ambiente.
// Não há .env.local neste projeto: os valores vivem nas Environment Variables
// da Vercel e no painel do Supabase. Falhamos com mensagem clara quando uma
// variável obrigatória está ausente em runtime, para facilitar o diagnóstico
// nos previews da Vercel.

/**
 * Lê uma variável de ambiente obrigatória. Lança erro explícito se ausente.
 * A leitura é preguiçosa (chamada em runtime), nunca no topo de módulo, para
 * não quebrar o build quando o valor só existe no ambiente de execução.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

/** Variável opcional (retorna undefined quando ausente). */
export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

// --- Supabase (públicas, seguras no browser) ---
export const getSupabaseUrl = () => requireEnv("NEXT_PUBLIC_SUPABASE_URL");
export const getSupabaseAnonKey = () =>
  requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

// --- Supabase (privada, apenas servidor) ---
export const getSupabaseServiceRoleKey = () =>
  requireEnv("SUPABASE_SERVICE_ROLE_KEY");

// --- Integrações de sync (Fases 2 e 3; validadas quando usadas) ---
export const getBitrixWebhookUrl = () => requireEnv("BITRIX_WEBHOOK_URL");
export const getBitrixOutboundToken = () =>
  requireEnv("BITRIX_OUTBOUND_TOKEN");
export const getSyncSecret = () => requireEnv("SYNC_SECRET");
