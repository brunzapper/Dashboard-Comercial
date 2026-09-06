// Versão: 1.0 | Data: 06/09/2026
// Fórmulas de célula da Tabela Livre: endereçamento A1, ranges, avaliação
// (com dependência entre células e ciclo) e os endereços CITADOS por uma
// fórmula em digitação — o insumo do realce na grade (v1.1 de cell-formulas).
import { describe, expect, it } from "vitest";

import {
  cellRef,
  cellRefsInSource,
  colIndex,
  colLetter,
  compileCellFormula,
  computeCellFormulas,
  parseA1,
} from "./cell-formulas";

const dims = { rows: 4, cols: 3 };

describe("endereçamento A1", () => {
  it("converte índice ↔ letra", () => {
    expect(colLetter(0)).toBe("A");
    expect(colLetter(25)).toBe("Z");
    expect(colLetter(26)).toBe("AA");
    expect(colIndex("A")).toBe(0);
    expect(colIndex("AA")).toBe(26);
    expect(parseA1("B3")).toEqual({ c: 1, r: 2 });
    expect(parseA1("SOMA")).toBeNull();
  });
});

describe("cellRefsInSource", () => {
  it("lista os endereços de uma fórmula completa", () => {
    expect(cellRefsInSource("=A1+B2", dims)).toEqual([
      { c: 0, r: 0 },
      { c: 1, r: 1 },
    ]);
  });

  it("expande intervalos (inclusive abertos) e não repete", () => {
    expect(cellRefsInSource("=SOMA(A1:A3)+A1", dims)).toEqual([
      { c: 0, r: 0 },
      { c: 0, r: 1 },
      { c: 0, r: 2 },
    ]);
    expect(cellRefsInSource("=SOMA(A2:A)", dims)).toHaveLength(3);
    expect(cellRefsInSource("=SOMA(A:A)", dims)).toHaveLength(4);
  });

  it("aceita fórmula em DIGITAÇÃO (ainda inválida)", () => {
    expect(cellRefsInSource("=A1+", dims)).toEqual([{ c: 0, r: 0 }]);
    expect(cellRefsInSource("=SOMA(B1;", dims)).toEqual([{ c: 1, r: 0 }]);
  });

  it("ignora nomes de função, texto entre aspas e refs fora da grade", () => {
    expect(cellRefsInSource('=CONCATENAR("A1"; B1)', dims)).toEqual([
      { c: 1, r: 0 },
    ]);
    expect(cellRefsInSource("=Z9", dims)).toEqual([]);
    expect(cellRefsInSource("=", dims)).toEqual([]);
  });
});

describe("computeCellFormulas", () => {
  // Grade 2×2 de valores-base; a fórmula mora na chave passada em `formulas`.
  const keyAt = (c: number, r: number) =>
    c < 2 && r < 2 ? `r${r}:c${c}` : null;
  const base: Record<string, number | string | null> = {
    "r0:c0": 10,
    "r1:c0": 5,
    "r0:c1": null,
    "r1:c1": null,
  };

  it("soma um intervalo e encadeia fórmulas", () => {
    const out = computeCellFormulas({
      formulas: new Map([
        ["r0:c1", "=SOMA(A1:A2)"],
        ["r1:c1", "=B1*2"],
      ]),
      keyAt,
      baseValue: (k) => base[k] ?? null,
      dims: { rows: 2, cols: 2 },
    });
    expect(out.values.get("r0:c1")).toBe(15);
    expect(out.values.get("r1:c1")).toBe(30);
    expect(out.errors.size).toBe(0);
  });

  it("marca ciclo e erro de sintaxe sem lançar", () => {
    const out = computeCellFormulas({
      formulas: new Map([
        ["r0:c1", "=B2"],
        ["r1:c1", "=B1"],
      ]),
      keyAt,
      baseValue: (k) => base[k] ?? null,
      dims: { rows: 2, cols: 2 },
    });
    expect(out.errors.get("r0:c1")).toBe("#CICLO!");
    expect(out.errors.get("r1:c1")).toBe("#CICLO!");

    const bad = computeCellFormulas({
      formulas: new Map([["r0:c1", "=SOMA(A1"]]),
      keyAt,
      baseValue: (k) => base[k] ?? null,
      dims: { rows: 2, cols: 2 },
    });
    expect(bad.errors.get("r0:c1")).toBeTruthy();
    expect(bad.values.get("r0:c1")).toBeNull();
  });

  it("compila refs A1 para cell:<col>:<lin>", () => {
    const res = compileCellFormula("=A1+B2", dims);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const refs = JSON.stringify(res.formula);
      expect(refs).toContain(cellRef(0, 0));
      expect(refs).toContain(cellRef(1, 1));
    }
  });
});
