// Versão: 1.0 | Data: 29/07/2026
// Toaster global (sonner) — canal de feedback para ações FORA de formulário
// (drag do grid, menus ⋮, auto-saves). O feedback inline por componente segue
// sendo o padrão dentro de forms (docs/arquitetura.md §4.10). Montado só no
// layout autenticado (app) — o viewer público /s/[token] e o login ficam fora.
// Tema: o app aplica `.dark` no <html> via script inline (app/layout.tsx) e o
// ThemeSync pode trocá-la em runtime (modo "system") — por isso lemos a classe
// com MutationObserver em vez de depender de next-themes (não usado aqui).
"use client";

import { useSyncExternalStore } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

function readTheme(): "light" | "dark" {
  return document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
}

function subscribeToThemeClass(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function Toaster(props: ToasterProps) {
  // A classe `.dark` do <html> é o "external store" do tema (script inline +
  // ThemeSync); useSyncExternalStore acompanha trocas em runtime sem efeito.
  const theme = useSyncExternalStore(
    subscribeToThemeClass,
    readTheme,
    () => "light" as const
  );

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
