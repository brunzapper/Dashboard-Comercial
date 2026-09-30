// Versão: 1.0 | Data: 30/09/2026
// O layout da Root. O que se protege:
//  - nenhum cartão cai em cima de outro — para o lado, para baixo e misto;
//  - o colapso esconde o galho e conta quantos ficaram escondidos;
//  - o offset gravado é RELATIVO e leva o subgalho junto;
//  - a mesma árvore sai no mesmo lugar (determinístico).
import { describe, expect, it } from "vitest";

import type { TreeNode } from "./model";
import {
  edgePath,
  hitTest,
  layoutRoot,
  ROOT_NODE_HEIGHT,
  ROOT_NODE_WIDTH,
  type RootBox,
} from "./root-layout";

const n = (id: string, children: TreeNode[] = []): TreeNode => ({
  id,
  kind: "note",
  at: "",
  label: id,
  children,
  depth: 0,
});

const tree = (): TreeNode[] => [
  n("goal", [
    n("a", [n("a1"), n("a2"), n("a3")]),
    n("b", [n("b1")]),
    n("c"),
  ]),
  n("outra", [n("o1"), n("o2")]),
];

function overlaps(boxes: RootBox[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const p = boxes[i];
      const q = boxes[j];
      if (
        p.x < q.x + q.w &&
        q.x < p.x + p.w &&
        p.y < q.y + q.h &&
        q.y < p.y + p.h
      ) {
        out.push(`${p.id}×${q.id}`);
      }
    }
  }
  return out;
}

const byId = (boxes: RootBox[], id: string) => boxes.find((b) => b.id === id)!;

describe("sem sobreposição", () => {
  it("galhos para o lado", () => {
    const { boxes } = layoutRoot(tree(), { defaultDirection: "h" });
    expect(boxes).toHaveLength(11);
    expect(overlaps(boxes)).toEqual([]);
    // O filho fica à DIREITA do pai.
    expect(byId(boxes, "a").x).toBeGreaterThan(byId(boxes, "goal").x);
  });

  it("galhos para baixo", () => {
    const { boxes } = layoutRoot(tree(), { defaultDirection: "v" });
    expect(overlaps(boxes)).toEqual([]);
    expect(byId(boxes, "a").y).toBeGreaterThan(byId(boxes, "goal").y);
  });

  it("misto: um galho desce enquanto o resto abre para o lado", () => {
    const { boxes } = layoutRoot(tree(), {
      defaultDirection: "h",
      directionOf: (id) => (id === "a" ? "v" : null),
    });
    expect(overlaps(boxes)).toEqual([]);
    expect(byId(boxes, "a1").y).toBeGreaterThan(byId(boxes, "a").y);
    expect(byId(boxes, "a").direction).toBe("v");
    expect(byId(boxes, "b").direction).toBe("h");
  });
});

describe("colapso", () => {
  it("esconde o galho e conta os escondidos", () => {
    const { boxes, edges } = layoutRoot(tree(), {
      defaultDirection: "h",
      collapsed: new Set(["goal"]),
    });
    const goal = byId(boxes, "goal");
    expect(goal.hiddenCount).toBe(7);
    expect(goal.hasChildren).toBe(true);
    expect(boxes.some((b) => b.id === "a1")).toBe(false);
    expect(edges.some((e) => e.from === "goal")).toBe(false);
  });
});

describe("offset", () => {
  it("é relativo ao slot e leva o subgalho junto", () => {
    const base = layoutRoot(tree(), { defaultDirection: "h" }).boxes;
    const moved = layoutRoot(tree(), {
      defaultDirection: "h",
      offsetOf: (id) => (id === "a" ? { x: 30, y: -10 } : null),
    }).boxes;
    for (const id of ["a", "a1", "a2", "a3"]) {
      expect(byId(moved, id).x).toBe(byId(base, id).x + 30);
      expect(byId(moved, id).y).toBe(byId(base, id).y - 10);
    }
    // O irmão fica onde estava.
    expect(byId(moved, "b")).toEqual(byId(base, "b"));
  });
});

describe("determinístico", () => {
  it("a mesma árvore sai no mesmo lugar", () => {
    const one = layoutRoot(tree(), { defaultDirection: "h" });
    const two = layoutRoot(tree(), { defaultDirection: "h" });
    expect(one).toEqual(two);
  });

  it("sem nós, caixa vazia", () => {
    expect(layoutRoot([], { defaultDirection: "h" }).bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
    });
  });
});

describe("conector e alvo", () => {
  const a = { x: 0, y: 0, w: ROOT_NODE_WIDTH, h: ROOT_NODE_HEIGHT };
  const b = { x: 300, y: 100, w: ROOT_NODE_WIDTH, h: ROOT_NODE_HEIGHT };

  it("para o lado sai da borda direita e entra na esquerda", () => {
    expect(edgePath(a, b, "h").startsWith(`M ${ROOT_NODE_WIDTH} `)).toBe(true);
  });

  it("para baixo sai da borda inferior", () => {
    expect(edgePath(a, b, "v")).toContain(`M ${ROOT_NODE_WIDTH / 2} ${ROOT_NODE_HEIGHT}`);
  });

  it("o galho arrastado nunca é alvo de si mesmo", () => {
    const { boxes } = layoutRoot(tree(), { defaultDirection: "h" });
    const goal = byId(boxes, "goal");
    const point = { x: goal.x + 5, y: goal.y + 5 };
    expect(hitTest(boxes, point, new Set())?.id).toBe("goal");
    expect(hitTest(boxes, point, new Set(["goal"]))).toBeNull();
  });
});
