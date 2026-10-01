// Versão: 1.0 | Data: 01/10/2026
import { describe, expect, it } from "vitest";

import { goalTableRequests, sanitizeGoalTableSettings, sumColumn } from "./goal-table";

const deps = () => ({ knownKeys: new Set(["mrr", "clientes"]), where: "w", warnings: [] as string[] });

describe("sanitizeGoalTableSettings", () => {
  it("descarta indicador desconhecido com aviso", () => {
    const d = deps();
    const out = sanitizeGoalTableSettings(
      { rows: [{ indicator: "mrr", bold: true }, { indicator: "xpto" }] },
      d
    );
    expect(out?.rows).toEqual([{ indicator: "mrr", bold: true }]);
    expect(d.warnings.join(" ")).toMatch(/xpto/);
  });

  it("modo por responsável guarda indicador, nomes e total", () => {
    const out = sanitizeGoalTableSettings(
      {
        mode: "por_responsavel",
        indicator: "mrr",
        responsibles: ["Gabriella", "Gabriella", " Daniela "],
        totalRowLabel: "Compromissos",
        months: ["2026-10", "2026-13", "x"],
        editable: true,
      },
      deps()
    );
    expect(out).toMatchObject({
      mode: "por_responsavel",
      indicator: "mrr",
      responsibles: ["Gabriella", "Daniela"],
      totalRowLabel: "Compromissos",
      months: ["2026-10"],
      editable: true,
    });
  });

  it("não-objeto vira null", () => {
    expect(sanitizeGoalTableSettings([], deps())).toBeNull();
  });
});

describe("goalTableRequests", () => {
  it("uma linha por nome no modo por responsável", () => {
    const r = goalTableRequests({ mode: "por_responsavel", indicator: "mrr", responsibles: ["A", "B"] });
    expect(r.map((x) => [x.indicator, x.responsibleName])).toEqual([
      ["mrr", "A"],
      ["mrr", "B"],
    ]);
    expect(goalTableRequests({ mode: "por_responsavel", responsibles: ["A"] })).toEqual([]);
  });
  it("sumColumn ignora vazios", () => {
    expect(sumColumn([1, null, 2])).toBe(3);
    expect(sumColumn([null])).toBeNull();
  });
});
