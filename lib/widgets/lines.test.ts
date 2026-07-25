// Versão: 1.1 | Data: 25/07/2026
// v1.1 (25/07/2026): isLineShapeWidget cobre a identidade nova
//   ('linha_divisoria') e a legada (forma + shape.kind linha).
// Testes da geometria da linha divisória (lib/widgets/lines.ts): traçado H/V em
// unidades de grid fracionárias, bounding box inteiro derivado, conversão
// px↔grid coincidindo com o itemRect dos conectores em coordenadas inteiras,
// trava de eixo (sempre H ou V), clamp sem encurtar e round determinístico.
import { describe, expect, it } from "vitest";

import { itemRect, type GridMetrics } from "@/lib/widgets/connectors";
import {
  axisLock,
  clampLine,
  gridPtToPx,
  isLineShapeWidget,
  lineAtCell,
  lineFromRect,
  lineGridBBox,
  lineOf,
  pxDeltaToGrid,
  roundLine,
  translateLine,
} from "@/lib/widgets/lines";
import type { Widget } from "@/lib/widgets/types";

const M: GridMetrics = { cellW: 90, rowH: 30, mx: 12, my: 12 };

const widgetLike = (over: Partial<Widget>): Widget =>
  ({ visual_type: "forma", settings: { shape: { kind: "linha" } }, ...over }) as Widget;

describe("isLineShapeWidget", () => {
  it("identidade legada: visual_type forma E shape.kind linha", () => {
    expect(isLineShapeWidget(widgetLike({}))).toBe(true);
    expect(
      isLineShapeWidget(
        widgetLike({ settings: { shape: { kind: "retangulo" } } })
      )
    ).toBe(false);
    // visual_type "linha" é o GRÁFICO de linha — não confundir com a forma.
    expect(
      isLineShapeWidget(
        widgetLike({ visual_type: "linha" as Widget["visual_type"] })
      )
    ).toBe(false);
    expect(isLineShapeWidget(widgetLike({ settings: {} }))).toBe(false);
  });

  it("identidade nova (0100): visual_type linha_divisoria, com qualquer settings", () => {
    expect(
      isLineShapeWidget(widgetLike({ visual_type: "linha_divisoria" }))
    ).toBe(true);
    // Mesmo sem shape nos settings (o traçado deriva do grid_position).
    expect(
      isLineShapeWidget(
        widgetLike({ visual_type: "linha_divisoria", settings: {} })
      )
    ).toBe(true);
  });
});

describe("lineFromRect / lineOf", () => {
  it("rect largo vira linha média horizontal; alto vira vertical", () => {
    expect(lineFromRect({ x: 2, y: 4, w: 6, h: 2 })).toEqual({
      x1: 2,
      y1: 5,
      x2: 8,
      y2: 5,
    });
    expect(lineFromRect({ x: 2, y: 4, w: 2, h: 6 })).toEqual({
      x1: 3,
      y1: 4,
      x2: 3,
      y2: 10,
    });
  });

  it("lineOf usa o traçado persistido quando íntegro, senão a linha média", () => {
    const pos = { x: 0, y: 0, w: 4, h: 2 };
    const line = { x1: 1.5, y1: 2.25, x2: 7.5, y2: 2.25 };
    expect(
      lineOf({ settings: { shape: { kind: "linha", line } } }, pos)
    ).toEqual(line);
    expect(lineOf({ settings: { shape: { kind: "linha" } } }, pos)).toEqual(
      lineFromRect(pos)
    );
    // Traçado corrompido (NaN) cai no fallback.
    expect(
      lineOf(
        { settings: { shape: { kind: "linha", line: { ...line, x2: NaN } } } },
        pos
      )
    ).toEqual(lineFromRect(pos));
  });
});

describe("lineGridBBox", () => {
  it("floor/ceil com mínimo 1×1 (linha fina no eixo perpendicular)", () => {
    expect(lineGridBBox({ x1: 1.2, y1: 3.4, x2: 6.9, y2: 3.4 })).toEqual({
      x: 1,
      y: 3,
      w: 6, // ceil(6.9) - 1
      h: 1, // ceil(3.4) - 3 = 1
    });
    // y inteiro exato: ceil-floor = 0 → sobe para 1.
    expect(lineGridBBox({ x1: 0, y1: 3, x2: 5, y2: 3 })).toEqual({
      x: 0,
      y: 3,
      w: 5,
      h: 1,
    });
  });

  it("pontas em qualquer ordem e clamp a ≥ 0", () => {
    expect(lineGridBBox({ x1: 6.9, y1: 3.4, x2: 1.2, y2: 3.4 })).toEqual(
      lineGridBBox({ x1: 1.2, y1: 3.4, x2: 6.9, y2: 3.4 })
    );
    expect(lineGridBBox({ x1: -1.5, y1: -0.5, x2: 2, y2: -0.5 })).toEqual({
      x: 0,
      y: 0,
      w: 2,
      h: 1,
    });
  });

  it("linha de comprimento zero rende 1×1", () => {
    expect(lineGridBBox({ x1: 2, y1: 2, x2: 2, y2: 2 })).toEqual({
      x: 2,
      y: 2,
      w: 1,
      h: 1,
    });
  });
});

