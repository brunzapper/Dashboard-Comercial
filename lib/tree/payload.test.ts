// Versão: 1.1 | Data: 02/10/2026
// v1.1 (02/10/2026): o nível vira ETIQUETA livre (o `level` legado é lido
//   como etiqueta), o plano vira Multi-fatores (5W2H legado convertido na
//   leitura) e os pedidos de valor saem POR NÓ.
import { describe, expect, it } from "vitest";

import {
  indicatorRequestsOf,
  parseIndicatorPayload,
  parseNodePayload,
  parsePlanPayload,
  parseRitualPayload,
} from "./payload";
import { parseTreeNodeRows, type TreeNodeRow } from "./rows";
import { subtreeAt } from "./path";
import { layoutRoot, ROOT_NODE_HEIGHT, ROOT_NODE_WIDTH } from "./root-layout";
import type { TreeNode } from "./model";

describe("payload fail-closed", () => {
  it("indicador exige chave válida; o nível legado vira etiqueta livre", () => {
    expect(parseIndicatorPayload({ indicator: "MRR!" })).toBeNull();
    expect(
      parseIndicatorPayload({ indicator: "mrr_novo_inbound", level: "N9", childrenOp: "×" })
    ).toEqual({ indicator: "mrr_novo_inbound", tag: "N9", childrenOp: "×" });
    expect(parseIndicatorPayload({ indicator: "mrr", tag: "Estratégico" })?.tag).toBe(
      "Estratégico"
    );
  });
  it("plano LEGADO (5W2H) vira fatores com título, na ordem; lixo some", () => {
    expect(
      parsePlanPayload({ oQue: " x ", lixo: 1, indicators: ["mrr", "Ruim", "mrr"] })
    ).toEqual({ factors: [{ id: "oQue", title: "O quê", text: "x" }], indicators: ["mrr"] });
  });
  it("Multi-fatores: título opcional, fator vazio some", () => {
    expect(
      parsePlanPayload({
        factors: [
          { id: "a", text: "Ligar para a base" },
          { title: "Prazo", text: "até 15/10" },
          { text: "  " },
        ],
      })
    ).toEqual({
      factors: [
        { id: "a", text: "Ligar para a base" },
        { id: "f2", title: "Prazo", text: "até 15/10" },
      ],
    });
  });
  it("ritual exige cadência válida", () => {
    expect(parseRitualPayload({ schedule: { cadence: "semanal", anchor: "x" } })).toBeNull();
    expect(
      parseRitualPayload({
        schedule: { cadence: "semanal", weekday: 5, anchor: "2026-10-01" },
        auto: "sim",
      })
    ).toEqual({ schedule: { cadence: "semanal", weekday: 5, anchor: "2026-10-01" } });
  });
  it("tipo sem payload devolve null", () => {
    expect(parseNodePayload("note", {})).toBeNull();
  });
});

const row = (over: Partial<TreeNodeRow>): TreeNodeRow => ({
  id: "00000000-0000-4000-a000-000000000001",
  kind: "note",
  ref_id: null,
  node_ref: null,
  parent_ref: "-",
  label: "x",
  body: null,
  position: 0,
  created_at: "2026-10-01T10:00:00Z",
  ...over,
});

describe("parseTreeNodeRows com nós operacionais", () => {
  it("vira fato com payload e preset_key resolve o id lógico", () => {
    const parsed = parseTreeNodeRows([
      row({ kind: "indicator", payload: { indicator: "mrr" }, preset_key: "mrr_inbound" }),
    ]);
    expect(parsed.facts[0]).toMatchObject({
      id: "note:00000000-0000-4000-a000-000000000001",
      kind: "indicator",
      payload: { indicator: "mrr" },
      status: null,
    });
    expect(parsed.presetRefs).toEqual({
      mrr_inbound: "note:00000000-0000-4000-a000-000000000001",
    });
  });
});

const node = (id: string, kind: TreeNode["kind"], children: TreeNode[] = []): TreeNode => ({
  id,
  kind,
  at: "",
  label: id,
  children,
  depth: 0,
});

describe("galho e layout", () => {
  const tree = [node("a", "indicator", [node("b", "indicator", [node("c", "note")])])];
  it("subtreeAt recorta e reconta a profundidade", () => {
    const cut = subtreeAt(tree, "b");
    expect(cut?.[0].id).toBe("b");
    expect(cut?.[0].depth).toBe(0);
    expect(cut?.[0].children[0].depth).toBe(1);
    expect(subtreeAt(tree, "zz")).toBeNull();
  });
  it("sizeOf ausente é byte-idêntico; presente usa o tamanho do nó", () => {
    const plain = layoutRoot(tree, { defaultDirection: "h" });
    expect(plain.boxes.every((b) => b.w === ROOT_NODE_WIDTH && b.h === ROOT_NODE_HEIGHT)).toBe(true);
    const sized = layoutRoot(tree, {
      defaultDirection: "h",
      sizeOf: (n) => (n.kind === "indicator" ? { w: 300, h: 156 } : { w: 224, h: 92 }),
    });
    const a = sized.boxes.find((b) => b.id === "a")!;
    const b = sized.boxes.find((x) => x.id === "b")!;
    expect(a.w).toBe(300);
    // o filho começa depois do cartão LARGO do pai
    expect(b.x).toBeGreaterThanOrEqual(a.x + 300);
  });
  it("indicatorRequestsOf: um pedido por nó de indicador + os dos planos", () => {
    const t: TreeNode[] = [
      { ...node("a", "indicator"), payload: { indicator: "mrr" } },
      { ...node("p", "plan"), payload: { indicators: ["mrr", "clientes"] } },
      { ...node("r", "indicator"), payload: { indicator: "mrr", responsible: "Ana" } },
    ];
    // v1.1: indicador pede POR NÓ (o servidor lê o payload pelo id);
    // indicadores citados pelo plano seguem por chave, sem repetir.
    expect(indicatorRequestsOf(t)).toEqual([
      { key: "mrr", responsible: null, nodeId: "a" },
      { key: "mrr", responsible: null },
      { key: "clientes", responsible: null },
      { key: "mrr", responsible: "Ana", nodeId: "r" },
    ]);
  });
});
