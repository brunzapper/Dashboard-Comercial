// Versão: 1.1 | Data: 08/09/2026
// v1.1 (08/09/2026): cards de FORMULÁRIO (Workflow 0126). O catálogo em código
//   segue com as MESMAS garantias de antes (a rota é /operacao/<key>); as
//   novas cobrem a fusão: origem, prefixo próprio da rota e ordem.
// Guardas do catálogo de cards de Operação: forma estável (keys únicas, hrefs
// da área /operacao, padrões sem `area`) e recorte puro por área.
import { describe, expect, it } from "vitest";

import {
  OPERACAO_CARDS,
  filterOperacaoCards,
  formSchemaHref,
  formSchemaToCard,
  mergeOperacaoCards,
} from "./cards";

describe("OPERACAO_CARDS", () => {
  it("tem keys únicas e hrefs dentro de /operacao/", () => {
    const keys = OPERACAO_CARDS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const card of OPERACAO_CARDS) {
      expect(card.href).toBe(`/operacao/${card.key}`);
      expect(card.label.length).toBeGreaterThan(0);
      expect(card.description.length).toBeGreaterThan(0);
    }
  });

  it("agenda e tarefas são padrões (sem area); remuneracao é org-específico", () => {
    const byKey = new Map(OPERACAO_CARDS.map((c) => [c.key, c]));
    expect(byKey.get("agenda")?.area).toBeUndefined();
    expect(byKey.get("tarefas")?.area).toBeUndefined();
    expect(byKey.get("remuneracao")?.area).toBe("remuneracao");
  });

  it("padrões vêm antes dos org-específicos (ordem estável entre orgs)", () => {
    const firstScoped = OPERACAO_CARDS.findIndex((c) => c.area);
    if (firstScoped >= 0) {
      for (const card of OPERACAO_CARDS.slice(firstScoped)) {
        expect(card.area).toBeDefined();
      }
    }
  });
});

describe("filterOperacaoCards", () => {
  it("mantém padrões sempre e org-específicos só com veredito true", () => {
    const off = filterOperacaoCards(OPERACAO_CARDS, () => false);
    expect(off.map((c) => c.key)).toEqual(["agenda", "tarefas"]);

    const on = filterOperacaoCards(OPERACAO_CARDS, (a) => a === "remuneracao");
    expect(on.map((c) => c.key)).toEqual(["agenda", "tarefas", "remuneracao"]);
  });
});

describe("cards de formulário (0126)", () => {
  const schema = {
    key: "bitrix_lead_form",
    label: "Formulário de criação Bitrix",
    description: "Lança um lead no CRM.",
  };

  it("a rota fica sob /operacao/f/ — nunca colide com uma sub-área", () => {
    // Um formulário chamado "agenda" sequestraria a Agenda se a rota fosse
    // /operacao/<chave>.
    expect(formSchemaHref("agenda")).toBe("/operacao/f/agenda");
    const modules = new Set(OPERACAO_CARDS.map((c) => c.href));
    expect(modules.has(formSchemaHref("agenda"))).toBe(false);
  });

  it("herda o gate da fábrica e se declara formulário", () => {
    const card = formSchemaToCard(schema);
    expect(card.area).toBe("workflow");
    expect(card.kind).toBe("formulario");
    expect(card.href).toBe("/operacao/f/bitrix_lead_form");
    expect(card.label).toBe(schema.label);
  });

  it("a key do card não colide com a de um módulo", () => {
    const card = formSchemaToCard({ ...schema, key: "workflow" });
    expect(OPERACAO_CARDS.some((c) => c.key === card.key)).toBe(false);
  });

  it("esquema sem descrição ganha um texto, nunca um card mudo", () => {
    const card = formSchemaToCard({ ...schema, description: null });
    expect(card.description.length).toBeGreaterThan(0);
  });

  it("formulários vêm DEPOIS dos módulos e somem com a área negada", () => {
    const forms = [formSchemaToCard(schema)];
    const on = mergeOperacaoCards(OPERACAO_CARDS, forms, () => true);
    expect(on.at(-1)?.kind).toBe("formulario");

    // Área Workflow negada: some o módulo E o formulário.
    const off = mergeOperacaoCards(
      OPERACAO_CARDS,
      forms,
      (a) => a !== "workflow"
    );
    expect(off.some((c) => c.kind === "formulario")).toBe(false);
    expect(off.some((c) => c.key === "workflow")).toBe(false);
  });

  it("sem formulários, a fusão devolve exatamente o catálogo em código", () => {
    const only = mergeOperacaoCards(OPERACAO_CARDS, [], () => true);
    expect(only).toEqual(OPERACAO_CARDS);
  });
});
