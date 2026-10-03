// Versão: 1.1 | Data: 03/10/2026
// v1.1 (03/10/2026): navegação por mês e colunas de atribuição sob demanda.
// Versão: 1.0 | Data: 17/09/2026
// A tradução entre a forma longa do banco (um lançamento por célula) e a
// tabela que as pessoas colam. O que os testes protegem: a identidade da
// LINHA é a mesma chave natural do índice único da 0142 — é ela que faz
// editar uma célula virar upsert, e relançar o mês não duplicar.
import { describe, expect, it } from "vitest";

import type { ManualEntry } from "@/lib/manual-base/types";

import {
  attributionColumns,
  buildManualGrid,
  isYearMonth,
  rowTouchesMonth,
  rowsForMonth,
  shiftMonth,
  manualColumns,
  manualPeriodLabel,
  manualRowKey,
  monthEnd,
} from "./rows";

const e = (over: Partial<ManualEntry>): ManualEntry => ({
  id: "e1",
  series_id: "s1",
  period_start: "2026-08-01",
  period_end: "2026-08-31",
  value: 1,
  responsible_id: null,
  operation_id: null,
  spread: "ancora",
  note: null,
    coords: {},
  ...over,
});

describe("buildManualGrid", () => {
  it("junta os dados do mesmo período+atribuição numa linha só", () => {
    const grid = buildManualGrid([
      e({ id: "a", series_id: "s1", value: 5261 }),
      e({ id: "b", series_id: "s2", value: 6590 }),
      e({ id: "c", series_id: "s3", value: 35 }),
    ]);
    expect(grid).toHaveLength(1);
    expect(grid[0].bySeries.get("s2")?.value).toBe(6590);
  });

  it("atribuições diferentes são LINHAS diferentes", () => {
    const grid = buildManualGrid([
      e({ id: "a", operation_id: "op-out" }),
      e({ id: "b", operation_id: "op-in" }),
      e({ id: "c", operation_id: null }),
    ]);
    expect(grid).toHaveLength(3);
  });

  it("ordena do período mais recente para o mais antigo", () => {
    const grid = buildManualGrid([
      e({ id: "a", period_start: "2026-07-01", period_end: "2026-07-31" }),
      e({ id: "b", period_start: "2026-09-01", period_end: "2026-09-30" }),
      e({ id: "c" }),
    ]);
    expect(grid.map((r) => r.periodStart)).toEqual([
      "2026-09-01",
      "2026-08-01",
      "2026-07-01",
    ]);
  });

  it("a chave da linha bate com a chave natural do banco", () => {
    const grid = buildManualGrid([e({ operation_id: "op-out" })]);
    expect(grid[0].key).toBe(manualRowKey("2026-08-01", "2026-08-31", null, "op-out"));
  });
});

describe("manualColumns", () => {
  const series = [
    { id: "1", key: "a", label: "A", default_spread: "ancora" as const, sort_order: 0 },
    { id: "2", key: "b", label: "B", default_spread: "ancora" as const, sort_order: 1 },
  ];
  it("sem recorte, todas as colunas na ordem do catálogo", () => {
    expect(manualColumns(series).map((s) => s.key)).toEqual(["a", "b"]);
  });
  it("com recorte, só as escolhidas", () => {
    expect(manualColumns(series, ["b"]).map((s) => s.key)).toEqual(["b"]);
  });
  it("recorte vazio é o mesmo que sem recorte", () => {
    expect(manualColumns(series, []).map((s) => s.key)).toEqual(["a", "b"]);
  });
});

describe("manualPeriodLabel", () => {
  it("mês cheio vira o nome do mês — é como quem lança pensa", () => {
    expect(manualPeriodLabel("2026-08-01", "2026-08-31")).toBe("Agosto/2026");
    expect(manualPeriodLabel("2026-02-01", "2026-02-28")).toBe("Fevereiro/2026");
  });
  it("um dia só mostra a data", () => {
    expect(manualPeriodLabel("2026-08-15", "2026-08-15")).toBe("15/08/2026");
  });
  it("intervalo qualquer mostra as duas pontas", () => {
    expect(manualPeriodLabel("2026-08-01", "2026-08-10")).toBe(
      "01/08/2026 – 10/08/2026"
    );
  });
});

describe("monthEnd", () => {
  it("resolve fevereiro bissexto sem depender do fuso", () => {
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(monthEnd("2026-12")).toBe("2026-12-31");
  });
});

// v1.1 (03/10/2026)
describe("navegação por mês", () => {
  it("shiftMonth atravessa a virada do ano nos dois sentidos", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-10", 0)).toBe("2026-10");
    expect(shiftMonth("lixo", 1)).toBe("lixo");
  });

  it("isYearMonth só aceita AAAA-MM válido", () => {
    expect(isYearMonth("2026-10")).toBe(true);
    expect(isYearMonth("2026-13")).toBe(false);
    expect(isYearMonth(undefined)).toBe(false);
  });

  it("uma linha ENCOSTA no mês quando os intervalos se cruzam", () => {
    const tri = { periodStart: "2026-07-01", periodEnd: "2026-09-30" };
    expect(rowTouchesMonth(tri, "2026-08")).toBe(true);
    expect(rowTouchesMonth(tri, "2026-10")).toBe(false);
  });

  it("rowsForMonth(null) devolve todas", () => {
    const grid = buildManualGrid([
      e({ id: "a" }),
      e({ id: "b", period_start: "2026-09-01", period_end: "2026-09-30" }),
    ]);
    expect(rowsForMonth(grid, null)).toHaveLength(2);
    expect(rowsForMonth(grid, "2026-09")).toHaveLength(1);
  });
});

describe("attributionColumns", () => {
  it("esconde Responsável/Operação quando nenhuma linha tem atribuição solta", () => {
    const grid = buildManualGrid([e({ id: "a" })]);
    expect(attributionColumns(grid)).toEqual({ responsible: false, operation: false });
  });

  it("linha que ENDEREÇA a divisão Responsável não pede coluna solta", () => {
    const grid = buildManualGrid([
      e({ id: "a", responsible_id: "r1", coords: { responsavel: "r1" } }),
    ]);
    expect(attributionColumns(grid).responsible).toBe(false);
  });

  it("atribuição legada (FK sem divisão) pede a coluna", () => {
    const grid = buildManualGrid([e({ id: "a", operation_id: "o1" })]);
    expect(attributionColumns(grid)).toEqual({ responsible: false, operation: true });
  });
});
