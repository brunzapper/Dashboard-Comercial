// Versão: 1.0 | Data: 24/07/2026
// Testes do pivot das pernas de sub-base (buildSubSeriesPivot): só ativa com o
// marcador WidgetData.subSeries + ≥2 dims; categorias = dim_2; uma série
// sintética por (base × métrica) com keyMap p/ formatação; __cmp/__money/__goal
// propagados; total por categoria p/ top-N/ordenação.
import { describe, expect, it } from "vitest";

import {
  buildSubSeriesPivot,
  subSeriesCatTotalKey,
} from "@/lib/widgets/sub-series";
import type { WidgetData } from "@/lib/widgets/types";

const base = (over: Partial<WidgetData>): WidgetData => ({
  rows: [],
  dimensions: [
    { key: "dim_1", label: "Base" },
    { key: "dim_2", label: "Fonte" },
  ],
  metrics: [{ key: "metric_1", label: "SQLs" }],
  subSeries: { mode: "stacked" },
  ...over,
});

describe("buildSubSeriesPivot", () => {
  it("sem marcador subSeries, ou com <2 dims, retorna null", () => {
    expect(buildSubSeriesPivot(base({ subSeries: undefined }))).toBeNull();
    expect(
      buildSubSeriesPivot(
        base({ dimensions: [{ key: "dim_1", label: "Base" }] })
      )
    ).toBeNull();
    expect(buildSubSeriesPivot(base({}))).toBeNull(); // sem linhas = sem bases
  });

  it("pivota: 1 objeto por categoria, série por base, keyMap e total", () => {
    const data = base({
      rows: [
        { dim_1: "Lite", dim_2: "GA", metric_1: 50 },
        { dim_1: "Lite", dim_2: "Meta", metric_1: 10 },
        { dim_1: "SQLs AE", dim_2: "GA", metric_1: 22 },
        { dim_1: "SQLs AE", dim_2: "NID", metric_1: 1 },
      ],
    });
    const p = buildSubSeriesPivot(data)!;
    expect(p.mode).toBe("stacked");
    expect(p.catKey).toBe("dim_2");
    expect(p.series.map((s) => [s.dataKey, s.name, s.lastInStack])).toEqual([
      ["sb_0_0", "Lite", false],
      ["sb_1_0", "SQLs AE", true],
    ]);
    expect(p.keyMap).toEqual({
      sb_0_0: "metric_1",
      sb_0_0__cmp: "metric_1",
      sb_1_0: "metric_1",
      sb_1_0__cmp: "metric_1",
    });
    expect(p.rows).toEqual([
      {
        dim_2: "GA",
        sb_0_0: 50,
        sb_1_0: 22,
        [subSeriesCatTotalKey("metric_1")]: 72,
      },
      {
        dim_2: "Meta",
        sb_0_0: 10,
        [subSeriesCatTotalKey("metric_1")]: 10,
      },
      {
        dim_2: "NID",
        sb_1_0: 1,
        [subSeriesCatTotalKey("metric_1")]: 1,
      },
    ]);
  });

  it("propaga __cmp (achatado + mapa), __money e __goal (1º não-nulo)", () => {
    const bd = { perCurrency: { BRL: 5 }, brl: 5, usd: 0, count: 1 };
    const data = base({
      rows: [
        {
          dim_1: "Lite",
          dim_2: "GA",
          metric_1: 50,
          __cmp: { metric_1: 40 },
          __money: { metric_1: bd },
          __goal: null,
        },
        {
          dim_1: "SQLs AE",
          dim_2: "GA",
          metric_1: 22,
          __cmp: { metric_1: 20 },
          __goal: 100,
        },
      ],
    });
    const row = buildSubSeriesPivot(data)!.rows[0];
    expect(row.sb_0_0__cmp).toBe(40);
    expect(row.sb_1_0__cmp).toBe(20);
    expect(row.__cmp).toEqual({ sb_0_0: 40, sb_1_0: 20 });
    expect(row.__money).toEqual({ sb_0_0: bd });
    expect(row.__goal).toBe(100);
  });

  it("2 métricas: nome 'base · métrica' e stack (lastInStack) POR métrica", () => {
    const data = base({
      metrics: [
        { key: "metric_1", label: "SQLs" },
        { key: "metric_2", label: "MRR" },
      ],
      rows: [
        { dim_1: "Lite", dim_2: "GA", metric_1: 1, metric_2: 5 },
        { dim_1: "SQLs AE", dim_2: "GA", metric_1: 2, metric_2: 7 },
      ],
    });
    const p = buildSubSeriesPivot(data)!;
    expect(p.series.map((s) => [s.dataKey, s.metricKey, s.name, s.lastInStack]))
      .toEqual([
        ["sb_0_0", "metric_1", "Lite · SQLs", false],
        ["sb_1_0", "metric_1", "SQLs AE · SQLs", true],
        ["sb_0_1", "metric_2", "Lite · MRR", false],
        ["sb_1_1", "metric_2", "SQLs AE · MRR", true],
      ]);
    expect(p.rows[0]).toMatchObject({
      sb_0_0: 1,
      sb_1_0: 2,
      sb_0_1: 5,
      sb_1_1: 7,
      [subSeriesCatTotalKey("metric_1")]: 3,
      [subSeriesCatTotalKey("metric_2")]: 12,
    });
  });

  it("dims além de dim_2 fundem por soma na mesma (base × categoria)", () => {
    const data = base({
      dimensions: [
        { key: "dim_1", label: "Base" },
        { key: "dim_2", label: "Fonte" },
        { key: "dim_3", label: "Etapa" },
      ],
      rows: [
        { dim_1: "Lite", dim_2: "GA", dim_3: "A", metric_1: 3 },
        { dim_1: "Lite", dim_2: "GA", dim_3: "B", metric_1: 4 },
      ],
    });
    expect(buildSubSeriesPivot(data)!.rows).toEqual([
      { dim_2: "GA", sb_0_0: 7, [subSeriesCatTotalKey("metric_1")]: 7 },
    ]);
  });
});
