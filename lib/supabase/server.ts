// Versão: 1.0 | Data: 04/07/2026
// Cliente Supabase para uso no servidor (Server Components, Route Handlers,
// Server Actions). Usa a anon key + cookies da sessão, respeitando RLS.
// Next.js 16: cookies() é assíncrono (Async Request APIs).
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Chamado a partir de um Server Component: a escrita de cookies pode
          // ser ignorada com segurança quando há um proxy (proxy.ts) atualizando
          // a sessão a cada request.
        }
      },
    },
  });
}
