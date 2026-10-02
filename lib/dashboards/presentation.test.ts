// Versão: 1.3 | Data: 02/10/2026
// v1.3 (02/10/2026): esqueleto de slide (conteúdo, altura, aba sem esqueleto)
//   e aviso de transbordo.
// v1.2 (02/10/2026): palco 16:9 (stageScale), padrão do modo pelo estilo
//   (effectivePresentation) e ordem de leitura da entrada (enterOrder).
// v1.1 (01/10/2026): pré-render (ordem e prontidão) e ajuste à tela.
import { describe, expect, it } from "vitest";

import {
  STAGE_H,
  STAGE_W,
  effectivePresentation,
  enterOrder,
  stageScale,
  fitRowHeight,
  SLIDE_FOOTER_H,
  SLIDE_HEADER_H,
  SLIDE_HEADLINE_H,
  slideFrameContent,
  slideFrameHeight,
  slideOverflows,
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

describe("palco 16:9", () => {
  it("cabe pelo menor eixo (letterbox)", () => {
    expect(stageScale(1920, 1080)).toBeCloseTo(1.5);
    expect(stageScale(1366, 768)).toBeCloseTo(1366 / STAGE_W);
    expect(stageScale(1000, 1000)).toBeCloseTo(1000 / STAGE_W);
    expect(stageScale(2560, 1080)).toBeCloseTo(1080 / STAGE_H);
    expect(stageScale(0, 0)).toBe(1);
  });

  it("padrão pelo estilo; o que o dashboard fixou vence", () => {
    expect(effectivePresentation(undefined, false)).toEqual({ fit: "altura", transition: "nenhuma" });
    expect(effectivePresentation(undefined, true)).toEqual({ fit: "palco", transition: "suave" });
    expect(effectivePresentation({ fit: "altura" }, true)).toEqual({ fit: "altura", transition: "suave" });
    expect(effectivePresentation({ fit: "xpto" }, false).fit).toBe("altura");
  });

  it("entrada na ordem de leitura (linha, depois coluna)", () => {
    const rank = enterOrder([
      { id: "c", x: 60, y: 10 },
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 0, y: 10 },
    ]);
    expect([rank.get("a"), rank.get("b"), rank.get("c")]).toEqual([0, 1, 2]);
  });
});

describe("esqueleto de slide", () => {
  const slide = { kicker: "Comercial", footer: "Fonte: CRM", showDate: true, showNumber: true };
  it("kicker da aba vence o do dashboard; headline só da aba", () => {
    const c = slideFrameContent(slide, { headline: "MRR cresce", kicker: "Receita" });
    expect(c).toEqual({ kicker: "Receita", headline: "MRR cresce", footer: "Fonte: CRM", date: true, number: true });
    expect(slideFrameContent(slide, {})?.kicker).toBe("Comercial");
  });
  it("aba sem esqueleto (capa) e dashboard sem nada ⇒ null", () => {
    expect(slideFrameContent(slide, { frame: false, headline: "x" })).toBeNull();
    expect(slideFrameContent(undefined, {})).toBeNull();
    expect(slideFrameContent({}, { headline: "  " })).toBeNull();
  });
  it("altura descontada do palco soma só as faixas presentes", () => {
    expect(slideFrameHeight(null)).toBe(0);
    expect(slideFrameHeight(slideFrameContent(slide, { headline: "h" }))).toBe(
      SLIDE_HEADER_H + SLIDE_HEADLINE_H + SLIDE_FOOTER_H
    );
    expect(slideFrameHeight(slideFrameContent({ footer: "f" }, {}))).toBe(SLIDE_FOOTER_H);
  });
});

describe("aviso de transbordo", () => {
  const base = { baseCols: 120, innerW: 1152, innerH: 624 };
  it("cabe enquanto o piso do ajuste acomoda as linhas", () => {
    // linha natural = 9,6px; piso 0,6 ⇒ 5,76px/linha ⇒ 108 linhas em 624px
    expect(slideOverflows({ ...base, contentRows: 64 })).toBe(false);
    expect(slideOverflows({ ...base, contentRows: 108 })).toBe(false);
    expect(slideOverflows({ ...base, contentRows: 140 })).toBe(true);
  });
  it("sem conteúdo ou medida ⇒ sem aviso", () => {
    expect(slideOverflows({ ...base, contentRows: 0 })).toBe(false);
    expect(slideOverflows({ ...base, contentRows: 200, innerH: 0 })).toBe(false);
  });
});
