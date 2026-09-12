// Versão: 1.0 | Data: 12/09/2026
// O validador do contrato "formulario-preencher". As duas regras que importam:
// campo de SELEÇÃO só aceita o catálogo vivo (senão a IA inventa uma Fonte e o
// CRM recusa o lead no fim da fila, longe da causa), e campo não mencionado é
// AUSÊNCIA, não erro — o formulário tem campos opcionais e a pessoa completa o
// que faltar na tela.
import { describe, expect, it } from "vitest";

import { FORM_FILL_FORMAT, FORM_FILL_VERSION, type FormFillContext } from "./types";
import { serializeFormFill, validateFormFill } from "./validate";

const CTX: FormFillContext = {
  schemaKey: "bitrix_lead_form",
  schemaLabel: "Formulário de criação Bitrix",
  fields: [
    { key: "empresa", label: "Empresa", type: "texto", required: true },
    { key: "email", label: "E-mail", type: "email", required: false },
    { key: "quando", label: "Data", type: "data", required: false },
    { key: "quanto", label: "Valor", type: "numero", required: false },
    {
      key: "fonte",
      label: "Fonte",
      type: "selecao",
      required: false,
      options: ["Indicação", "Site"],
    },
  ],
};

function payload(respostas: Record<string, unknown>, extra = {}): string {
  return JSON.stringify({
    formato: FORM_FILL_FORMAT,
    versao: FORM_FILL_VERSION,
    respostas,
    ...extra,
  });
}

describe("validateFormFill", () => {
  it("aceita as respostas e devolve o texto pronto para as caixas", () => {
    const v = validateFormFill(
      payload({ empresa: "ACME", email: "a@b.com", quanto: 1500 }),
      CTX
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.values).toEqual({
      empresa: "ACME",
      email: "a@b.com",
      quanto: "1500",
    });
  });

  it("seleção: só o catálogo vivo, e a grafia devolvida é a DELE", () => {
    const ok = validateFormFill(payload({ empresa: "ACME", fonte: "indicação" }), CTX);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.values.fonte).toBe("Indicação");

    const bad = validateFormFill(
      payload({ empresa: "ACME", fonte: "LinkedIn" }),
      CTX
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      // A mensagem volta para a IA no laço: tem de dizer o que existe.
      expect(bad.errors[0]).toContain("Indicação");
      expect(bad.errors[0]).toContain("Site");
    }
  });

  it("campo ausente/vazio é AUSÊNCIA, mesmo sendo obrigatório", () => {
    const v = validateFormFill(payload({ email: "a@b.com", fonte: "" }), CTX);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    // "empresa" é obrigatório e não veio: quem cobra é o envio do formulário,
    // não este validador — barrar aqui esconderia o resto do preenchimento.
    expect(v.values.empresa).toBeUndefined();
    expect("fonte" in v.values).toBe(false);
  });

  it("data tem de ser AAAA-MM-DD, e número tem de ser número", () => {
    const d = validateFormFill(payload({ empresa: "A", quando: "12/09/2026" }), CTX);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.errors[0]).toContain("AAAA-MM-DD");

    const n = validateFormFill(payload({ empresa: "A", quanto: "muito" }), CTX);
    expect(n.ok).toBe(false);
    if (!n.ok) expect(n.errors[0]).toContain("número");
  });

  it("chave fora do formulário é erro, com a lista do que é aceito", () => {
    const v = validateFormFill(payload({ empresa: "A", cargo: "CTO" }), CTX);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors[0]).toContain("cargo");
      expect(v.errors[0]).toContain("empresa");
    }
  });

  it("fail-closed: envelope errado, JSON inválido e resposta vazia", () => {
    expect(validateFormFill("não sou json", CTX).ok).toBe(false);
    expect(
      validateFormFill(
        JSON.stringify({ formato: "outro", versao: 1, respostas: { empresa: "A" } }),
        CTX
      ).ok
    ).toBe(false);
    expect(validateFormFill(payload({}), CTX).ok).toBe(false);
    // `respostas` como lista não é objeto de respostas.
    expect(
      validateFormFill(
        JSON.stringify({
          formato: FORM_FILL_FORMAT,
          versao: FORM_FILL_VERSION,
          respostas: [],
        }),
        CTX
      ).ok
    ).toBe(false);
  });

  it("valor composto não vira campo (a IA às vezes manda objeto)", () => {
    const v = validateFormFill(payload({ empresa: { nome: "ACME" } }), CTX);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors[0]).toContain("valor simples");
  });

  it("notas viram avisos para o usuário", () => {
    const v = validateFormFill(
      payload({ empresa: "ACME" }, { notas: ["O cargo ficou de fora.", ""] }),
      CTX
    );
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.warnings).toEqual(["O cargo ficou de fora."]);
  });

  it("round-trip: o que sai do serialize volta pelo validador", () => {
    const v = validateFormFill(
      serializeFormFill({ empresa: "ACME", fonte: "Site" }),
      CTX
    );
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.values).toEqual({ empresa: "ACME", fonte: "Site" });
  });
});
