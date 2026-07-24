// Versão: 1.0 | Data: 24/07/2026
// Smoke do dashboard autenticado: os widgets semeados renderizam no servidor
// com os dados determinísticos do seed (títulos + valores da tabela por
// pipeline). Asserções SSR-only (CSP local bloqueia fetch client-side).
import { expect, test } from "@playwright/test";

import {
  DASHBOARD_ID,
  EXPECTED,
  WIDGET_KPI_TITLE,
  WIDGET_TABLE_TITLE,
} from "../tests/helpers/e2e-fixtures";
import { login } from "./helpers";

test("widgets do board renderizam com os dados do seed", async ({ page }) => {
  await login(page);
  await page.goto(`/dashboards/${DASHBOARD_ID}`);

  await expect(page.getByText(WIDGET_KPI_TITLE)).toBeVisible();
  await expect(page.getByText(WIDGET_TABLE_TITLE)).toBeVisible();
  // Tabela por pipeline: os dois grupos semeados aparecem.
  for (const pipeline of EXPECTED.pipelines) {
    await expect(page.getByText(pipeline).first()).toBeVisible();
  }
  // Σ valor dos negócios (6.500 formatado pt-BR aparece no KPI).
  await expect(page.getByText(/6\.500/).first()).toBeVisible();
});
