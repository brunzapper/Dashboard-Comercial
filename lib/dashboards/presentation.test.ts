// Versão: 1.1 | Data: 01/10/2026
// v1.1 (01/10/2026): pré-render (ordem e prontidão) e ajuste à tela.
import { describe, expect, it } from "vitest";

import {
  fitRowHeight,
  FIT_MAX_FACTOR,
  FIT_MIN_FACTOR,
  presentationKeyAction,
  slideTabIds,
  stepSlide,
  warmupOrder,
  warmupState,
} from "./presentation";

describe("modo Apresentar", () => {
  const tabs = [{ id: "capa" }, { id: "painel" }, { id: "arvore" }, { id: "fontes" }];
  it("abas escondidas ficam fora; esconder tudo cai em todas", () => {
    expect(slideTabIds(tabs, ["arvore"])).toEqual(["capa", "painel", "fontes"]);
    expect(slideTabIds(tabs, tabs.map((t) => t.id))).toHaveLength(4);
    expect(slideTabIds([], undefined)).toEqual([""]);
  });
  it("navega com clamp nas pontas", () => {
    const ids = ["a", "b", "c"];
    expect(stepSlide(ids, "a", "prev")).toBe("a");
    expect(stepSlide(ids, "a", "next")).toBe("b");
    expect(stepSlide(ids, "c", "next")).toBe("c");
    expect(stepSlide(ids, "b", "last")).toBe("c");
    // aba atual fora dos slides (escondida) parte do primeiro
    expect(stepSlide(ids, "zz", "next")).toBe("b");
  });
  it("mapa de teclas", () => {
    expect(presentationKeyAction("ArrowRight")).toBe("next");
    expect(presentationKeyAction(" ")).toBe("next");
    expect(presentationKeyAction("PageUp")).toBe("prev");
    expect(presentationKeyAction("Escape")).toBe("exit");
    expect(presentationKeyAction("a")).toBeNull();
  });
});

describe("pré-render dos slides (v1.1)", () => {
  it("monta o atual, depois os seguintes, depois os anteriores", () => {
    expect(warmupOrder(["a", "b", "c", "d"], "c")).toEqual(["c", "d", "b", "a"]);
    expect(warmupOrder(["a", "b"], "zz")).toEqual(["a", "b"]);
  });
  it("só começa depois de montar, com o lote do engine e todos os widgets prontos", () => {
    const m = new Map([["w1", true], ["w2", false]]);
    expect(warmupState(m, true, false)).toEqual({ total: 2, ready: 1, done: false });
    m.set("w2", true);
    expect(warmupState(m, false, false).done).toBe(false); // ainda montando
    expect(warmupState(m, true, true).done).toBe(false); // lote a caminho
    expect(warmupState(m, true, false).done).toBe(true);
    expect(warmupState(new Map(), true, false).done).toBe(true); // nada a esperar
  });
});

describe("ajuste à tela (v1.1)", () => {
  it("estica até ocupar a altura disponível", () => {
    expect(fitRowHeight(1000, 80, 10)).toBe(12.5);
  });
  it("encolhe com piso e estica com teto", () => {
    expect(fitRowHeight(100, 80, 10)).toBe(10 * FIT_MIN_FACTOR);
    expect(fitRowHeight(10000, 10, 10)).toBe(10 * FIT_MAX_FACTOR);
  });
  it("sem medida ou sem conteúdo devolve a natural", () => {
    expect(fitRowHeight(0, 80, 10)).toBe(10);
    expect(fitRowHeight(900, 0, 10)).toBe(10);
  });
});
