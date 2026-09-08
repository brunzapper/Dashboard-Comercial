// Versão: 1.0 | Data: 08/09/2026
// Guarda do registry de escopos da IA da Operação. O painel vive no LAYOUT e
// escolhe o escopo pelo pathname — se `scopeForPath` casar demais, a conversa
// de uma área apareceria em outra; se casar de menos, o painel some. Puro.
import { describe, expect, it } from "vitest";

import { AREA_GATES } from "@/lib/auth/access";
import { OPERACAO_AI_SCOPES, scopeForPath } from "./scopes";

describe("catálogo de escopos", () => {
  it("toda key é uma chave de ÁREA existente (histórica, nunca renomeada)", () => {
    for (const scope of OPERACAO_AI_SCOPES) {
      expect(Object.keys(AREA_GATES)).toContain(scope.key);
    }
  });

  it("não repete key nem href", () => {
    const keys = OPERACAO_AI_SCOPES.map((s) => s.key);
    const hrefs = OPERACAO_AI_SCOPES.map((s) => s.href);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("todo href aponta para dentro de /operacao", () => {
    for (const scope of OPERACAO_AI_SCOPES) {
      expect(scope.href.startsWith("/operacao/")).toBe(true);
    }
  });

  it("todo escopo tem rótulo, descrição e placeholder preenchidos", () => {
    for (const scope of OPERACAO_AI_SCOPES) {
      expect(scope.label.trim()).not.toBe("");
      expect(scope.description.trim()).not.toBe("");
      expect(scope.placeholder.trim()).not.toBe("");
    }
  });
});

describe("scopeForPath", () => {
  const scopes = [
    { key: "a", label: "A", description: "d", href: "/operacao/a", adminOnly: true, placeholder: "p" },
    { key: "ab", label: "AB", description: "d", href: "/operacao/ab", adminOnly: false, placeholder: "p" },
    { key: "sub", label: "Sub", description: "d", href: "/operacao/a/sub", adminOnly: false, placeholder: "p" },
  ];

  it("casa a rota exata", () => {
    expect(scopeForPath("/operacao/a", scopes)?.key).toBe("a");
  });

  it("casa sub-rotas do escopo", () => {
    expect(scopeForPath("/operacao/a/qualquer", scopes)?.key).toBe("a");
  });

  it("prefere o href MAIS específico", () => {
    // Sem a ordenação por comprimento, "/operacao/a/sub" cairia em "a".
    expect(scopeForPath("/operacao/a/sub", scopes)?.key).toBe("sub");
  });

  it("não confunde prefixo de string com prefixo de ROTA", () => {
    // "/operacao/ab" começa com "/operacao/a" — casar por substring pura
    // entregaria a conversa do escopo errado.
    expect(scopeForPath("/operacao/ab", scopes)?.key).toBe("ab");
  });

  it("devolve null fora dos escopos (Agenda/Tarefas não têm painel)", () => {
    expect(scopeForPath("/operacao/agenda", scopes)).toBeNull();
    expect(scopeForPath("/registros", scopes)).toBeNull();
    expect(scopeForPath("", scopes)).toBeNull();
  });

  it("respeita a lista PERMITIDA que o servidor passa", () => {
    // O layout já filtrou por área/papel: um escopo fora da lista não existe
    // para o painel, mesmo que a rota case.
    expect(scopeForPath("/operacao/a", [scopes[1]])).toBeNull();
  });
});
