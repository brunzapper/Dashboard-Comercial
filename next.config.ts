import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Tree-shaking do barrel unificado `radix-ui` (usado por components/ui/*):
    // sem isso o import nomeado puxa o pacote inteiro para o bundle/dev-server.
    // lucide-react e recharts já são otimizados por padrão pelo Next
    // (lista embutida — ver docs de optimizePackageImports).
    optimizePackageImports: ["radix-ui"],
  },
};

export default nextConfig;
