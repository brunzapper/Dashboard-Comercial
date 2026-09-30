// Versão: 1.0 | Data: 30/09/2026
// A leitura do caminho na Root: um galho DEPENDE dos filhos. O que se
// protege: o progresso conta o que está ABAIXO, o caminho sobe até o
// Resultado mais próximo, e o otimista do arrasto nunca cria ciclo.
import { describe, expect, it } from "vitest";

import type { TreeNode } from "./model";
import {
  descendantIds,
  findNode,
  moveSubtree,
  pathToGoal,
  progressOf,
  remainingOf,
} from "./path";

const n = (
  id: string,
  children: TreeNode[] = [],
  extra: Partial<TreeNode> = {}
): TreeNode => ({ id, kind: "note", at: "", label: id, children, depth: 0, ...extra });

const plano = (): TreeNode[] => [
  n(
    "meta",
    [
      n("proposta", [n("orcamento", [], { status: "concluída" }), n("demo", [], { status: "aberta" })], {
        status: "aberta",
      }),
      n("contrato", [], { kind: "task", status: "aberta" }),
      n("lembrete"),
    ],
    { goal: true }
  ),
];

describe("progresso", () => {
  it("conta os checáveis ABAIXO (texto livre não conta)", () => {
    const meta = plano()[0];
    expect(progressOf(meta)).toEqual({ done: 1, total: 4 });
    expect(remainingOf(meta)).toBe(3);
  });

  it("folha não tem progresso", () => {
    expect(progressOf(n("x"))).toEqual({ done: 0, total: 0 });
  });
});

describe("caminho até o Resultado", () => {
  it("sobe até o Resultado mais próximo", () => {
    expect(pathToGoal(plano(), "demo")).toEqual(["demo", "proposta", "meta"]);
  });

  it("sem Resultado, vai até a raiz", () => {
    const roots = [n("a", [n("b", [n("c")])])];
    expect(pathToGoal(roots, "c")).toEqual(["c", "b", "a"]);
  });

  it("nó inexistente: caminho vazio", () => {
    expect(pathToGoal(plano(), "nada")).toEqual([]);
  });

  it("descendentes são 'do que isto depende'", () => {
    const proposta = findNode(plano(), "proposta")!;
    expect(descendantIds(proposta)).toEqual(["orcamento", "demo"]);
  });
});

describe("moveSubtree (otimista do arrasto)", () => {
  it("leva o galho inteiro para o novo pai", () => {
    const next = moveSubtree(plano(), "proposta", "contrato");
    const contrato = findNode(next, "contrato")!;
    expect(contrato.children.map((c) => c.id)).toEqual(["proposta"]);
    expect(findNode(next, "orcamento")!.depth).toBe(3);
  });

  it("soltar na raiz", () => {
    const next = moveSubtree(plano(), "demo", null);
    expect(next.map((r) => r.id)).toEqual(["meta", "demo"]);
    expect(next[1].depth).toBe(0);
  });

  it("nunca pendura um galho num descendente dele (ciclo)", () => {
    const before = plano();
    expect(moveSubtree(before, "meta", "demo")).toBe(before);
  });

  it("não muta a árvore original", () => {
    const before = plano();
    moveSubtree(before, "demo", "contrato");
    expect(findNode(before, "proposta")!.children.map((c) => c.id)).toContain(
      "demo"
    );
  });
});
