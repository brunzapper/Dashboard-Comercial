// Versão: 1.1 | Data: 01/10/2026
// v1.1 (01/10/2026): a anotação não é filtrável (ver model.ts v1.4).
// Versão: 1.0 | Data: 30/09/2026
// Os validadores do modelo que o SERVIDOR usa antes de gravar em
// `tree_nodes` (0148): o escopo que chega do cliente e os ids de nó. São a
// porta da tabela — `scope_id` vira texto livre no banco.
import { describe, expect, it } from "vitest";

import {
  branchKindDisabledReason,
  TREE_ALWAYS_VISIBLE_KINDS,
  TREE_FILTERABLE_KINDS,
  isTreeNodeRef,
  normalizeMapKey,
  parseTreeScope,
  refUuid,
} from "./model";

const UUID = "00000000-0000-4000-a000-000000000001";

describe("parseTreeScope", () => {
  it("registro exige uuid", () => {
    expect(parseTreeScope({ kind: "record", recordId: UUID })).toEqual({
      kind: "record",
      recordId: UUID,
    });
    expect(parseTreeScope({ kind: "record", recordId: "x; drop" })).toBeNull();
  });

  it("mapa exige a chave JÁ normalizada", () => {
    expect(parseTreeScope({ kind: "livre", mapKey: "plano-2026" })).toEqual({
      kind: "livre",
      mapKey: "plano-2026",
    });
    expect(parseTreeScope({ kind: "livre", mapKey: "Plano 2026" })).toBeNull();
  });

  it("qualquer outra coisa é null", () => {
    expect(parseTreeScope(null)).toBeNull();
    expect(parseTreeScope({ kind: "outro" })).toBeNull();
  });
});

describe("normalizeMapKey", () => {
  it("minúsculas, hífen no lugar do resto", () => {
    expect(normalizeMapKey(" Planejamento Q4! ")).toBe("planejamento-q4");
  });

  it("vazio é null", () => {
    expect(normalizeMapKey("  ")).toBeNull();
    expect(normalizeMapKey(undefined)).toBeNull();
  });
});

describe("ids de nó", () => {
  it("aceita os formatos lógicos", () => {
    expect(isTreeNodeRef(`note:${UUID}`)).toBe(true);
    expect(isTreeNodeRef("occ:rule-1:3")).toBe(true);
    expect(isTreeNodeRef("drop table")).toBe(false);
    expect(isTreeNodeRef("x".repeat(300))).toBe(false);
  });

  it("refUuid só devolve uuid do prefixo pedido", () => {
    expect(refUuid(`note:${UUID}`, "note")).toBe(UUID);
    expect(refUuid(`task:${UUID}`, "note")).toBeNull();
    expect(refUuid("note:abc", "note")).toBeNull();
  });
});

describe("tipos de galho", () => {
  it("comentário é do feed de um registro — desabilitado no mapa, com motivo", () => {
    expect(branchKindDisabledReason("comment", "livre")).toMatch(/registro/);
    expect(branchKindDisabledReason("comment", "record")).toBeNull();
    expect(branchKindDisabledReason("note", "livre")).toBeNull();
    expect(branchKindDisabledReason("task", "livre")).toBeNull();
  });
});

describe("filtro 'O que exibir'", () => {
  it("anotação nunca é filtrável — ela é o que se desenha na árvore", () => {
    expect(TREE_FILTERABLE_KINDS as readonly string[]).not.toContain("note");
    expect(TREE_ALWAYS_VISIBLE_KINDS).toContain("note");
  });
});
