// Versão: 1.2 | Data: 10/09/2026
// v1.2 (10/09/2026): VÁRIOS TRONCOS. Um registro pode seguir mais de uma série,
//   e a árvore desenhava um só. O que os testes novos protegem é a assimetria
//   que torna a mudança segura: com UMA série a saída continua idêntica à de
//   antes (nenhum agrupador aparece), e o agrupador só nasce quando há o que
//   separar.
// v1.1 | Data: 09/09/2026
// v1.1 (09/09/2026): a JANELA não orfana nó — o recorte por ocorrência entrega
//   um tronco que NÃO começa na 1ª, e nada pode se perder por isso.
// A árvore é derivada dos fatos. O que estes testes protegem:
//  - as três formas sobre os MESMOS fatos dão árvores diferentes e corretas;
//  - o nó arrastado à mão vence a derivação em qualquer forma (foi o pedido:
//    a forma por ocorrência por padrão, editável livremente depois);
//  - nenhum fato se perde — nem o que aconteceu antes da primeira ocorrência,
//    nem o que aponta para um pai que sumiu.
import { describe, expect, it } from "vitest";

import { countNodes, deriveTree } from "./derive";
import type { TreeFact } from "./model";

const facts: TreeFact[] = [
  { id: "occ:1", kind: "occurrence", at: "2026-09-15", label: "1ª ocorrência" },
  { id: "occ:2", kind: "occurrence", at: "2026-09-29", label: "2ª ocorrência" },
  { id: "comment:a", kind: "comment", at: "2026-09-03", label: "Liguei, sem resposta" },
  { id: "task:b", kind: "task", at: "2026-09-20", label: "Enviar proposta" },
  { id: "change:c", kind: "change", at: "2026-10-02", label: "Etapa mudou" },
];

const childIds = (nodes: ReturnType<typeof deriveTree>, id: string) =>
  nodes.find((n) => n.id === id)?.children.map((c) => c.id) ?? [];

describe("forma por ocorrência", () => {
  const tree = deriveTree({ facts, layout: "por_ocorrencia" });

  it("o tronco são as ocorrências", () => {
    expect(tree.map((n) => n.id)).toEqual(["occ:1", "occ:2"]);
  });

  it("cada fato pendura na ocorrência em cuja janela caiu", () => {
    expect(childIds(tree, "occ:1")).toEqual(["comment:a", "task:b"]);
    expect(childIds(tree, "occ:2")).toEqual(["change:c"]);
  });

  it("o que aconteceu ANTES da primeira ocorrência pendura nela, não some", () => {
    // O comentário do dia 03 é do primeiro ciclo — perdê-lo seria perder o
    // começo do acompanhamento.
    expect(childIds(tree, "occ:1")).toContain("comment:a");
    expect(countNodes(tree)).toBe(facts.length);
  });

  it("sem nenhuma ocorrência, os fatos ficam na raiz", () => {
    const semTronco = deriveTree({
      facts: facts.filter((f) => f.kind !== "occurrence"),
      layout: "por_ocorrencia",
    });
    expect(semTronco).toHaveLength(3);
  });
});

describe("forma por tipo", () => {
  const tree = deriveTree({ facts, layout: "por_tipo" });

  it("um ramo por tipo, ocorrências na raiz", () => {
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
    // Raízes em ordem cronológica: a tarefa do dia 20 vem antes da 2ª ocorrência.
    expect(tree.map((n) => n.id)).toEqual(["occ:1", "task:b", "occ:2"]);
    expect(childIds(tree, "task:b")).toEqual(["comment:a"]);
    expect(tree.find((n) => n.id === "task:b")?.children[0].children[0].id).toBe(
      "change:c"
    );
  });
});

