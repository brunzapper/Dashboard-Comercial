// Versão: 1.0 | Data: 24/07/2026
// Smoke do viewer PÚBLICO de snapshot (/s/[token], sem auth — proxy libera
// /s/*): o snapshot congelado pelo seed renderiza nome + widgets; token
// malformado ou inexistente respondem 404 UNIFORME (sem vazar existência).
import { expect, test } from "@playwright/test";

import {
  SNAPSHOT_NAME,
  SNAPSHOT_TOKEN,
  WIDGET_KPI_TITLE,
} from "../tests/helpers/e2e-fixtures";

test("token válido renderiza o snapshot congelado sem login", async ({
  page,
}) => {
  await page.goto(`/s/${SNAPSHOT_TOKEN}`);
  await expect(page.getByText(SNAPSHOT_NAME).first()).toBeVisible();
  await expect(page.getByText(WIDGET_KPI_TITLE)).toBeVisible();
});

test("token inexistente (shape válido) → 404", async ({ page }) => {
  const ghost = SNAPSHOT_TOKEN.slice(0, -5) + "ZZZZZ";
  const res = await page.goto(`/s/${ghost}`);
  expect(res?.status()).toBe(404);
});

test("token malformado → 404 sem tocar o banco", async ({ page }) => {
  const res = await page.goto("/s/curto");
  expect(res?.status()).toBe(404);
});
