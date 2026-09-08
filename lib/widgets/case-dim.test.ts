// Versão: 1.0 | Data: 07/08/2026
// Dimensão CONDICIONAL (caseFormula): gates simples×robusto, avaliação
// (coerção numérica, SE sem "senão" preserva o cru, E/OU), fusão de campo
// único via mergeRowsByBucket (caseIdx) e a expansão/contração multi-campo
// (planCaseExpansion + contractCaseRows) com fold de métricas.
import { describe, expect, it } from "vitest";

import { tokenizeFormulaText } from "@/lib/records/formula-text";
import type { Formula } from "@/lib/records/formulas";
import { rpcDimForClosedWeek } from "./closed-week";
import { contractCaseRows, mergeRowsByBucket } from "./bucket-merge";
import {
  caseDimActive,
  caseDimValue,
  caseFormulaRefs,
  coerceCaseRaw,
  dimNeedsCaseExpand,
  dimNeedsCaseFold,
  planCaseExpansion,
} from "./case-dim";
import type { Dimension, WidgetRow } from "./types";

const CATALOG = [
  { ref: "custom:fruta", label: "Fruta" },
  { ref: "custom:uf", label: "UF" },
  { ref: "custom:qtd", label: "Qtd" },
];

function formula(src: string): Formula {
  const res = tokenizeFormulaText(src, CATALOG);
  if (!res.ok) throw new Error(res.error);
  return res.formula;
}

const FRUTA_CASE = formula(
  'SE([Fruta] = "Mamão"; "Doce"; SE(OU([Fruta] = "Pera"; [Fruta] = "Maçã"); "Dura"; "Outros"))'
);

describe("gates", () => {
  it("campo único = fold simples; refs extras = expansão", () => {
    const single: Dimension = { field: "custom:fruta", caseFormula: FRUTA_CASE };
    expect(dimNeedsCaseFold(single)).toBe(true);
    expect(dimNeedsCaseExpand(single)).toBe(false);

    const multi: Dimension = {
      field: "custom:fruta",
      caseFormula: formula('SE(E([Fruta] = "Mamão"; [UF] = "SP"); "X"; "Y")'),
    };
    expect(dimNeedsCaseFold(multi)).toBe(false);
    expect(dimNeedsCaseExpand(multi)).toBe(true);
    expect(caseFormulaRefs(multi)).toEqual(["custom:fruta", "custom:uf"]);
  });

  it("transform/dateAgg desativam a expressão (mutuamente exclusivos)", () => {
    const d: Dimension = {
      field: "custom:fruta",
      transform: "month_year",
      caseFormula: FRUTA_CASE,
    };
    expect(caseDimActive(d)).toBe(false);
    expect(dimNeedsCaseFold(d)).toBe(false);
    expect(
      caseDimActive({
        field: "custom:fruta",
        dateAgg: "sum",
        caseFormula: FRUTA_CASE,
      })
    ).toBe(false);
    // transform "none" não desativa.
    expect(
      caseDimActive({ field: "custom:fruta", transform: "none", caseFormula: FRUTA_CASE })
    ).toBe(true);
  });
});

describe("caseDimValue", () => {
  const dim: Dimension = { field: "custom:fruta", caseFormula: FRUTA_CASE };

  it("mapeia valor→rótulo com E/OU aninhados", () => {
    expect(caseDimValue(FRUTA_CASE, dim, { "custom:fruta": "Mamão" })).toBe("Doce");
    expect(caseDimValue(FRUTA_CASE, dim, { "custom:fruta": "Pera" })).toBe("Dura");
    expect(caseDimValue(FRUTA_CASE, dim, { "custom:fruta": "Maçã" })).toBe("Dura");
    expect(caseDimValue(FRUTA_CASE, dim, { "custom:fruta": "Uva" })).toBe("Outros");
  });

  it("SE sem 'senão' preserva o valor cru", () => {
    const f = formula('SE([Fruta] = "Mamão"; "Doce")');
    const d: Dimension = { field: "custom:fruta", caseFormula: f };
    expect(caseDimValue(f, d, { "custom:fruta": "Mamão" })).toBe("Doce");
    expect(caseDimValue(f, d, { "custom:fruta": "Uva" })).toBe("Uva");
    expect(caseDimValue(f, d, { "custom:fruta": null })).toBeNull();
  });

  it("coerção numérica: comparação >= funciona sobre texto do RPC", () => {
    const f = formula('SE([Qtd] >= 10; "Grande"; "Pequeno")');
    const d: Dimension = { field: "custom:qtd", caseFormula: f };
    expect(coerceCaseRaw("12")).toBe(12);
    expect(coerceCaseRaw(" ")).toBeNull();
    expect(caseDimValue(f, d, { "custom:qtd": "12" })).toBe("Grande");
    expect(caseDimValue(f, d, { "custom:qtd": "3" })).toBe("Pequeno");
  });
});

