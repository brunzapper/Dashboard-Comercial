// Versão: 1.0 | Data: 03/08/2026
// Testes dos helpers puros do rastro do Ponteiro Laser: prune por idade
// preserva referência quando nada muda (o overlay pula render), a opacidade
// esmaece monotonicamente e traços são independentes (beginStroke nunca
// conecta ao anterior; appendPoint ignora jitter).
import { describe, expect, it } from "vitest";

import {
  TRAIL_TTL_MS,
  appendPoint,
  beginStroke,
  pruneStrokes,
  trailOpacity,
  type TrailStroke,
} from "@/lib/laser-trail";

const pt = (x: number, y: number, t: number) => ({ x, y, t });

describe("pruneStrokes", () => {
  it("descarta pontos velhos e traços que ficaram vazios", () => {
    const strokes: TrailStroke[] = [
      { points: [pt(0, 0, 0), pt(10, 0, 900)] },
      { points: [pt(5, 5, 100)] },
    ];
    const out = pruneStrokes(strokes, 1000, 500);
    expect(out).toEqual([{ points: [pt(10, 0, 900)] }]);
  });

  it("preserva a MESMA referência quando nada expirou", () => {
    const strokes: TrailStroke[] = [{ points: [pt(0, 0, 800)] }];
    expect(pruneStrokes(strokes, 1000, 500)).toBe(strokes);
  });

  it("array vazio segue a mesma referência", () => {
    const strokes: TrailStroke[] = [];
    expect(pruneStrokes(strokes, 1000)).toBe(strokes);
  });
});

describe("trailOpacity", () => {
  it("1 no nascimento, 0 no fim da vida, clampada fora do range", () => {
    expect(trailOpacity(0)).toBe(1);
    expect(trailOpacity(-50)).toBe(1);
    expect(trailOpacity(TRAIL_TTL_MS)).toBe(0);
    expect(trailOpacity(TRAIL_TTL_MS * 2)).toBe(0);
  });

  it("esmaece monotonicamente com a idade", () => {
    const a = trailOpacity(200);
    const b = trailOpacity(1200);
    const c = trailOpacity(2200);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(0);
  });
});

describe("appendPoint / beginStroke", () => {
  it("acrescenta ao último traço e ignora jitter abaixo de minDist", () => {
    const strokes = beginStroke([], pt(0, 0, 0));
    appendPoint(strokes, pt(10, 0, 16), 2);
    appendPoint(strokes, pt(10.5, 0.5, 32), 2); // < 2px do anterior: ignora
    expect(strokes).toHaveLength(1);
    expect(strokes[0].points).toEqual([pt(0, 0, 0), pt(10, 0, 16)]);
  });

  it("beginStroke nunca conecta ao traço anterior", () => {
    const strokes = beginStroke([], pt(0, 0, 0));
    appendPoint(strokes, pt(10, 0, 16));
    beginStroke(strokes, pt(100, 100, 500));
    appendPoint(strokes, pt(110, 100, 516));
    expect(strokes).toHaveLength(2);
    expect(strokes[1].points[0]).toEqual(pt(100, 100, 500));
  });

  it("appendPoint sem traço aberto abre um (pointerdown perdido)", () => {
    const strokes = appendPoint([], pt(1, 2, 3));
    expect(strokes).toEqual([{ points: [pt(1, 2, 3)] }]);
  });
});
