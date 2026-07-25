// Versão: 1.0 | Data: 25/07/2026
// Testes do espaço de grid v2 (grid-space.ts): conversão legado (base 12,
// margens 12px) → fino (base 120, sem margens), idempotência e pisos.
import { describe, expect, it } from "vitest";

import type { DashboardSettings, Widget } from "./types";
import {
  BASE_COLS,
  GRID_MAX_COLS,
  GRID_MAX_ROWS,
  GRID_VERSION,
  convertLegacyCanvas,
  convertLegacyLine,
  convertLegacyPos,
  isFineGrid,
  normalizeGridSpace,
} from "./grid-space";

const widget = (over: Partial<Widget>): Widget =>
  ({
    id: "w1",
    dashboard_id: "d1",
    title: "t",
    visual_type: "tabela",
    source: "records",
    dimensions: [],
    metrics: [],
    filters: [],
    grid_position: {},
    sort_order: 0,
    settings: {},
    ...over,
  }) as Widget;

describe("convertLegacyPos", () => {
  it("escala ×10 no X e ×4 no Y, com −1 em w/h para preservar o vão", () => {
    expect(convertLegacyPos({ x: 6, y: 8, w: 6, h: 8 })).toEqual({
      x: 60,
      y: 32,
      w: 59,
      h: 31,
    });
  });

  it("nunca produz w/h abaixo de 1", () => {
    // Degenerado (w=0 não existe na prática, mas o piso protege).
    expect(convertLegacyPos({ x: 0, y: 0, w: 0, h: 0 })).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
  });

  it("adjacentes legados continuam adjacentes com vão de 1 célula", () => {
    const a = convertLegacyPos({ x: 0, y: 0, w: 6, h: 8 });
    const b = convertLegacyPos({ x: 6, y: 0, w: 6, h: 8 });
    expect(a.x + a.w).toBe(59); // vão de 1 célula fina até x=60
    expect(b.x).toBe(60);
  });
});

describe("convertLegacyLine", () => {
  it("escala fracionária sem o −1", () => {
    expect(convertLegacyLine({ x1: 1.5, y1: 2, x2: 7.5, y2: 2 })).toEqual({
      x1: 15,
      y1: 8,
      x2: 75,
      y2: 8,
    });
  });
});

describe("convertLegacyCanvas", () => {
  it("carimba gridVersion e grava rowHeight EXPLÍCITO (default 30 → 10.5)", () => {
    const out = convertLegacyCanvas(undefined);
    expect(out.gridVersion).toBe(GRID_VERSION);
    expect(out.rowHeight).toBe(10.5); // (30+12)/4 — fidelidade vertical do legado
    expect(out.cols).toBeUndefined();
  });

  it("converte rowHeight custom por (R+12)/4 e escala cols/rows", () => {
    const out = convertLegacyCanvas({ cols: 24, rows: 50, rowHeight: 20 });
    expect(out.rowHeight).toBe(8); // (20+12)/4
    expect(out.cols).toBe(240);
    expect(out.rows).toBe(200);
  });

  it("clampa cols/rows convertidos aos tetos finos", () => {
    const out = convertLegacyCanvas({ cols: 48 * 2, rows: 300 });
    expect(out.cols).toBe(GRID_MAX_COLS);
    expect(out.rows).toBe(GRID_MAX_ROWS);
  });
});

describe("normalizeGridSpace", () => {
  it("é no-op (mesmas referências) quando o board já é fino", () => {
    const settings: DashboardSettings = {
      canvas: { gridVersion: GRID_VERSION, baseCols: BASE_COLS },
    };
    const widgets = [widget({ grid_position: { x: 60, y: 32, w: 59, h: 31 } })];
    const out = normalizeGridSpace(settings, widgets);
    expect(out.changed).toBe(false);
    expect(out.settings).toBe(settings);
    expect(out.widgets).toBe(widgets);
  });

  it("converte posições e canvas de board legado sem mutar as entradas", () => {
    const settings: DashboardSettings = { canvas: { cols: 12 } };
    const w = widget({ grid_position: { x: 6, y: 8, w: 6, h: 8 } });
    const out = normalizeGridSpace(settings, [w]);
    expect(out.changed).toBe(true);
    expect(isFineGrid(out.settings)).toBe(true);
    expect(out.widgets[0].grid_position).toEqual({ x: 60, y: 32, w: 59, h: 31 });
    // Entradas intactas (função pura).
    expect(w.grid_position).toEqual({ x: 6, y: 8, w: 6, h: 8 });
    expect(settings.canvas?.gridVersion).toBeUndefined();
  });

  it("preserva grid_position vazio ('{}' do banco) — fallback fino do posOf", () => {
    const out = normalizeGridSpace({}, [widget({ grid_position: {} })]);
    expect(out.widgets[0].grid_position).toEqual({});
  });

  it("linha divisória: escala o traçado e deriva o bbox do traçado convertido", () => {
    const w = widget({
      visual_type: "linha_divisoria",
      grid_position: { x: 1, y: 2, w: 6, h: 1 },
      settings: { shape: { kind: "linha", line: { x1: 1.5, y1: 2.5, x2: 7.5, y2: 2.5 } } },
    });
    const out = normalizeGridSpace({}, [w]);
    expect(out.widgets[0].settings?.shape?.line).toEqual({
      x1: 15,
      y1: 10,
      x2: 75,
      y2: 10,
    });
    // bbox derivado (floor/ceil) do traçado fino, não a escala do bbox antigo.
    expect(out.widgets[0].grid_position).toEqual({ x: 15, y: 10, w: 60, h: 1 });
  });
});
