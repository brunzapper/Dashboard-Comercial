// Versão: 1.1 | Data: 17/07/2026
// Cliente Supabase para uso no servidor (Server Components, Route Handlers,
// Server Actions). Usa a anon key + cookies da sessão, respeitando RLS.
// Next.js 16: cookies() é assíncrono (Async Request APIs).
// v1.1 (17/07/2026): React cache() — 1 cliente por request/render. Além de
//   poupar a construção, faz os loaders cache()d que recebem o client como
//   argumento (ex.: loadSources) deduplicarem entre layout e página — antes
//   cada um criava um client novo e o cache (keyed por argumento) nunca batia.
import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";

export const createClient = cache(async function createClient() {
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
});
