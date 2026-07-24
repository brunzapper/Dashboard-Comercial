// Versão: 1.0 | Data: 24/07/2026
// Helper de login dos specs autenticados: dirige o FORMULÁRIO real (server
// action + cookies do @supabase/ssr validados por requisição) — mais robusto
// que fabricar cookies à mão. O usuário do seed pertence a UMA org e não é
// Owner, então o login cai direto em "/".
import { expect, type Page } from "@playwright/test";

import { E2E_USER } from "../tests/helpers/e2e-fixtures";

export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_USER.email);
  await page.getByLabel("Senha").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
}
