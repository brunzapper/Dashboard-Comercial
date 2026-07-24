// Versão: 1.0 | Data: 24/07/2026
// Smoke de autenticação: gate do proxy (redirect com redirectTo), mensagem
// exata de credencial inválida (actions.ts) e o caminho feliz até a Home com
// o board semeado.
import { expect, test } from "@playwright/test";

import { DASHBOARD_NAME, E2E_USER } from "../tests/helpers/e2e-fixtures";
import { login } from "./helpers";

test("rota autenticada sem sessão redireciona ao login com redirectTo", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?redirectTo=/);
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
});

test("credencial inválida exibe a mensagem exata do servidor", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_USER.email);
  await page.getByLabel("Senha").fill("senha-errada");
  await page.getByRole("button", { name: "Entrar" }).click();
  // getByText (e não getByRole("alert")): o Next injeta um
  // __next-route-announcer__ com role="alert" em toda página, e o strict mode
  // do Playwright acusaria dois elementos. A mensagem EXATA segue asserida.
  await expect(page.getByText("Email ou senha inválidos.")).toBeVisible();
});

test("login válido entra na Home com o board semeado visível", async ({
  page,
}) => {
  await login(page);
  await expect(page.getByText(DASHBOARD_NAME)).toBeVisible();
});
