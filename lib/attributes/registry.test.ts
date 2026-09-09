// Versão: 1.0 | Data: 09/09/2026
// O registry decide o que EXISTE como atributo. Os testes protegem as duas
// decisões que o desenho tomou: chave desconhecida não vira superfície (mas
// também não some da tela — o dado está no banco), e o par chave/superfície é
// o que torna um atributo utilizável.
import { describe, expect, it } from "vitest";

import {
  ATTRIBUTE_REGISTRY,
  attributeDef,
  attributeHasSurface,
  attributeLabel,
} from "./registry";

describe("registry de atributos", () => {
  it("a Tree existe e tem superfície", () => {
    const tree = attributeDef("tree");
    expect(tree?.surface).toBe("tree");
    expect(attributeHasSurface("tree")).toBe(true);
  });

  it("chave desconhecida não tem superfície, mas ainda tem rótulo", () => {
    // Um atributo cujo código saiu (ou de uma versão mais nova) continua sendo
    // uma linha real do registro: exibir sem tela é melhor que sumir com ela.
    expect(attributeHasSurface("inventado")).toBe(false);
    expect(attributeLabel("inventado")).toBe("inventado");
  });

  it("toda entrada tem chave de slug, rótulo e descrição", () => {
    for (const a of ATTRIBUTE_REGISTRY) {
      // Mesmo slug do CHECK da 0131.
      expect(a.key, `chave inválida: ${a.key}`).toMatch(/^[a-z][a-z0-9_]{1,39}$/);
      expect(a.label.trim()).not.toBe("");
      expect(a.description.trim()).not.toBe("");
    }
  });

  it("as chaves são únicas", () => {
    const keys = ATTRIBUTE_REGISTRY.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
