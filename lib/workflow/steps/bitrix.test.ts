// Versão: 1.0 | Data: 08/09/2026
// Detalhes do passo do Bitrix que o teste do executor não isola: a separação
// do nome, a degradação do crm_status sem mapa e o link de exibição.
import { describe, expect, it } from "vitest";

import { bitrixEntityUrl, splitPersonName } from "./bitrix";
import { toBitrixValue } from "@/lib/sync/bitrix/writeback";

describe("splitPersonName", () => {
  it("separa primeiro nome e sobrenome", () => {
    expect(splitPersonName("Maria Silva Souza")).toEqual({
      first: "Maria",
      last: "Silva Souza",
    });
  });

  it("nome de uma palavra fica sem sobrenome (não inventa)", () => {
    expect(splitPersonName("Madonna")).toEqual({ first: "Madonna", last: "" });
  });

  it("tolera espaços extras e string vazia", () => {
    expect(splitPersonName("  Ana   Paula  ")).toEqual({
      first: "Ana",
      last: "Paula",
    });
    expect(splitPersonName("")).toEqual({ first: "", last: "" });
  });
});

describe("toBitrixValue — crm_status (v1.1)", () => {
  const meta = {
    fieldId: "SOURCE_ID",
    title: "Fonte",
    type: "crm_status",
    isMultiple: false,
    isReadOnly: false,
  };
  const codes = { sources: { "CEO-Led Outbound": "UC_EN7PZM" } };

  it("converte rótulo para código", () => {
    expect(toBitrixValue(meta, "CEO-Led Outbound", codes)).toBe("UC_EN7PZM");
  });

  it("valor que JÁ é código passa direto (esquema que fixou o código)", () => {
    expect(toBitrixValue(meta, "UC_EN7PZM", codes)).toBe("UC_EN7PZM");
  });

  it("rótulo inexistente é fatal — melhor recusar que gravar lixo", () => {
    expect(() => toBitrixValue(meta, "Não existe", codes)).toThrow();
  });

  it("SEM o mapa degrada como na v1.0 (nenhum call site antigo muda)", () => {
    expect(toBitrixValue(meta, "CEO-Led Outbound")).toBe("CEO-Led Outbound");
  });

  it("cada família tem o próprio mapa (o código NEW colide entre elas)", () => {
    const statusMeta = { ...meta, fieldId: "STATUS_ID", title: "Etapa" };
    const both = {
      sources: { Site: "UC_AAA" },
      leadStatuses: { "Novos Leads": "NEW" },
    };
    expect(toBitrixValue(statusMeta, "Novos Leads", both)).toBe("NEW");
    // O rótulo de etapa não pode ser encontrado no mapa de origens.
    expect(() => toBitrixValue(meta, "Novos Leads", both)).toThrow();
  });
});

describe("bitrixEntityUrl", () => {
  it("deriva a URL do portal a partir da base do webhook", () => {
    expect(
      bitrixEntityUrl("https://portal.bitrix24.com.br/rest/89/tok/", "lead", "42")
    ).toBe("https://portal.bitrix24.com.br/crm/lead/details/42/");
  });

  it("sem id ou sem host devolve vazio (nunca um link quebrado)", () => {
    expect(bitrixEntityUrl("https://p.bitrix24.com.br/rest/1/t/", "lead", "")).toBe("");
    expect(bitrixEntityUrl("nao-e-url", "lead", "42")).toBe("");
  });
});
