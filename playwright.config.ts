// Versão: 1.0 | Data: 24/07/2026
// Config do Playwright (E2E) — testDir FORA do include do Vitest. Pressupõe o
// stack Supabase local de pé + seed aplicado + `npm run build` já feito com as
// NEXT_PUBLIC_* no env (inline no bundle); o webServer só dá `next start`.
// Asserções dos specs dependem SÓ de conteúdo SSR: o CSP do next.config.ts
// (connect-src *.supabase.co) bloqueia chamadas client-side ao 127.0.0.1 — por
// design, não afrouxar o CSP por causa de teste.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
