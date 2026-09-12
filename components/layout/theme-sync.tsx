// Versão: 1.1 | Data: 12/09/2026
// v1.1 (12/09/2026): reconcilia também os TOKENS DE TEMA (0141). O cookie
//   theme_tokens é comparado como TEXTO com o JSON dos efetivos — é o mesmo
//   texto que a action grava, então a comparação é estável. O script aplica as
//   variáveis do modo vigente e REMOVE as do outro (uma cor definida só no
//   claro não pode sobreviver à troca para o escuro). Os dois mapas já passam
//   por themeTokenStyle: nome da whitelist, valor #RRGGBB.
// Reconciliação tema × cookies (server component, layout autenticado).
// Os cookies theme_mode/theme_accent guardam os valores EFETIVOS para o root
// layout aplicar sem banco. Num dispositivo novo (sem cookie) ou quando o
// padrão da org mudou, este componente emite um script inline que aplica a
// classe .dark + --brand-base na hora (um paint possivelmente "errado" antes
// dele, só nesse primeiro load) e grava os cookies — a próxima request já sai
// 100% correta do SSR. Cookies em dia ⇒ não renderiza nada.
// Valores chegam RESOLVIDOS (resolveTheme) — já passaram pelas whitelists.
import { cookies } from "next/headers";

import {
  ACCENT_COOKIE,
  DEFAULT_ACCENT,
  THEME_COOKIE,
  TOKENS_COOKIE,
  hasThemeTokens,
  themeTokenStyle,
  type ResolvedTheme,
  type ThemeTokens,
} from "@/lib/theme";

const YEAR = 60 * 60 * 24 * 365;

const syncScript = (
  mode: string,
  accent: string,
  tokensCookie: string | null,
  light: Record<string, string>,
  dark: Record<string, string>
) => `(function(){
  var m = ${JSON.stringify(mode)};
  var a = ${JSON.stringify(accent)};
  var vars = { light: ${JSON.stringify(light)}, dark: ${JSON.stringify(dark)} };
  var tc = ${JSON.stringify(tokensCookie)};
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var isDark = m === 'dark' || (m === 'system' && mq.matches);
  var el = document.documentElement;
  el.classList.toggle('dark', isDark);
  if (a === ${JSON.stringify(DEFAULT_ACCENT)}) el.style.removeProperty('--brand-base');
  else el.style.setProperty('--brand-base', a);
  var on = isDark ? vars.dark : vars.light;
  var off = isDark ? vars.light : vars.dark;
  for (var k in off) if (!(k in on)) el.style.removeProperty(k);
  for (var k2 in on) el.style.setProperty(k2, on[k2]);
  document.cookie = ${JSON.stringify(THEME_COOKIE)} + '=' + m + '; path=/; max-age=${YEAR}; samesite=lax';
  document.cookie = ${JSON.stringify(ACCENT_COOKIE)} + '=' + encodeURIComponent(a) + '; path=/; max-age=${YEAR}; samesite=lax';
  if (tc === null) {
    document.cookie = ${JSON.stringify(TOKENS_COOKIE)} + '=; path=/; max-age=0; samesite=lax';
  } else {
    document.cookie = ${JSON.stringify(TOKENS_COOKIE)} + '=' + encodeURIComponent(tc) + '; path=/; max-age=${YEAR}; samesite=lax';
  }
})();`;

export async function ThemeSync({
  resolved,
  tokens,
}: {
  resolved: ResolvedTheme;
  /** Tokens EFETIVOS (usuário ?? org), já resolvidos pelo layout. */
  tokens: ThemeTokens;
}) {
  const store = await cookies();
  const cookieMode = store.get(THEME_COOKIE)?.value ?? null;
  const cookieAccent = store.get(ACCENT_COOKIE)?.value ?? null;
  const cookieTokens = store.get(TOKENS_COOKIE)?.value ?? null;
  const wanted = hasThemeTokens(tokens) ? JSON.stringify(tokens) : null;
  if (
    cookieMode === resolved.mode &&
    cookieAccent === resolved.accent &&
    cookieTokens === wanted
  ) {
    return null;
  }
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: syncScript(
          resolved.mode,
          resolved.accent,
          wanted,
          themeTokenStyle(tokens.light),
          themeTokenStyle(tokens.dark)
        ),
      }}
    />
  );
}
