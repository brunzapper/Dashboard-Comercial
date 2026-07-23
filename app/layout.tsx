// Versão: 1.2 | Data: 23/07/2026
// Layout raiz da aplicação.
// v1.2 (23/07/2026): título neutro (multi-org) — o layout autenticado
//   sobrescreve com o branding da org ativa (generateMetadata).
// v1.1 (04/07/2026): removido next/font/google (fetch em build) em favor de
//   uma pilha de fontes de sistema; metadados e idioma ajustados para pt-BR.
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dashboard Comercial",
  description:
    "Construtor de dashboards comerciais para gestão de leads e negócios.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
