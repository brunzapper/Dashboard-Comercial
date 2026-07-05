// Versão: 1.0 | Data: 04/07/2026
// Cliente Supabase com service role key — SÓ NO SERVIDOR.
// Bypassa RLS: use exclusivamente em rotas de sync/backfill e em operações
// administrativas server-side (ex.: criação de usuários). Nunca importe em
// código que chegue ao browser.
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
