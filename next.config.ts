import type { NextConfig } from "next";

// ===================== Headers de segurança =====================
// Aplicados a TODAS as rotas (defesa em profundidade). O cookie de auth do
// @supabase/ssr é legível por JS (design da lib), então CSP + anti-frame são a
// linha de frente contra XSS/clickjacking.
//
// CSP: script-src/style-src mantêm 'unsafe-inline' porque o Next injeta o
// bootstrap inline e o app usa estilos inline (Tailwind/estado) sem infra de
// nonce; 'unsafe-eval' só em dev (React Fast Refresh). connect-src libera o
// Supabase (REST + Realtime wss). Tightening do script-src exige nonce via
// middleware — anotado no runbook de segurança (docs/seguranca.md).
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-src 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

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
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
