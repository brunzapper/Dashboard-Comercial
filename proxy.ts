// Versão: 1.1 | Data: 17/07/2026
// Proxy (Next.js 16 — antigo "middleware"). Atualiza a sessão do Supabase a
// cada request e redireciona usuários não autenticados para /login.
// Runtime: nodejs (padrão do proxy no Next 16).
// v1.1 (17/07/2026): /api/* e /s/* saem ANTES do getUser() — essas rotas cuidam
//   da própria autenticação (segredos/token de snapshot) e getUser() é uma ida
//   de REDE ao servidor de auth por request. /login segue validando (o
//   redirect de usuário já logado depende do user).
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";

// Rotas públicas (sem exigir sessão). As rotas de API cuidam da própria
// autenticação (tokens/segredos), então também não passam pelo redirect.
// "/s" é o viewer público de snapshots (/s/<token>): a página valida o token
// (hash) sozinha, via service role — o anon key segue sem acesso a nada.
const PUBLIC_PATHS = ["/login", "/s"];

function isPublic(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return true;
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Rotas de API: autenticação própria (tokens/segredos) — sem sessão a validar.
  if (pathname.startsWith("/api/")) {
    return NextResponse.next({ request });
  }

  // Viewer público de snapshots: valida o token sozinho (service role). O token
  // está na URL — nunca vazar por Referer nem entrar em índice de busca.
  if (pathname === "/s" || pathname.startsWith("/s/")) {
    const publicResponse = NextResponse.next({ request });
    publicResponse.headers.set("Referrer-Policy", "no-referrer");
    publicResponse.headers.set("X-Robots-Tag", "noindex, nofollow");
    return publicResponse;
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    getSupabaseUrl(),
    getSupabaseAnonKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANTE: getUser() revalida a sessão e dispara o setAll acima quando o
  // token é renovado. Não coloque lógica entre createServerClient e getUser.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Usuário autenticado tentando acessar /login: manda para a home.
  if (user && pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Roda em tudo, exceto arquivos estáticos e otimização de imagem.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
