// Versão: 1.0 | Data: 08/09/2026
// A resolução de refs é a única coisa entre o esquema (dado editável) e o
// payload que sai para um sistema externo. Estes testes fixam as três
// propriedades que importam: escopo fechado, nada de template cru vazando, e a
// diferença entre passo PULADO e passo INEXISTENTE.
import { describe, expect, it } from "vitest";

import { formRefsIn, resolveTemplate, resolvesEmpty } from "./refs";

const ctx = {
  form: { empresa: "Acme", email: "" },
  steps: { criar_empresa: { id: "42" }, pulado: { id: null } },
  ctx: { responsibleBitrixId: "7", vazio: null },
};

describe("resolveTemplate", () => {
  it("resolve as três raízes e mantém o texto literal", () => {
    expect(resolveTemplate("{{form.empresa}}", ctx).value).toBe("Acme");
    expect(resolveTemplate("{{steps.criar_empresa.id}}", ctx).value).toBe("42");
    expect(resolveTemplate("{{ctx.responsibleBitrixId}}", ctx).value).toBe("7");
    expect(resolveTemplate("Lead: {{form.empresa}} (novo)", ctx).value).toBe(
      "Lead: Acme (novo)"
    );
    // Template sem marcador é constante — é assim que um esquema fixa um valor.
    expect(resolveTemplate("NEW", ctx).value).toBe("NEW");
  });

  it("ref desconhecida vira VAZIO com aviso, nunca o texto cru", () => {
    const r = resolveTemplate("{{form.inexistente}}", ctx);
    expect(r.value).toBe("");
    expect(r.warnings).toHaveLength(1);
    // "{{form.telefone}}" chegando dentro do campo PHONE de um CRM é pior que
    // um telefone vazio — e esconde o erro.
    expect(r.value).not.toContain("{{");
  });

  it("passo PULADO resolve vazio SEM aviso; passo inexistente avisa", () => {
    const pulado = resolveTemplate("{{steps.pulado.id}}", ctx);
    expect(pulado.value).toBe("");
    expect(pulado.warnings).toHaveLength(0);

    const fantasma = resolveTemplate("{{steps.fantasma.id}}", ctx);
    expect(fantasma.value).toBe("");
    expect(fantasma.warnings).toHaveLength(1);
  });

  it("escopo é FECHADO: raiz desconhecida não alcança nada", () => {
    for (const t of [
      "{{process.env}}",
      "{{globalThis.x}}",
      "{{window.location}}",
    ]) {
      const r = resolveTemplate(t, ctx);
      expect(r.value).toBe("");
      expect(r.warnings).toHaveLength(1);
    }
  });

  it("dentro de `steps` só `<id>.id` existe", () => {
    // Caminho mais fundo seria passeio por propriedade arbitrária da saída.
    expect(resolveTemplate("{{steps.criar_empresa.id.length}}", ctx).warnings)
      .toHaveLength(1);
  });

  it("valor nulo do contexto resolve vazio", () => {
    expect(resolveTemplate("{{ctx.vazio}}", ctx).value).toBe("");
  });
});

describe("resolvesEmpty", () => {
  it("distingue insumo presente de ausente (gate de skipIfEmpty)", () => {
    expect(resolvesEmpty("{{form.empresa}}", ctx)).toBe(false);
    expect(resolvesEmpty("{{form.email}}", ctx)).toBe(true);
    expect(resolvesEmpty("   ", ctx)).toBe(true);
  });
});

describe("formRefsIn", () => {
  it("lista as chaves de formulário citadas", () => {
    expect(
      formRefsIn("{{form.a}} e {{form.b}} com {{steps.x.id}}")
    ).toEqual(["a", "b"]);
  });
});
