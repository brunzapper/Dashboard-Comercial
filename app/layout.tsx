// Versão: 1.3 | Data: 27/07/2026
// Layout raiz da aplicação.
// v1.3 (27/07/2026): tema (claro/escuro/sistema) + cor de destaque via
//   cookies (lib/theme.ts). O accent entra como --brand-base no style do
//   <html> (precisa estar no <html>: portais Radix montam em document.body);
//   o modo aplica a classe .dark num script inline ANTES do paint (sem FOUC),
//   que ignora /s/* (viewer público de snapshot fica sempre claro — cores
//   congeladas foram escolhidas no claro). Valores de cookie passam SEMPRE
//   pelas whitelists de lib/theme.ts antes de irem a style/script (XSS).
//   suppressHydrationWarning: o server não renderiza a classe .dark (não
//   conhece o pathname p/ excluir /s/*) — o script a aplica no cliente.
// v1.2 (23/07/2026): título neutro (multi-org) — o layout autenticado
//   sobrescreve com o branding da org ativa (generateMetadata).
// v1.1 (04/07/2026): removido next/font/google (fetch em build) em favor de
//   uma pilha de fontes de sistema; metadados e idioma ajustados para pt-BR.
import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { cookies } from "next/headers";

import {
  ACCENT_COOKIE,
  DEFAULT_ACCENT,
  THEME_COOKIE,
  normalizeHexColor,
  normalizeThemeMode,
} from "@/lib/theme";

import "./globals.css";

export const metadata: Metadata = {
  title: "Dashboard Comercial",
  description:
    "Construtor de dashboards comerciais para gestão de leads e negócios.",
};

// Aplica o modo salvo antes do primeiro paint. `MODE` é interpolado APÓS a
// whitelist (só "light" | "dark" | "system" chegam aqui).
const themeInitScript = (mode: string) => `(function(){
  if (location.pathname.indexOf('/s/') === 0) return;
  var m = ${JSON.stringify(mode)};
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var apply = function(){
    var dark = m === 'dark' || (m === 'system' && mq.matches);
    document.documentElement.classList.toggle('dark', dark);
  };
  apply();
  if (m === 'system') mq.addEventListener('change', apply);
})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const store = await cookies();
  const mode = normalizeThemeMode(store.get(THEME_COOKIE)?.value) ?? "light";
  const accent = normalizeHexColor(store.get(ACCENT_COOKIE)?.value);
  const htmlStyle =
    accent && accent !== DEFAULT_ACCENT
      ? ({ "--brand-base": accent } as CSSProperties)
      : undefined;

  return (
    <html
      lang="pt-BR"
      className="h-full antialiased"
      style={htmlStyle}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeInitScript(mode) }}
        />
      </head>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
