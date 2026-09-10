// Versão: 1.1 | Data: 10/09/2026
// v1.1 (10/09/2026): o nó de SEQUÊNCIA entra na lista dos que não se
//   selecionam. Ele é sintético (agrupa as ocorrências de uma série); marcá-lo
//   prometeria uma ação que não existe, e o galho dele já é alcançável pela
//   cascata a partir de qualquer ocorrência.
// A cascata tri-estado da árvore. O caso que decide o desenho é o terceiro:
// desmarcar UM filho de um pai marcado tem de deixar o pai PARCIAL e preservar
// os irmãos. É por isso que a fonte da verdade são as folhas, e o estado do pai
// é derivado — guardar "o pai está marcado" tornaria esse gesto indecidível.
import { describe, expect, it } from "vitest";

import type { TreeNode } from "./model";
import {
  allSelectableRefs,
  cascadeIds,
  nextCascadeValue,
  nodeCheckState,
  partitionSelection,
  selectableKind,
  selectableRefs,
  selectionSummary,
} from "./selection";

/** Fábrica curta: só o que a seleção olha. */
function node(
  id: string,
  kind: TreeNode["kind"],
  refId: string | null,
  children: TreeNode[] = []
): TreeNode {
  return {
    id,
    kind,
    at: "2026-09-15",
    label: id,
    ...(refId ? { refId } : {}),
    children,
    depth: 0,
  } as TreeNode;
}

/** Uma ocorrência JÁ fundida com tarefa, com 2 anotações e 1 alteração. */
const galho = node("occ:3", "occurrence", "t-occ", [
  node("comment:a", "comment", "c-a"),
  node("comment:b", "comment", "c-b"),
  node("change:x", "change", "a-x"),
]);

describe("selectableKind", () => {
  it("tarefa, anotação e nó livre entram", () => {
    expect(selectableKind({ kind: "task", refId: "t1" })).toBe("task");
    expect(selectableKind({ kind: "comment", refId: "c1" })).toBe("comment");
    expect(selectableKind({ kind: "note", refId: "n1" })).toBe("note");
  });

  // Fato do audit_log: não se apaga, então não se seleciona.
  it("ALTERAÇÃO nunca entra", () => {
    expect(selectableKind({ kind: "change", refId: "a1" })).toBeNull();
  });

  // A ocorrência prevista que ninguém abriu é galho vazio: marcar prometeria
  // uma ação que não existe.
  it("ocorrência só entra quando já virou tarefa", () => {
    expect(selectableKind({ kind: "occurrence", refId: "t9" })).toBe("task");
    expect(selectableKind({ kind: "occurrence", refId: null })).toBeNull();
  });

  it("registro e campo ficam de fora", () => {
    expect(selectableKind({ kind: "record", refId: "r1" })).toBeNull();
    expect(selectableKind({ kind: "field", refId: "f1" })).toBeNull();
  });
});

describe("selectableRefs", () => {
  it("percorre o galho e descarta o que não é selecionável", () => {
    expect(selectableRefs(galho).map((r) => r.nodeId)).toEqual([
      "occ:3",
      "comment:a",
      "comment:b",
    ]);
  });

  it("resolve o tipo de cada um", () => {
    expect(selectableRefs(galho).map((r) => r.kind)).toEqual([
      "task",
      "comment",
      "comment",
    ]);
  });
});

