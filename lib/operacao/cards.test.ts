// Versão: 1.0 | Data: 05/08/2026
// Guardas do catálogo de cards de Operação: forma estável (keys únicas, hrefs
// da área /operacao, padrões sem `area`) e recorte puro por área.
import { describe, expect, it } from "vitest";

import { OPERACAO_CARDS, filterOperacaoCards } from "./cards";

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
