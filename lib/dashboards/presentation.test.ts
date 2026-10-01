// Versão: 1.0 | Data: 01/10/2026
import { describe, expect, it } from "vitest";

import { presentationKeyAction, slideTabIds, stepSlide } from "./presentation";

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
