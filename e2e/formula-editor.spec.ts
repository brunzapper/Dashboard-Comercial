// Versão: 1.0 | Data: 30/07/2026
// Guard REAL da regressão do dropdown de sugestões do editor de fórmulas
// dentro do Sheet modal: o portal manual da v2.0 do FormulaTextView herdava o
// `pointer-events: none` que o Radix Dialog aplica no body — a lista pintava,
// mas não recebia clique nem wheel. jsdom não faz hit-testing, então SÓ o
// Playwright pega essa classe de bug (click/hover esperam o elemento RECEBER
// pointer events). Interação 100% client-state (sem fetch) — compatível com o
// CSP local que bloqueia chamadas client-side (playwright.config.ts).
import { expect, test } from "@playwright/test";

import { login } from "./helpers";

test("sugestões do editor de fórmulas aceitam clique e rolagem no Sheet", async ({
  page,
}) => {
  await login(page);
  await page.goto("/campos");

  // Abre o FieldForm (Sheet modal) e escolhe o tipo calculado por registro.
  await page.getByRole("button", { name: "Novo campo" }).click();
  await page.getByRole("combobox", { name: "Tipo" }).click();
  await page
    .getByRole("option", { name: "Calculado (por registro)" })
    .click();

  // `[` abre a lista de colunas (client-side puro, sem fetch).
  const formula = page.getByRole("textbox", { name: "Fórmula (texto)" });
  await formula.click();
  await formula.pressSequentially("[");

  const listbox = page.getByRole("listbox", { name: "Sugestões de coluna" });
  await expect(listbox).toBeVisible();

  // hover() já exige hit-testing — na regressão, estoura timeout aqui.
  await listbox.hover();
  // Wheel rola a PRÓPRIA lista (o RemoveScroll do Sheet não pode engolir o
  // evento). Só asserta quando o catálogo transborda o max-h da lista.
  const scrollable = await listbox.evaluate(
    (el) => el.scrollHeight > el.clientHeight
  );
  if (scrollable) {
    await page.mouse.wheel(0, 200);
    await expect
      .poll(() => listbox.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    await listbox.evaluate((el) => el.scrollTo({ top: 0 }));
  }

  // Clique com o MOUSE insere o operando (onMouseDown vence o blur).
  await page
    .locator('[role="option"][aria-disabled="false"]')
    .first()
    .click();
  await expect(formula).toHaveValue(/\[.+\]/);

  // Escape fecha SÓ a lista; o Sheet do formulário continua aberto.
  await formula.pressSequentially("[");
  await expect(listbox).toBeVisible();
  await formula.press("Escape");
  await expect(listbox).not.toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Fórmula (texto)" })
  ).toBeVisible();
});
