// Versão: 1.0 | Data: 31/07/2026
// cleanFilters: normalização das linhas de filtro da UI. Invariante nova
// (pickers de valor): lista JÁ em array no `in` passa INTACTA — `String(array)`
// re-juntaria por vírgula e um nome com vírgula ("Silva, João") quebraria em
// dois. String legada segue no split por vírgula (digitação manual).
import { describe, expect, it } from "vitest";

import { cleanFilters } from "./filter-ops";

describe("cleanFilters", () => {
  it("`in` com ARRAY passa intacto (nome com vírgula sobrevive); vazios caem", () => {
    const out = cleanFilters([
      {
        field: "responsible_id",
        op: "in",
        value: ["Silva, João", " Ana ", ""] as unknown as string,
      },
    ]);
    expect(out[0].value).toEqual(["Silva, João", "Ana"]);
  });

  it("`in` com STRING legada segue no split por vírgula", () => {
    const out = cleanFilters([
      { field: "stage", op: "in", value: "A, B ,, C" },
    ]);
    expect(out[0].value).toEqual(["A", "B", "C"]);
  });

  it("linha sem campo cai; op sem valor perde o valor; sources dedup", () => {
    const out = cleanFilters([
      { field: "", op: "eq", value: "x" },
      { field: "stage", op: "not_null", value: "lixo" },
      { field: "stage", op: "eq", value: "A", sources: ["deals", "deals", ""] },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ field: "stage", op: "not_null" });
    expect(out[1]).toEqual({
      field: "stage",
      op: "eq",
      value: "A",
      sources: ["deals"],
    });
  });
});
