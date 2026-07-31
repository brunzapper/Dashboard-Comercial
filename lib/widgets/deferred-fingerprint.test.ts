// Versão: 1.0 | Data: 31/07/2026
// Testes do fingerprint de config dos widgets deferidos: muda quando a CONFIG
// muda (métrica/settings/tipo), fica ESTÁVEL quando só posição/ordem/chaves
// fora do contrato mudam (mover widget não re-busca o lote) e é determinístico.
import { describe, expect, it } from "vitest";

import { widgetConfigFingerprint } from "./deferred-fingerprint";

const base = {
  title: "Vendas",
  visual_type: "kpi",
  source: null,
  sources: ["deals"],
  split_by_source: false,
  dimensions: [],
  metrics: [{ field: "value", agg: "sum" }],
  filters: [],
  settings: { defaultPreset: "month" },
};

describe("widgetConfigFingerprint", () => {
  it("determinístico para a mesma config", () => {
    expect(widgetConfigFingerprint(base)).toBe(
      widgetConfigFingerprint({ ...base })
    );
  });

  it("muda quando métrica, settings ou tipo mudam (edição re-busca)", () => {
    const fp = widgetConfigFingerprint(base);
    expect(
      widgetConfigFingerprint({
        ...base,
        metrics: [{ field: "value", agg: "avg" }],
      })
    ).not.toBe(fp);
    expect(
      widgetConfigFingerprint({
        ...base,
        settings: { defaultPreset: "quarter" },
      })
    ).not.toBe(fp);
    expect(widgetConfigFingerprint({ ...base, visual_type: "grafico" })).not.toBe(fp);
    expect(widgetConfigFingerprint({ ...base, title: "Outro" })).not.toBe(fp);
  });

  it("ESTÁVEL quando só posição/ordem/chaves fora do contrato mudam", () => {
    const fp = widgetConfigFingerprint(base);
    const moved = {
      ...base,
      grid_position: { x: 10, y: 20, w: 6, h: 8 },
      sort_order: 99,
      id: "outro-id",
      updated_at: "2026-07-31T12:00:00Z",
    };
    expect(widgetConfigFingerprint(moved)).toBe(fp);
  });

  it("ausência de chave equivale a null (linha crua × normalizada)", () => {
    expect(widgetConfigFingerprint({})).toBe(
      widgetConfigFingerprint({ source: null, filters: null })
    );
  });
});