describe("nodeCheckState — a cascata", () => {
  it("pai marcado quando o galho INTEIRO está marcado", () => {
    const sel = new Set(cascadeIds(galho));
    expect(nodeCheckState(sel, galho)).toBe(true);
  });

  it("vazio quando nada do galho está marcado", () => {
    expect(nodeCheckState(new Set(), galho)).toBe(false);
  });

  // O caso que define o desenho inteiro.
  it("desmarcar UM filho deixa o pai parcial e preserva os irmãos", () => {
    const sel = new Set(cascadeIds(galho));
    sel.delete("comment:a");

    expect(nodeCheckState(sel, galho)).toBe("indeterminate");
    // Os irmãos seguem marcados — nada de "o pai desmarcou tudo".
    expect(sel.has("comment:b")).toBe(true);
    expect(sel.has("occ:3")).toBe(true);
  });

  it("filho pode ser marcado SOZINHO, sem o pai", () => {
    const sel = new Set(["comment:b"]);
    expect(nodeCheckState(sel, galho)).toBe("indeterminate");
  });

  // Um nó só de alteração não tem o que marcar: não pode aparecer como
  // "marcado" só porque não tem descendente selecionável.
  it("nó sem nada selecionável responde vazio, nunca marcado", () => {
    const soChange = node("change:y", "change", "a-y");
    expect(nodeCheckState(new Set(), soChange)).toBe(false);
    expect(nodeCheckState(new Set(["change:y"]), soChange)).toBe(false);
  });
});

describe("nextCascadeValue", () => {
  it("parcial vira MARCADO (o gesto resolve para tudo)", () => {
    expect(nextCascadeValue("indeterminate")).toBe(true);
  });
  it("marcado vira vazio; vazio vira marcado", () => {
    expect(nextCascadeValue(true)).toBe(false);
    expect(nextCascadeValue(false)).toBe(true);
  });
});

describe("partitionSelection", () => {
  const floresta = [
    galho,
    node("note:z", "note", "n-z"),
    node("task:solta", "task", "t-solta"),
  ];

  it("cada tipo vai para a action dona dele", () => {
    const refs = allSelectableRefs(floresta);
    const sel = new Set(refs.map((r) => r.nodeId));
    expect(partitionSelection(refs, sel)).toEqual({
      taskIds: ["t-occ", "t-solta"],
      commentIds: ["c-a", "c-b"],
      noteIds: ["n-z"],
    });
  });

  it("devolve o id da ENTIDADE, não o do nó", () => {
    const refs = allSelectableRefs([galho]);
    const { taskIds } = partitionSelection(refs, new Set(["occ:3"]));
    expect(taskIds).toEqual(["t-occ"]);
  });

  it("o que não está marcado fica de fora", () => {
    const refs = allSelectableRefs(floresta);
    expect(partitionSelection(refs, new Set())).toEqual({
      taskIds: [],
      commentIds: [],
      noteIds: [],
    });
  });
});

describe("selectionSummary", () => {
  it("diz o que vai acontecer com o quê", () => {
    expect(
      selectionSummary({ taskIds: ["a", "b"], commentIds: ["c"], noteIds: [] })
    ).toBe("2 tarefas · 1 anotação");
  });

  it("singular e plural corretos", () => {
    expect(
      selectionSummary({ taskIds: ["a"], commentIds: [], noteIds: ["n", "m"] })
    ).toBe("1 tarefa · 2 nós");
  });

  it("nada selecionado é string vazia", () => {
    expect(selectionSummary({ taskIds: [], commentIds: [], noteIds: [] })).toBe(
      ""
    );
  });
});

describe("o nó de SEQUÊNCIA não se seleciona (v1.1)", () => {
  const arvore = node("series:acomp", "series", null, [
    node("occ:r1:1", "occurrence", "t1"),
    node("occ:r1:2", "occurrence", null),
  ]);

  it("ele mesmo não é um alvo", () => {
    expect(selectableKind({ kind: "series", refId: null })).toBeNull();
    // Nem com um refId qualquer: o tipo é que decide.
    expect(selectableKind({ kind: "series", refId: "x" })).toBeNull();
  });

  it("mas o galho dele continua alcançável pela cascata", () => {
    // A ocorrência já fundida com uma tarefa é o único alvo real aqui — a
    // prevista que ninguém abriu segue de fora (regra da v1.0).
    expect(selectableRefs(arvore).map((r) => r.nodeId)).toEqual(["occ:r1:1"]);
    expect(cascadeIds(arvore)).toEqual(["occ:r1:1"]);
  });

  it("o estado do agrupador é derivado dos filhos, como o de qualquer pai", () => {
    expect(nodeCheckState(new Set(), arvore)).toBe(false);
    expect(nodeCheckState(new Set(["occ:r1:1"]), arvore)).toBe(true);
  });
});
