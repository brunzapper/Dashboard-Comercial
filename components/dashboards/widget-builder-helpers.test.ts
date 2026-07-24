// Versão: 1.0 | Data: 24/07/2026
// Testes dos helpers PUROS exportados por arquivos de componente do construtor
// (env node, sem render): derivação linhas×colunas do desenhar-para-criar e o
// round-trip value⇄ConversionBasis dos selects de moeda.
import { describe, expect, it } from "vitest";

import { tableSizeFromPx } from "@/components/dashboards/draw-to-create";
import {
  basisValue,
  parseBasis,
} from "@/components/dashboards/widget-builder-rows";

describe("tableSizeFromPx", () => {
  it("~120px por coluna e ~32px por linha (descontado o cabeçalho)", () => {
    expect(tableSizeFromPx(360, 36 + 320)).toEqual({ cols: 3, rows: 10 });
  });

  it("limites sãos: mínimo 1×1, máximo 12×50", () => {
    expect(tableSizeFromPx(0, 0)).toEqual({ cols: 1, rows: 1 });
    expect(tableSizeFromPx(99999, 99999)).toEqual({ cols: 12, rows: 50 });
  });
});

describe("basisValue / parseBasis", () => {
  it("round-trip e defaults defensivos", () => {
    expect(basisValue(undefined)).toBe("record_year");
    expect(basisValue({ source: "period", granularity: "quarter" })).toBe(
      "period_quarter"
    );
    expect(parseBasis("period_quarter")).toEqual({
      source: "period",
      granularity: "quarter",
    });
    expect(parseBasis("lixo")).toEqual({ source: "record", granularity: "year" });
    for (const v of ["record_year", "record_quarter", "period_year"]) {
      expect(basisValue(parseBasis(v))).toBe(v);
    }
  });
});