describe("o arrastado vence a derivação", () => {
  it("re-pendurar move o nó, mesmo na forma por ocorrência", () => {
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

// A janela (lib/tree/load.ts) recorta por OCORRÊNCIA, então o conjunto de fatos
// que chega aqui pode começar na 5ª. Do ponto de vista da derivação isso é
// apenas "um tronco que começa mais tarde" — e a regra de sempre (o que veio
// antes da primeira ocorrência pendura nela) é justamente o que impede o galho
// de virar órfão. Se alguém trocar essa regra por um descarte, este teste cai.
describe("janela: tronco que não começa na 1ª ocorrência", () => {
  const janela: TreeFact[] = [
    { id: "occ:5", kind: "occurrence", at: "2026-11-10", label: "5ª ocorrência" },
    { id: "occ:6", kind: "occurrence", at: "2026-11-24", label: "6ª ocorrência" },
    // Aconteceu ANTES da primeira ocorrência DA JANELA (a 5ª).
    { id: "comment:x", kind: "comment", at: "2026-11-02", label: "Retomei o contato" },
    { id: "task:y", kind: "task", at: "2026-11-15", label: "Reenviar proposta" },
  ];

  it("nenhum fato se perde por estar antes do início da janela", () => {
    const tree = deriveTree({ facts: janela, layout: "por_ocorrencia" });
    expect(countNodes(tree)).toBe(janela.length);
  });

  it("o fato anterior pendura na primeira ocorrência da janela", () => {
    const tree = deriveTree({ facts: janela, layout: "por_ocorrencia" });
    const quinta = tree.find((n) => n.id === "occ:5")!;
    expect(quinta.children.map((c) => c.id)).toContain("comment:x");
  });
});

// ---------------------------------------------------------------------------
// v1.2 — várias séries no mesmo registro.
// ---------------------------------------------------------------------------
describe("vários troncos", () => {
  const duas: TreeFact[] = [
    { id: "occ:r1:1", kind: "occurrence", at: "2026-09-15", label: "1ª Tarefa", seriesKey: "acomp" },
    { id: "occ:r1:2", kind: "occurrence", at: "2026-09-29", label: "2ª Tarefa", seriesKey: "acomp" },
    { id: "occ:r2:1", kind: "occurrence", at: "2026-09-20", label: "1ª Visita", seriesKey: "visita" },
    { id: "comment:a", kind: "comment", at: "2026-09-17", label: "Liguei" },
  ];

  const tree = deriveTree({
    facts: duas,
    layout: "por_ocorrencia",
    primarySeriesKey: "acomp",
    seriesLabels: { acomp: "Acompanhamento", visita: "Visita técnica" },
  });

  it("cada série ganha o próprio agrupador, com o nome da regra", () => {
    expect(tree.map((n) => n.id)).toEqual(["series:acomp", "series:visita"]);
    expect(tree[0].label).toBe("Acompanhamento");
    expect(tree[1].label).toBe("Visita técnica");
  });

  it("as ocorrências ficam sob a série DELAS", () => {
    expect(childIds(tree, "series:acomp")).toEqual(["occ:r1:1", "occ:r1:2"]);
    expect(childIds(tree, "series:visita")).toEqual(["occ:r2:1"]);
  });

  it("o fato avulso cai na janela da série PRIMÁRIA, não na mais próxima", () => {
    // O comentário do dia 17 está entre a 1ª do acompanhamento (15) e a da
    // visita (20). Repartir por proximidade inventaria um pertencimento que
    // ele não tem: ele aconteceu num dia, e o dia cai na janela das duas.
    const primeira = tree[0].children.find((n) => n.id === "occ:r1:1")!;
    expect(primeira.children.map((c) => c.id)).toEqual(["comment:a"]);
  });

  it("nenhum fato se perde", () => {
    // +2 pelos dois agrupadores, que são nós sintéticos.
    expect(countNodes(tree)).toBe(duas.length + 2);
  });

  it("sem `primarySeriesKey`, a primeira série dos fatos manda", () => {
    const semPrimaria = deriveTree({ facts: duas, layout: "por_ocorrencia" });
    const acomp = semPrimaria.find((n) => n.id === "series:acomp")!;
    const primeira = acomp.children.find((n) => n.id === "occ:r1:1")!;
    expect(primeira.children.map((c) => c.id)).toEqual(["comment:a"]);
  });
});

describe("com UMA série, a árvore é a de antes", () => {
  // A não-regressão que torna a v1.2 segura: todo registro que existe hoje tem
  // uma série só, e para ele nada pode mudar.
  const uma: TreeFact[] = facts.map((f) =>
    f.kind === "occurrence" ? { ...f, seriesKey: "acomp" } : f
  );

  it("nenhum agrupador aparece", () => {
    const tree = deriveTree({
      facts: uma,
      layout: "por_ocorrencia",
      primarySeriesKey: "acomp",
      seriesLabels: { acomp: "Acompanhamento" },
    });
    expect(tree.map((n) => n.id)).toEqual(["occ:1", "occ:2"]);
    expect(tree.some((n) => n.kind === "series")).toBe(false);
  });

  it("a saída é a MESMA de quando os fatos não tinham seriesKey", () => {
    const comChave = deriveTree({ facts: uma, layout: "por_ocorrencia" });
    const semChave = deriveTree({ facts, layout: "por_ocorrencia" });
    const shape = (nodes: ReturnType<typeof deriveTree>): unknown =>
      nodes.map((n) => [n.id, shape(n.children)]);
    expect(shape(comChave)).toEqual(shape(semChave));
  });

  it("a forma por tipo nunca agrupa por série", () => {
    const tree = deriveTree({ facts: uma, layout: "por_tipo" });
    expect(tree.some((n) => n.kind === "series")).toBe(false);
  });
});
