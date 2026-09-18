// Versão: 1.1 | Data: 17/09/2026 (v1.1: chip OPT-IN da Base manual — só o
// dropdown de métrica o pede; nos demais um chip vazio seria armadilha)
// Versão: 1.0 | Data: 31/07/2026
// cleanFilters: normalização das linhas de filtro da UI. Invariante nova
// (pickers de valor): lista JÁ em array no `in` passa INTACTA — `String(array)`
// re-juntaria por vírgula e um nome com vírgula ("Silva, João") quebraria em
// dois. String legada segue no split por vírgula (digitação manual).
import { describe, expect, it } from "vitest";

import { MANUAL_CHIP_KEY, cleanFilters, sourceChips } from "./filter-ops";

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

describe("sourceChips", () => {
  const labels = { deals: "Negócios", leads: "Leads", geral: "Geral" };

  it("sem opts não muda nada — nenhum chip de Base manual", () => {
    expect(sourceChips(labels)).toEqual([
      { key: "deals", label: "Negócios" },
      { key: "leads", label: "Leads" },
      { key: "geral", label: "Geral" },
    ]);
  });

  it("com manual: true acrescenta o chip no FIM, com o rótulo dono da palavra", () => {
    const chips = sourceChips(labels, { manual: true });
    expect(chips).toHaveLength(4);
    expect(chips[3]).toEqual({ key: MANUAL_CHIP_KEY, label: "Base manual" });
  });

  it("a chave do chip não colide com nenhuma source-key", () => {
    // A Base manual não é linha de data_sources; a chave é sentinela.
    expect(Object.keys(labels)).not.toContain(MANUAL_CHIP_KEY);
    expect(MANUAL_CHIP_KEY.startsWith("__")).toBe(true);
  });
});
