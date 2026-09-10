// Versão: 1.0 | Data: 09/09/2026
// A cascata dos três níveis, e o piso que nenhum deles atravessa.
import { describe, expect, it } from "vitest";

import { parseMirrorChoice, resolveMirror } from "./mirror-config";

const comBase = { baseOwner: "deal" as const, sourceId: "123" };

describe("resolveMirror", () => {
  it("Base ligada e registro com par no CRM: espelha", () => {
    expect(resolveMirror(comBase)).toEqual({
      mirror: true,
      ownerEntity: "deal",
      ownerSourceId: "123",
    });
  });

  it("Base desligada é o padrão de tudo que existe hoje", () => {
    const d = resolveMirror({ baseOwner: null, sourceId: "123" });
    expect(d.mirror).toBe(false);
    expect(d.reason).toContain("não espelha");
  });

  // Ligar a Base tem de alcançar as séries que JÁ rodam, sem editá-las: é por
  // isso que "herdar" é o padrão e não equivale a "nunca".
  it("regra em 'herdar' segue a Base", () => {
    expect(resolveMirror({ ...comBase, ruleChoice: "herdar" }).mirror).toBe(true);
  });

  it("a regra pode desligar uma série ruidosa sem mexer na Base", () => {
    expect(resolveMirror({ ...comBase, ruleChoice: "nunca" }).mirror).toBe(false);
  });

  it("a tarefa vence a regra — é o nível mais específico", () => {
    expect(
      resolveMirror({ ...comBase, ruleChoice: "nunca", taskChoice: "sempre" })
        .mirror
    ).toBe(true);
    expect(
      resolveMirror({ ...comBase, ruleChoice: "sempre", taskChoice: "nunca" })
        .mirror
    ).toBe(false);
  });

  // O piso: nenhuma escolha inventa um lugar onde pendurar a atividade.
  it("'sempre' NÃO cria dono onde não há registro no CRM", () => {
    const semPar = resolveMirror({
      baseOwner: "deal",
      sourceId: null,
      taskChoice: "sempre",
    });
    expect(semPar.mirror).toBe(false);
    expect(semPar.reason).toContain("não tem par no Bitrix");
  });

  it("'sempre' com a Base desligada explica o que falta configurar", () => {
    const d = resolveMirror({
      baseOwner: null,
      sourceId: "123",
      taskChoice: "sempre",
    });
    expect(d.mirror).toBe(false);
    expect(d.reason).toContain("não está configurada");
  });

  it("leva a entidade da Base, não uma adivinhada", () => {
    expect(
      resolveMirror({ baseOwner: "lead", sourceId: "9" }).ownerEntity
    ).toBe("lead");
  });
});

describe("parseMirrorChoice", () => {
  it("qualquer coisa fora do contrato é 'herdar'", () => {
    expect(parseMirrorChoice(undefined)).toBe("herdar");
    expect(parseMirrorChoice("talvez")).toBe("herdar");
    expect(parseMirrorChoice(true)).toBe("herdar");
  });

  it("as duas decisões explícitas passam", () => {
    expect(parseMirrorChoice("sempre")).toBe("sempre");
    expect(parseMirrorChoice("nunca")).toBe("nunca");
  });
});
