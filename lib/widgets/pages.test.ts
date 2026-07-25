// Versão: 1.0 | Data: 25/07/2026
// Testes das páginas de widget (pages.ts): coleta de membros, elegibilidade e
// a detecção de mescla no drop (findMergeTarget) nos limites das tolerâncias.
import { describe, expect, it } from "vitest";

import type { GridPosition, VisualType, Widget } from "./types";
import {
  canBePage,
  collectPageMembers,
  findMergeTarget,
  isPageHost,
  pageMembersOf,
} from "./pages";

const w = (
  id: string,
  visual: VisualType = "barra",
  settings: Widget["settings"] = {}
) =>
  ({ id, visual_type: visual, settings }) as Pick<
    Widget,
    "id" | "visual_type" | "settings"
  >;

const pos = (x: number, y: number, wd: number, h: number): GridPosition => ({
  x,
  y,
  w: wd,
  h,
});

describe("pageMembersOf / collectPageMembers", () => {
  it("lê settings.pages com robustez a lixo", () => {
    expect(pageMembersOf(w("a", "barra", { pages: ["b", "c"] }))).toEqual([
      "b",
      "c",
    ]);
    expect(pageMembersOf(w("a"))).toEqual([]);
    expect(
      pageMembersOf(w("a", "barra", { pages: ["", "b"] as string[] }))
    ).toEqual(["b"]);
    expect(isPageHost(w("a", "barra", { pages: ["b"] }))).toBe(true);
    expect(isPageHost(w("a"))).toBe(false);
  });

  it("coleta membros de todos os hosts", () => {
    const set = collectPageMembers([
      w("a", "barra", { pages: ["m1"] }),
      w("b", "kpi", { pages: ["m2", "m3"] }),
      w("m1"),
    ]);
    expect([...set].sort()).toEqual(["m1", "m2", "m3"]);
  });
});

describe("canBePage", () => {
  it("exclui filtros/decorativos e a linha legada", () => {
    expect(canBePage(w("a", "barra"))).toBe(true);
    expect(canBePage(w("a", "filtro"))).toBe(false);
    expect(canBePage(w("a", "filtro_campo"))).toBe(false);
    expect(canBePage(w("a", "imagem"))).toBe(false);
    expect(canBePage(w("a", "linha_divisoria"))).toBe(false);
    // Forma "linha" legada (forma + shape.kind) também fica de fora.
    expect(canBePage(w("a", "forma", { shape: { kind: "linha" } }))).toBe(false);
  });
});

describe("findMergeTarget", () => {
  const dragged = w("drag");

  it("casa drop quase exato sobre widget do mesmo tamanho", () => {
    const target = findMergeTarget(pos(2, 3, 59, 31), dragged, [
      { widget: w("alvo"), pos: pos(0, 0, 59, 31) },
    ]);
    expect(target).toBe("alvo");
  });

  it("rejeita sobreposição abaixo do mínimo (65% do menor)", () => {
    // Deslocado ~metade: interseção 30×31 de 59×31 → ~50% < 65%.
    const target = findMergeTarget(pos(29, 0, 59, 31), dragged, [
      { widget: w("alvo"), pos: pos(0, 0, 59, 31) },
    ]);
    expect(target).toBeNull();
  });

  it("aceita tamanhos APROXIMADOS (25%/folga) e rejeita muito diferentes", () => {
    // 59×31 sobre 49×27: Δw=10 ≤ 25%·59≈14.75 → dentro da tolerância.
    expect(
      findMergeTarget(pos(0, 0, 49, 27), dragged, [
        { widget: w("alvo"), pos: pos(0, 0, 59, 31) },
      ])
    ).toBe("alvo");
    // KPI 39×15 sobre tabela 59×31: Δw=20 > tolerância → null.
    expect(
      findMergeTarget(pos(0, 0, 39, 15), dragged, [
        { widget: w("alvo"), pos: pos(0, 0, 59, 31) },
      ])
    ).toBeNull();
  });

  it("múltiplos candidatos → o de MAIOR sobreposição vence", () => {
    const target = findMergeTarget(pos(0, 0, 59, 31), dragged, [
      { widget: w("longe"), pos: pos(10, 0, 59, 31) },
      { widget: w("perto"), pos: pos(2, 0, 59, 31) },
    ]);
    expect(target).toBe("perto");
  });

  it("ignora o próprio arrastado, inelegíveis, e dragged host → null", () => {
    expect(
      findMergeTarget(pos(0, 0, 59, 31), dragged, [
        { widget: w("drag"), pos: pos(0, 0, 59, 31) },
        { widget: w("filtro", "filtro"), pos: pos(0, 0, 59, 31) },
      ])
    ).toBeNull();
    // Arrastado que JÁ é host não mescla (dissolveria as páginas dele).
    expect(
      findMergeTarget(pos(0, 0, 59, 31), w("h", "barra", { pages: ["x"] }), [
        { widget: w("alvo"), pos: pos(0, 0, 59, 31) },
      ])
    ).toBeNull();
    // Alvo que já é host PODE (vira "adicionar página").
    expect(
      findMergeTarget(pos(0, 0, 59, 31), dragged, [
        { widget: w("alvo", "barra", { pages: ["x"] }), pos: pos(0, 0, 59, 31) },
      ])
    ).toBe("alvo");
  });
});
