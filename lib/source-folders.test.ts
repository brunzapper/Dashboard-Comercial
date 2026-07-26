// Versão: 1.0 | Data: 26/07/2026
// Testes das PASTAS DE BASES (0107) — agrupamento de exibição puro
// (lib/source-folders.ts): implícita primeiro, pastas por sortOrder, ordem do
// catálogo preservada dentro do grupo, grupo vazio omitido (inclui pasta
// esvaziada por um catálogo recortado — escopo de board/RLS), sub nunca em
// roots (resolve a pasta pela PAI) e o re-sequenciamento dos botões ↑/↓.
import { describe, expect, it } from "vitest";

import {
  folderIdOfSource,
  groupSourcesByFolder,
  hasFolderNav,
  resequenceAfterMove,
  type SourceFolder,
} from "@/lib/source-folders";
import { BUILTIN_SOURCES, type SourceDef } from "@/lib/sources";

const FOLDERS: SourceFolder[] = [
  { id: "f-out", label: "Outbound", sortOrder: 1 },
  { id: "f-in", label: "Inbound", sortOrder: 0 },
];

function src(key: string, extra: Partial<SourceDef> = {}): SourceDef {
  return {
    key,
    recordType: key,
    label: key,
    shortLabel: key,
    defaultPeriodField: "source_created_at",
    builtin: false,
    manualEntry: true,
    ...extra,
  };
}

// Catálogo sintético na ordem do loader: builtins (sem pasta), raízes com
// pasta e uma sub (herda a pasta da pai leads → f-in).
const CATALOG: SourceDef[] = [
  ...BUILTIN_SOURCES.map((s, i) =>
    i === 0 ? { ...s, folderId: "f-in" } : s
  ), // leads → Inbound; deals/estudo sem pasta
  src("mqls", { folderId: "f-in" }),
  src("parceiros", { folderId: "f-out" }),
  src("orfa", { folderId: "f-excluida" }), // pasta que não existe mais
  {
    ...src("leads_lite", { recordType: "lead" }),
    parentKey: "leads",
    filter: [],
  },
];

describe("groupSourcesByFolder", () => {
  it("implícita primeiro, pastas por sortOrder, ordem do catálogo no grupo", () => {
    const groups = groupSourcesByFolder(FOLDERS, CATALOG);
    expect(groups.map((g) => g.folder?.label ?? null)).toEqual([
      null,
      "Inbound",
      "Outbound",
    ]);
    // Implícita: deals/estudo (sem pasta) + orfa (folderId de pasta excluída).
    expect(groups[0].roots.map((s) => s.key)).toEqual([
      "deals",
      "estudo",
      "orfa",
    ]);
    // Ordem do catálogo preservada dentro da pasta.
    expect(groups[1].roots.map((s) => s.key)).toEqual(["leads", "mqls"]);
    expect(groups[2].roots.map((s) => s.key)).toEqual(["parceiros"]);
  });

  it("sub nunca aparece em roots", () => {
    const all = groupSourcesByFolder(FOLDERS, CATALOG).flatMap((g) => g.roots);
    expect(all.some((s) => s.key === "leads_lite")).toBe(false);
  });

  it("grupo vazio é omitido (pasta esvaziada por catálogo recortado)", () => {
    // Simula applySourceScope: só bases do Inbound sobram no catálogo.
    const scoped = CATALOG.filter(
      (s) => s.folderId === "f-in" || s.parentKey === "leads"
    );
    const groups = groupSourcesByFolder(FOLDERS, scoped);
    expect(groups.map((g) => g.folder?.label ?? null)).toEqual(["Inbound"]);
  });

  it("sem pastas: um único grupo implícito (degradação)", () => {
    const groups = groupSourcesByFolder([], CATALOG);
    expect(groups).toHaveLength(1);
    expect(groups[0].folder).toBeNull();
    expect(hasFolderNav([], CATALOG)).toBe(false);
    expect(hasFolderNav(FOLDERS, CATALOG)).toBe(true);
  });

  it("pastas sem nenhuma base: sem navegação", () => {
    const soltas = CATALOG.map((s) => ({ ...s, folderId: null }));
    expect(hasFolderNav(FOLDERS, soltas)).toBe(false);
  });
});

describe("folderIdOfSource", () => {
  it("raiz resolve a própria pasta; sub resolve pela PAI", () => {
    expect(folderIdOfSource("mqls", CATALOG, FOLDERS)).toBe("f-in");
    expect(folderIdOfSource("leads_lite", CATALOG, FOLDERS)).toBe("f-in");
  });

  it("sem pasta / pasta excluída / fonte desconhecida → null", () => {
    expect(folderIdOfSource("deals", CATALOG, FOLDERS)).toBeNull();
    expect(folderIdOfSource("orfa", CATALOG, FOLDERS)).toBeNull();
    expect(folderIdOfSource("nao_existe", CATALOG, FOLDERS)).toBeNull();
  });
});

describe("resequenceAfterMove", () => {
  const KEYS = ["a", "b", "c"];

  it("sobe/desce trocando com o vizinho", () => {
    expect(resequenceAfterMove(KEYS, "b", "up")).toEqual(["b", "a", "c"]);
    expect(resequenceAfterMove(KEYS, "b", "down")).toEqual(["a", "c", "b"]);
  });

  it("bordas e key ausente: no-op (cópia)", () => {
    expect(resequenceAfterMove(KEYS, "a", "up")).toEqual(KEYS);
    expect(resequenceAfterMove(KEYS, "c", "down")).toEqual(KEYS);
    expect(resequenceAfterMove(KEYS, "x", "up")).toEqual(KEYS);
    expect(resequenceAfterMove(KEYS, "a", "up")).not.toBe(KEYS);
  });
});
