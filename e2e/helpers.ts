// Versão: 1.1 | Data: 30/07/2026
// Helper de login dos specs autenticados: dirige o FORMULÁRIO real (server
// action + cookies do @supabase/ssr validados por requisição) — mais robusto
// que fabricar cookies à mão. O usuário do seed pertence a UMA org e não é
// Owner, então o login cai direto em "/".
// v1.1: marca a sessão do app como JÁ ATIVA (sessionStorage) antes de navegar.
// Os specs compartilham o MESMO usuário do seed: um spec que visita um board
// grava user_settings.lastView (TrackLastView) e a Home de um teste posterior
// — contexto novo = "reabertura" — faria router.replace para esse board
// (RestoreLastView), quebrando asserções de URL/conteúdo conforme a ordem dos
// workers. A marca desliga SÓ a restauração (semântica de navegação interna);
// o fluxo de login continua o real.
import { expect, type Page } from "@playwright/test";

import { APP_SESSION_KEY } from "../lib/app-session";
import { E2E_USER } from "../tests/helpers/e2e-fixtures";

export async function login(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    try {
      sessionStorage.setItem(key, "1");
    } catch {
      // storage bloqueado: isFreshAppSession() já trata como sessão ativa.
    }
  }, APP_SESSION_KEY);
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_USER.email);
  await page.getByLabel("Senha").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
}