describe("mergeRowsByBucket com caseIdx (campo único)", () => {
  const dims: Dimension[] = [{ field: "custom:fruta", caseFormula: FRUTA_CASE }];
  const rows: WidgetRow[] = [
    { dim_1: "Mamão", metric_1: 10, metric_2: 5 },
    { dim_1: "Pera", metric_1: 3, metric_2: 1 },
    { dim_1: "Maçã", metric_1: 4, metric_2: 3 },
    { dim_1: "Uva", metric_1: 2, metric_2: 2 },
  ];
  const specs = [
    { key: "metric_1", kind: "sum" as const },
    { key: "metric_2", kind: "count" as const },
  ];

  it("funde crus que caem no mesmo rótulo (sum/count somam)", () => {
    const out = mergeRowsByBucket(rows, dims, specs);
    expect(out).toHaveLength(3);
    expect(out.map((r) => [r.dim_1, r.metric_1, r.metric_2])).toEqual([
      ["Doce", 10, 5],
      ["Dura", 7, 4],
      ["Outros", 2, 2],
    ]);
  });

  it("dim sem caseFormula segue byte-idêntico (mesma referência)", () => {
    const plain: Dimension[] = [{ field: "custom:fruta" }];
    expect(mergeRowsByBucket(rows, plain, specs)).toBe(rows);
  });
});

describe("planCaseExpansion + contractCaseRows (multi-campo)", () => {
  const multi = formula('SE(E([Fruta] = "Mamão"; [UF] = "SP"); "SP doce"; "Resto")');
  const dims: Dimension[] = [
    { field: "custom:fruta", caseFormula: multi },
    { field: "stage" },
  ];

  it("expande refs em dims cruas e mapeia as posições", () => {
    const plan = planCaseExpansion(dims, rpcDimForClosedWeek);
    expect(plan).not.toBeNull();
    expect(plan!.rpcDims.map((d) => d.field)).toEqual([
      "custom:fruta",
      "custom:uf",
      "stage",
    ]);
    expect(plan!.colsOfDim).toEqual([[0, 1], [2]]);
    expect(plan!.refsOfDim).toEqual([["custom:fruta", "custom:uf"], null]);
    // Sem dim multi-campo: null (payload segue o caminho atual).
    expect(planCaseExpansion([{ field: "stage" }], rpcDimForClosedWeek)).toBeNull();
  });

  it("contrai as linhas expandidas p/ o shape da config e funde por rótulo", () => {
    const plan = planCaseExpansion(dims, rpcDimForClosedWeek)!;
    const rows: WidgetRow[] = [
      { dim_1: "Mamão", dim_2: "SP", dim_3: "Ganho", metric_1: 10 },
      { dim_1: "Mamão", dim_2: "RJ", dim_3: "Ganho", metric_1: 4 },
      { dim_1: "Pera", dim_2: "SP", dim_3: "Ganho", metric_1: 1 },
      { dim_1: "Pera", dim_2: "SP", dim_3: "Perdido", metric_1: 7 },
    ];
    const out = contractCaseRows(rows, dims, plan, [
      { key: "metric_1", kind: "sum" },
    ]);
    expect(out.map((r) => [r.dim_1, r.dim_2, r.metric_1])).toEqual([
      ["SP doce", "Ganho", 10],
      ["Resto", "Ganho", 5],
      ["Resto", "Perdido", 7],
    ]);
    // A coluna expandida excedente saiu das linhas contraídas.
    expect(out.every((r) => !("dim_3" in r))).toBe(true);
  });
});
