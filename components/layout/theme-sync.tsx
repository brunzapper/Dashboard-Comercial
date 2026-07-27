// Versão: 1.0 | Data: 27/07/2026
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
  type ResolvedTheme,
} from "@/lib/theme";

const YEAR = 60 * 60 * 24 * 365;

const syncScript = (mode: string, accent: string) => `(function(){
  var m = ${JSON.stringify(mode)};
  var a = ${JSON.stringify(accent)};
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var dark = m === 'dark' || (m === 'system' && mq.matches);
  var el = document.documentElement;
  el.classList.toggle('dark', dark);
  if (a === ${JSON.stringify(DEFAULT_ACCENT)}) el.style.removeProperty('--brand-base');
  else el.style.setProperty('--brand-base', a);
  document.cookie = ${JSON.stringify(THEME_COOKIE)} + '=' + m + '; path=/; max-age=${YEAR}; samesite=lax';
  document.cookie = ${JSON.stringify(ACCENT_COOKIE)} + '=' + encodeURIComponent(a) + '; path=/; max-age=${YEAR}; samesite=lax';
})();`;

export async function ThemeSync({ resolved }: { resolved: ResolvedTheme }) {
  const store = await cookies();
  const cookieMode = store.get(THEME_COOKIE)?.value ?? null;
  const cookieAccent = store.get(ACCENT_COOKIE)?.value ?? null;
  if (cookieMode === resolved.mode && cookieAccent === resolved.accent) {
    return null;
  }
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: syncScript(resolved.mode, resolved.accent),
      }}
    />
  );
}
