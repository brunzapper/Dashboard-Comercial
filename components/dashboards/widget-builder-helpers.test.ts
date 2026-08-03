// Versão: 1.1 | Data: 03/08/2026
// Testes dos helpers PUROS exportados por arquivos de componente do construtor
// (env node, sem render): derivação linhas×colunas do desenhar-para-criar, o
// round-trip value⇄ConversionBasis dos selects de moeda e o agrupamento por
// aba das listas "Aplicar a" dos filtros (groupTargetsByTab).
import { describe, expect, it } from "vitest";

import { tableSizeFromPx } from "@/components/dashboards/draw-to-create";
import {
  basisValue,
  parseBasis,
} from "@/components/dashboards/widget-builder-rows";
import { groupTargetsByTab } from "@/components/dashboards/target-tab-checklist";
import type { Widget } from "@/lib/widgets/types";

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

describe("groupTargetsByTab", () => {
  const w = (id: string, tab?: string) =>
    ({ id, title: id, settings: tab ? { tab } : {} }) as unknown as Widget;
  const tabs = [
    { id: "t1", name: "Vendas" },
    { id: "t2", name: "Marketing" },
    { id: "t3", name: "Vazia" },
  ];

  it("agrupa na ordem de settings.tabs e omite grupo vazio", () => {
    const groups = groupTargetsByTab(
      [w("b", "t2"), w("a", "t1"), w("c", "t2")],
      tabs
    );
    expect(groups.map((g) => g.tab?.id)).toEqual(["t1", "t2"]); // t3 omitida
    expect(groups[0]!.widgets.map((x) => x.id)).toEqual(["a"]);
    // Dentro do grupo preserva a ordem de chegada.
    expect(groups[1]!.widgets.map((x) => x.id)).toEqual(["b", "c"]);
  });

  it("widget sem aba e aba órfã caem na PRIMEIRA aba (regra widgetTab)", () => {
    const groups = groupTargetsByTab([w("x"), w("y", "sumida")], tabs);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.tab?.id).toBe("t1");
    expect(groups[0]!.widgets.map((g) => g.id)).toEqual(["x", "y"]);
  });

  it("dashboard sem abas → grupo único plano (tab null)", () => {
    const groups = groupTargetsByTab([w("x"), w("y", "qualquer")], []);
    expect(groups).toEqual([
      { tab: null, widgets: [expect.objectContaining({ id: "x" }), expect.objectContaining({ id: "y" })] },
    ]);
  });
});
