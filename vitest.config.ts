// Versão: 1.1 | Data: 24/07/2026
// v1.1 (24/07/2026): fase 2 dos testes — componentes/UI e engine com IO.
//   include ganha `.tsx` e `components/**` (sem isso testes de componente
//   seriam silenciosamente ignorados) e `tests/**` passa a cobrir também
//   `tests/live/` (paridade RPC EXECUTADA — pula sem env de banco).
//   setupFiles registra matchers do jest-dom e, SÓ em jsdom, os stubs de
//   Radix/cmdk + cleanup do RTL (tests/setup/dom.ts).
// Configuração do Vitest — testes unitários dos módulos PUROS (lib/**),
// componentes (components/**, opt-in jsdom por arquivo via pragma
// `// @vitest-environment jsdom` na PRIMEIRA linha) e guardas cross-cutting
// (tests/**). Ambiente default `node`. O alias `@` espelha o tsconfig
// (`@/*` → raiz do repo).
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    environment: "node",
    include: [
      "lib/**/*.test.{ts,tsx}",
      "components/**/*.test.{ts,tsx}",
      "tests/**/*.test.{ts,tsx}",
    ],
    setupFiles: ["tests/setup/dom.ts"],
    // Determinismo de fuso: period.ts materializa presets com Date LOCAL +
    // toISOString; num fuso positivo (ex.: CI em UTC+3) o dia recuaria.
    // Pinamos o fuso de produção-BR — mesma semântica do read side.
    env: { TZ: "America/Sao_Paulo" },
  },
});
