// Versão: 1.0 | Data: 24/07/2026
// Configuração do Vitest — testes unitários dos módulos PUROS (lib/**) e
// guardas cross-cutting (tests/**, ex.: paridade das RPCs de widget). Ambiente
// `node` puro: nada de jsdom/componentes nesta camada; os alvos não importam
// Supabase/server-only (ver docs/manual-de-manutencao.md, "Como rodar os
// testes"). O alias `@` espelha o tsconfig (`@/*` → raiz do repo).
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "tests/**/*.test.ts"],
    // Determinismo de fuso: period.ts materializa presets com Date LOCAL +
    // toISOString; num fuso positivo (ex.: CI em UTC+3) o dia recuaria.
    // Pinamos o fuso de produção-BR — mesma semântica do read side.
    env: { TZ: "America/Sao_Paulo" },
  },
});
