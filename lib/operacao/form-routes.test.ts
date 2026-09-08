// Versão: 1.0 | Data: 08/09/2026
// O que este teste protege: a rota do formulário não pode colidir com uma
// sub-área do produto, e o módulo precisa continuar PURO — ele é importado por
// um componente client, e uma importação server-only aqui quebra o build (foi
// o que aconteceu na primeira versão, que puxava de cards.ts).
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  FORM_CARD_KEY_PREFIX,
  FORM_CARD_PREFIX,
  formSchemaHref,
} from "./form-routes";

describe("rotas de formulário", () => {
  it("monta a URL sob o prefixo próprio", () => {
    expect(formSchemaHref("bitrix_lead_form")).toBe(
      "/operacao/f/bitrix_lead_form"
    );
    expect(FORM_CARD_PREFIX).toBe("/operacao/f");
    expect(FORM_CARD_KEY_PREFIX).toBe("form:");
  });

  it("nunca cai em cima de uma sub-área existente", () => {
    // Sem o prefixo, um formulário com a chave de um módulo o sequestraria.
    for (const key of ["agenda", "tarefas", "remuneracao", "workflow"]) {
      expect(formSchemaHref(key)).not.toBe(`/operacao/${key}`);
      expect(formSchemaHref(key).startsWith(`${FORM_CARD_PREFIX}/`)).toBe(true);
    }
  });

  it("é PURO: nenhuma importação (o manager é client)", () => {
    const src = readFileSync(
      path.resolve(__dirname, "form-routes.ts"),
      "utf-8"
    );
    // Qualquer import aqui arrisca arrastar server-only para o bundle do
    // browser — o motivo de este arquivo existir separado de cards.ts.
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});
