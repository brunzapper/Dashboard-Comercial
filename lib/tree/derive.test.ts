// Versão: 1.1 | Data: 09/09/2026
// v1.1 (09/09/2026): a JANELA não orfana nó — o recorte por cobrança entrega
//   um tronco que NÃO começa na 1ª, e nada pode se perder por isso.
// A árvore é derivada dos fatos. O que estes testes protegem:
//  - as três formas sobre os MESMOS fatos dão árvores diferentes e corretas;
//  - o nó arrastado à mão vence a derivação em qualquer forma (foi o pedido:
//    a forma por cobrança por padrão, editável livremente depois);
//  - nenhum fato se perde — nem o que aconteceu antes da primeira cobrança,
//    nem o que aponta para um pai que sumiu.
import { describe, expect, it } from "vitest";

import { countNodes, deriveTree } from "./derive";
import type { TreeFact } from "./model";

const facts: TreeFact[] = [
  { id: "occ:1", kind: "occurrence", at: "2026-09-15", label: "1ª cobrança" },
  { id: "occ:2", kind: "occurrence", at: "2026-09-29", label: "2ª cobrança" },
  { id: "comment:a", kind: "comment", at: "2026-09-03", label: "Liguei, sem resposta" },
  { id: "task:b", kind: "task", at: "2026-09-20", label: "Enviar proposta" },
  { id: "change:c", kind: "change", at: "2026-10-02", label: "Etapa mudou" },
];

const childIds = (nodes: ReturnType<typeof deriveTree>, id: string) =>
  nodes.find((n) => n.id === id)?.children.map((c) => c.id) ?? [];

describe("forma por cobrança", () => {
  const tree = deriveTree({ facts, layout: "por_ocorrencia" });

  it("o tronco são as cobranças", () => {
    expect(tree.map((n) => n.id)).toEqual(["occ:1", "occ:2"]);
  });

  it("cada fato pendura na cobrança em cuja janela caiu", () => {
    expect(childIds(tree, "occ:1")).toEqual(["comment:a", "task:b"]);
    expect(childIds(tree, "occ:2")).toEqual(["change:c"]);
  });

  it("o que aconteceu ANTES da primeira cobrança pendura nela, não some", () => {
    // O comentário do dia 03 é do primeiro ciclo — perdê-lo seria perder o
    // começo do acompanhamento.
    expect(childIds(tree, "occ:1")).toContain("comment:a");
    expect(countNodes(tree)).toBe(facts.length);
  });

  it("sem nenhuma cobrança, os fatos ficam na raiz", () => {
    const semTronco = deriveTree({
      facts: facts.filter((f) => f.kind !== "occurrence"),
      layout: "por_ocorrencia",
    });
    expect(semTronco).toHaveLength(3);
  });
});

describe("forma por tipo", () => {
  const tree = deriveTree({ facts, layout: "por_tipo" });

  it("um ramo por tipo, cobranças na raiz", () => {
    expect(tree.map((n) => n.id)).toEqual([
      "occ:1",
      "occ:2",
      "kind:task",
      "kind:comment",
      "kind:change",
    ]);
  });

  it("os fatos ficam sob o ramo do tipo deles", () => {
    expect(childIds(tree, "kind:comment")).toEqual(["comment:a"]);
    expect(childIds(tree, "kind:task")).toEqual(["task:b"]);
  });
});

describe("forma livre", () => {
  it("sem parentesco explícito, tudo é raiz — quem desenha é o usuário", () => {
    const tree = deriveTree({ facts, layout: "livre" });
    expect(tree).toHaveLength(facts.length);
  });

  it("com parentesco explícito, monta o desenho", () => {
    const tree = deriveTree({
      facts,
      layout: "livre",
      overrides: [
        { nodeRef: "comment:a", parentRef: "task:b" },
        { nodeRef: "change:c", parentRef: "comment:a" },
      ],
    });
    // Raízes em ordem cronológica: a tarefa do dia 20 vem antes da 2ª cobrança.
    expect(tree.map((n) => n.id)).toEqual(["occ:1", "task:b", "occ:2"]);
    expect(childIds(tree, "task:b")).toEqual(["comment:a"]);
    expect(tree.find((n) => n.id === "task:b")?.children[0].children[0].id).toBe(
      "change:c"
    );
  });
});

describe("o arrastado vence a derivação", () => {
  it("re-pendurar move o nó, mesmo na forma por cobrança", () => {
    const tree = deriveTree({
      facts,
      layout: "por_ocorrencia",
      overrides: [{ nodeRef: "change:c", parentRef: "occ:1" }],
    });
    expect(childIds(tree, "occ:1")).toContain("change:c");
    expect(childIds(tree, "occ:2")).not.toContain("change:c");
  });

  it("soltar na raiz também é uma decisão", () => {
    const tree = deriveTree({
      facts,
      layout: "por_ocorrencia",
      overrides: [{ nodeRef: "task:b", parentRef: null }],
    });
    expect(tree.map((n) => n.id)).toContain("task:b");
  });

  it("pai que sumiu não engole o nó — ele volta para a derivação", () => {
    const tree = deriveTree({
      facts,
      layout: "por_ocorrencia",
      overrides: [{ nodeRef: "task:b", parentRef: "occ:99" }],
    });
    expect(countNodes(tree)).toBe(facts.length);
    expect(childIds(tree, "occ:1")).toContain("task:b");
  });

  it("nó pendurado em si mesmo é recusado (sumiria da árvore)", () => {
    const tree = deriveTree({
      facts,
      layout: "por_ocorrencia",
      overrides: [{ nodeRef: "task:b", parentRef: "task:b" }],
    });
    expect(countNodes(tree)).toBe(facts.length);
  });
});

describe("profundidade", () => {
  it("a raiz é 0 e cada nível soma 1", () => {
    const tree = deriveTree({ facts, layout: "por_ocorrencia" });
    expect(tree[0].depth).toBe(0);
    expect(tree[0].children[0].depth).toBe(1);
  });
});

// A janela (lib/tree/load.ts) recorta por COBRANÇA, então o conjunto de fatos
// que chega aqui pode começar na 5ª. Do ponto de vista da derivação isso é
// apenas "um tronco que começa mais tarde" — e a regra de sempre (o que veio
// antes da primeira cobrança pendura nela) é justamente o que impede o galho
// de virar órfão. Se alguém trocar essa regra por um descarte, este teste cai.
describe("janela: tronco que não começa na 1ª cobrança", () => {
  const janela: TreeFact[] = [
    { id: "occ:5", kind: "occurrence", at: "2026-11-10", label: "5ª cobrança" },
    { id: "occ:6", kind: "occurrence", at: "2026-11-24", label: "6ª cobrança" },
    // Aconteceu ANTES da primeira cobrança DA JANELA (a 5ª).
    { id: "comment:x", kind: "comment", at: "2026-11-02", label: "Retomei o contato" },
    { id: "task:y", kind: "task", at: "2026-11-15", label: "Reenviar proposta" },
  ];

  it("nenhum fato se perde por estar antes do início da janela", () => {
    const tree = deriveTree({ facts: janela, layout: "por_ocorrencia" });
    expect(countNodes(tree)).toBe(janela.length);
  });

  it("o fato anterior pendura na primeira cobrança da janela", () => {
    const tree = deriveTree({ facts: janela, layout: "por_ocorrencia" });
    const quinta = tree.find((n) => n.id === "occ:5")!;
    expect(quinta.children.map((c) => c.id)).toContain("comment:x");
  });
});