describe("translateLine / lineAtCell", () => {
  it("translada as duas pontas", () => {
    expect(
      translateLine({ x1: 1, y1: 2, x2: 5, y2: 2 }, 0.5, -1)
    ).toEqual({ x1: 1.5, y1: 1, x2: 5.5, y2: 1 });
  });

  it("lineAtCell leva o canto mínimo à célula, preservando o desenho", () => {
    const l = { x1: 3.25, y1: 7.5, x2: 8.25, y2: 7.5 };
    const moved = lineAtCell(l, 1, 2);
    expect(moved).toEqual({ x1: 1, y1: 2, x2: 6, y2: 2 });
    // Comprimento preservado.
    expect(moved.x2 - moved.x1).toBeCloseTo(l.x2 - l.x1);
  });
});

describe("gridPtToPx / pxDeltaToGrid", () => {
  it("coincide com o canto do itemRect dos conectores em inteiros", () => {
    const r = itemRect({ x: 3, y: 5, w: 2, h: 2 }, M);
    const p = gridPtToPx({ x: 3, y: 5 }, M);
    expect(Math.round(p.x)).toBe(r.left);
    expect(Math.round(p.y)).toBe(r.top);
  });

  it("ida-e-volta: delta px → grid → px devolve o delta original", () => {
    const d = pxDeltaToGrid(153, -47, M);
    expect(d.dx * (M.cellW + M.mx)).toBeCloseTo(153);
    expect(d.dy * (M.rowH + M.my)).toBeCloseTo(-47);
  });

  it("métrica degenerada (cellW 0 antes da medição) não divide por zero", () => {
    const d = pxDeltaToGrid(100, 100, { cellW: -12, rowH: -12, mx: 12, my: 12 });
    expect(d).toEqual({ dx: 0, dy: 0 });
  });
});

describe("axisLock", () => {
  it("gesto mais largo que alto vira horizontal no y médio", () => {
    expect(axisLock({ x1: 1, y1: 2, x2: 6, y2: 3 })).toEqual({
      x1: 1,
      y1: 2.5,
      x2: 6,
      y2: 2.5,
    });
  });

  it("gesto mais alto que largo vira vertical no x médio", () => {
    expect(axisLock({ x1: 2, y1: 1, x2: 3, y2: 8 })).toEqual({
      x1: 2.5,
      y1: 1,
      x2: 2.5,
      y2: 8,
    });
  });

  it("empate favorece a horizontal (linha já H fica intacta)", () => {
    const h = { x1: 0, y1: 4, x2: 5, y2: 4 };
    expect(axisLock(h)).toEqual(h);
  });
});

describe("clampLine", () => {
  it("dentro dos limites é identidade", () => {
    const l = { x1: 1.5, y1: 2, x2: 6.5, y2: 2 };
    expect(clampLine(l, 12, 20)).toEqual(l);
  });

  it("passou da borda → translada de volta SEM encurtar", () => {
    const l = { x1: 9, y1: 2, x2: 14, y2: 2 };
    const c = clampLine(l, 12, 20);
    expect(c).toEqual({ x1: 7, y1: 2, x2: 12, y2: 2 });
    expect(c.x2 - c.x1).toBe(l.x2 - l.x1);
    const neg = clampLine({ x1: -2, y1: 2, x2: 3, y2: 2 }, 12, 20);
    expect(neg).toEqual({ x1: 0, y1: 2, x2: 5, y2: 2 });
  });

  it("maior que o canvas encosta em 0 e encurta só o excedente", () => {
    expect(clampLine({ x1: -3, y1: 2, x2: 15, y2: 2 }, 12, 20)).toEqual({
      x1: 0,
      y1: 2,
      x2: 12,
      y2: 2,
    });
  });
});

describe("roundLine", () => {
  it("2 casas por padrão; determinístico (aplicar duas vezes = uma)", () => {
    const l = { x1: 1.004999, y1: 2.005, x2: 3.333333, y2: 2.005 };
    const once = roundLine(l);
    expect(once).toEqual({ x1: 1, y1: 2.01, x2: 3.33, y2: 2.01 });
    expect(roundLine(once)).toEqual(once);
  });
});
