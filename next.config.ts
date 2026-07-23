import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Tree-shaking do barrel unificado `radix-ui` (usado por components/ui/*):
    // sem isso o import nomeado puxa o pacote inteiro para o bundle/dev-server.
    // lucide-react e recharts já são otimizados por padrão pelo Next
    // (lista embutida — ver docs de optimizePackageImports).
    optimizePackageImports: ["radix-ui"],
  },
  // O prompt "completo" do Importar dashboard (IA) lê o manual de construção
  // do disco em runtime (import-prompt-actions) — inclui o .md no trace do
  // deploy (sem isso a função serverless da Vercel não empacota o arquivo).
  outputFileTracingIncludes: {
    "/": ["./docs/manual-de-construcao-de-dashboards.md"],
  },
};

export default nextConfig;
