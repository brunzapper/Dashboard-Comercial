// Versão: 1.0 | Data: 04/07/2026
// Cliente Supabase para uso no browser (Client Components).
import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";

export function createClient() {
  return createBrowserClient(getSupabaseUrl(), getSupabaseAnonKey());
}
