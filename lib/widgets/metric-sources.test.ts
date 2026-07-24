// Versão: 1.0 | Data: 24/07/2026
// Testes do planejamento de pernas por métrica (Metric.sources — invariante 9):
// módulo 100% puro, testado sem fake. O ponto duro: operando com ESCOPO
// (`agg:…@<fonte>`) conta como fonte da métrica — sem isso um @estudo num
// widget só-Deals leria zero em silêncio.
import { describe, expect, it } from "vitest";

import type { Formula } from "@/lib/records/formulas";
import {
  coveredLegSources,
  metricLegSources,
  metricSourcesKey,
  metricTargetSources,
  partitionMetricLegs,
  widgetQuerySources,
} from "@/lib/widgets/metric-sources";
import type { Metric } from "@/lib/widgets/types";

const scopedFormula: Formula = {
  tokens: [{ kind: "field", ref: "agg:count:*@estudo" }],
};

describe("metricTargetSources / metricSourcesKey", () => {
  it("deduplica, descarta vazios; chave é ordem-insensível", () => {
    expect(
      metricTargetSources({ field: "*", agg: "count", sources: ["b", "a", "b", " "] } as Metric)
    ).toEqual(["b", "a"]);
    expect(metricSourcesKey(["deals", "leads"])).toBe(
      metricSourcesKey(["leads", "deals"])
    );
  });
});

describe("metricLegSources", () => {
  it("sem alvos → herda (null); conjunto idêntico ao do widget → null", () => {
    expect(metricLegSources({ field: "*", agg: "count" } as Metric, ["deals"])).toBeNull();
    expect(
      metricLegSources(
        { field: "*", agg: "count", sources: ["deals", "leads"] } as Metric,
        ["leads", "deals"]
      )
    ).toBeNull();
  });

  it("conjunto diferente → perna; operando @fonte soma o escopo ao conjunto", () => {
    expect(
      metricLegSources({ field: "*", agg: "count", sources: ["leads"] } as Metric, [
        "deals",
      ])
    ).toEqual(["leads"]);
    const m = { field: "calc:formula", agg: "sum", formula: scopedFormula } as Metric;
    expect(metricLegSources(m, ["deals"], new Map())).toEqual([
      "deals",
      "estudo",
    ]);
  });

  it("widget 'todas as fontes' sem alvos → null (escopos já enxergam tudo)", () => {
    const m = { field: "calc:formula", agg: "sum", formula: scopedFormula } as Metric;
    expect(metricLegSources(m, [], new Map())).toBeNull();
  });
});

describe("partitionMetricLegs / coveredLegSources", () => {
  const metrics = [
    { field: "*", agg: "count" },
    { field: "*", agg: "count", sources: ["leads"] },
    { field: "value", agg: "sum", sources: ["leads"] },
    { field: "*", agg: "count", sources: ["estudo"] },
  ] as Metric[];

  it("agrupa métricas por conjunto DISTINTO de fontes", () => {
    const { defaultIdx, legs } = partitionMetricLegs(metrics, ["deals"]);
    expect(defaultIdx).toEqual([0]);
    expect(legs).toEqual([
      { sources: ["leads"], idx: [1, 2] },
      { sources: ["estudo"], idx: [3] },
    ]);
  });

  it("coveredLegSources: interseção com o universo do widget; sem seleção cobre tudo", () => {
    const legs = [{ sources: ["leads"] }, { sources: ["estudo"] }];
    expect(coveredLegSources(legs, ["deals", "leads"])).toEqual(["leads"]);
    expect(coveredLegSources(legs, [])).toEqual(["leads", "estudo"]);
  });
});

describe("widgetQuerySources (cobertura do @period)", () => {
  it("widget 'todas as fontes' → [] (todas); senão widget ∪ métricas ∪ escopos", () => {
    expect(widgetQuerySources(undefined, [])).toEqual([]);
    const metrics = [
      { field: "*", agg: "count", sources: ["leads"] },
      { field: "calc:formula", agg: "sum", formula: scopedFormula },
    ] as Metric[];
    expect(widgetQuerySources(["deals"], metrics, new Map())).toEqual([
      "deals",
      "leads",
      "estudo",
    ]);
  });
});
