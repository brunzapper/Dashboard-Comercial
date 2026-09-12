// Versão: 1.4 | Data: 12/09/2026
// v1.4 (12/09/2026): TOKENS DE TEMA (0141) — além de --brand-base, um conjunto
//   curado de superfícies (fundo, texto, cartão, silenciado, borda e as três
//   da barra lateral) pode ser recolorido, com valores próprios para claro e
//   escuro. Em modo claro/escuro EXPLÍCITO as variáveis já saem no style do
//   <html> renderizado no servidor (sem FOUC); em "sistema" quem as aplica é o
//   mesmo script inline que decide a classe .dark, e ele reaplica quando o SO
//   troca. Os dois mapas passam por themeTokenStyle ANTES de virar JSON: o que
//   chega ao script já é nome de token da whitelist com valor #RRGGBB.
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
  TOKENS_COOKIE,
  normalizeHexColor,
  normalizeThemeMode,
  normalizeThemeTokens,
  themeTokenStyle,
} from "@/lib/theme";

import "./globals.css";

export const metadata: Metadata = {
  title: "Dashboard Comercial",
  description:
    "Construtor de dashboards comerciais para gestão de leads e negócios.",
};

// Aplica o modo salvo (e as cores do modo) antes do primeiro paint. `MODE` é
// interpolado APÓS a whitelist (só "light" | "dark" | "system" chegam aqui), e
// os dois mapas de token já passaram por themeTokenStyle — nome de propriedade
// da whitelist, valor #RRGGBB. Nada cru de cookie chega a este script.
const themeInitScript = (
  mode: string,
  light: Record<string, string>,
  dark: Record<string, string>
) => `(function(){
  if (location.pathname.indexOf('/s/') === 0) return;
  var m = ${JSON.stringify(mode)};
  var vars = { light: ${JSON.stringify(light)}, dark: ${JSON.stringify(dark)} };
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var el = document.documentElement;
  var apply = function(){
    var isDark = m === 'dark' || (m === 'system' && mq.matches);
    el.classList.toggle('dark', isDark);
    var on = isDark ? vars.dark : vars.light;
    var off = isDark ? vars.light : vars.dark;
    // Limpa o que era do OUTRO modo antes de aplicar este: sem isso, uma cor
    // definida só no claro sobreviveria à troca para o escuro.
    for (var k in off) if (!(k in on)) el.style.removeProperty(k);
    for (var k2 in on) el.style.setProperty(k2, on[k2]);
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
  const tokens = normalizeThemeTokens(store.get(TOKENS_COOKIE)?.value);
  const lightVars = themeTokenStyle(tokens.light);
  const darkVars = themeTokenStyle(tokens.dark);
  // Em modo explícito o servidor já sabe qual conjunto vale e o emite no HTML
  // (sem FOUC). Em "sistema" só o cliente sabe — quem aplica é o script.
  const modeVars =
    mode === "dark" ? darkVars : mode === "light" ? lightVars : {};
  const styleEntries: Record<string, string> = { ...modeVars };
  if (accent && accent !== DEFAULT_ACCENT) styleEntries["--brand-base"] = accent;
  const htmlStyle =
    Object.keys(styleEntries).length > 0
      ? (styleEntries as CSSProperties)
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
          dangerouslySetInnerHTML={{
            __html: themeInitScript(mode, lightVars, darkVars),
          }}
        />
      </head>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
