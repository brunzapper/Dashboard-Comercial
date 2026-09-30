// Versão: 1.0 | Data: 30/09/2026
// O parse das linhas de `tree_nodes` (0133 + 0148). O que se protege:
//  - '-' é "soltar na raiz" e null é "sem exceção" — uma linha só de
//    geometria NÃO pode mover o nó (antes do 0148 null virava raiz);
//  - a anotação carrega o próprio pai, o estado de etapa e o Resultado;
//  - tarefa de mapa só existe no escopo livre.
import { describe, expect, it } from "vitest";

import { parseTreeNodeRows, type TreeNodeRow } from "./rows";

const row = (over: Partial<TreeNodeRow>): TreeNodeRow => ({
  id: "00000000-0000-4000-a000-000000000001",
  kind: "note",
  ref_id: null,
  node_ref: null,
  parent_ref: null,
  label: null,
  body: null,
  position: 0,
  created_at: "2026-09-30T10:00:00+00:00",
  ...over,
});

describe("exceção sobre fato derivado", () => {
  it("'-' solta na raiz", () => {
    const out = parseTreeNodeRows([row({ node_ref: "task:x", parent_ref: "-" })]);
    expect(out.overrides).toEqual([
      { nodeRef: "task:x", parentRef: null, position: 0 },
    ]);
  });

  it("parent_ref null é SÓ geometria — não mexe no pai", () => {
    const out = parseTreeNodeRows([
      row({ node_ref: "occ:r:3", parent_ref: null, offset_x: 40, direction: "v" }),
    ]);
    expect(out.overrides).toEqual([]);
    expect(out.geometry).toEqual([
      { nodeRef: "occ:r:3", offsetX: 40, offsetY: 0, direction: "v" },
    ]);
  });

  it("linha sem offset nem direção não gera geometria", () => {
    const out = parseTreeNodeRows([row({ node_ref: "task:x", parent_ref: "occ:1" })]);
    expect(out.geometry).toEqual([]);
  });

  it("direção fora do contrato é ignorada", () => {
    const out = parseTreeNodeRows([
      row({ node_ref: "task:x", direction: "diagonal", offset_y: 5 }),
    ]);
    expect(out.geometry[0].direction).toBeNull();
  });
});

describe("anotação", () => {
  it("texto livre, com o pai na própria linha", () => {
    const out = parseTreeNodeRows([
      row({ label: "Validar orçamento", parent_ref: "note:abc" }),
    ]);
    expect(out.facts[0]).toMatchObject({
      id: "note:00000000-0000-4000-a000-000000000001",
      kind: "note",
      label: "Validar orçamento",
      status: null,
      goal: false,
      at: "2026-09-30",
    });
    expect(out.overrides).toEqual([
      { nodeRef: "note:00000000-0000-4000-a000-000000000001", parentRef: "note:abc" },
    ]);
  });

  it("etapa usa o vocabulário das tarefas (a Root soma as duas)", () => {
    const [aberta] = parseTreeNodeRows([row({ status: "pendente" })]).facts;
    const [feita] = parseTreeNodeRows([row({ status: "concluida" })]).facts;
    expect(aberta.status).toBe("aberta");
    expect(feita.status).toBe("concluída");
  });

  it("Resultado esperado", () => {
    const [f] = parseTreeNodeRows([row({ is_goal: true })]).facts;
    expect(f.goal).toBe(true);
  });

  it("'-' é raiz EXPLÍCITA; vazio segue a forma", () => {
    const raiz = parseTreeNodeRows([row({ parent_ref: "-" })]);
    expect(raiz.overrides[0].parentRef).toBeNull();
    const derivada = parseTreeNodeRows([row({ parent_ref: null })]);
    expect(derivada.overrides).toEqual([]);
  });

  it("sem rótulo, o nome do tipo", () => {
    const [f] = parseTreeNodeRows([row({ label: "  " })]).facts;
    expect(f.label).toBe("Anotação");
  });
});

describe("tarefa de mapa", () => {
  const taskRow = row({
    kind: "task",
    ref_id: "00000000-0000-4000-a000-00000000000f",
    parent_ref: "note:abc",
    offset_x: 12,
  });

  it("só no escopo livre", () => {
    expect(parseTreeNodeRows([taskRow]).mapTasks).toEqual([]);
    const out = parseTreeNodeRows([taskRow], { allowMapTasks: true });
    expect(out.mapTasks).toEqual([
      {
        rowId: taskRow.id,
        taskId: "00000000-0000-4000-a000-00000000000f",
        parentRef: "note:abc",
      },
    ]);
    expect(out.geometry[0].nodeRef).toBe(
      "task:00000000-0000-4000-a000-00000000000f"
    );
  });
});
