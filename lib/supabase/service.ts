// Versão: 1.1 | Data: 23/07/2026
// Cliente Supabase com service role key — SÓ NO SERVIDOR.
// Bypassa RLS: use exclusivamente em rotas de sync/backfill e em operações
// administrativas server-side (ex.: criação de usuários). Nunca importe em
// código que chegue ao browser.
// v1.1: `server-only` faz o build FALHAR se este módulo for importado por um
//   Client Component — a service role key nunca pode chegar ao bundle do browser.
import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getSupabaseServiceRoleKey, getSupabaseUrl } from "@/lib/env";

export function createServiceClient() {
  return createSupabaseClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
