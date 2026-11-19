// Versão: 1.0 | Data: 19/11/2026
import { describe, expect, it } from "vitest";

import { mergeStageOptions, ONLY_IN_RECORDS_GROUP } from "./stage-options";

const deals = {
  key: "deals",
  label: "Negócios",
  recordType: "negocio",
  declared: [
    { value: "Novo", group: "Vendas" },
    { value: "Proposta", group: "Vendas" },
    { value: "Novo", group: "Enterprise" },
  ],
};
const leads = {
  key: "leads",
  label: "Leads",
  recordType: "lead",
  declared: [{ value: "Em contato" }],
};

describe("mergeStageOptions", () => {
  it("uma Base: grupos = pipelines; valor órfão vai p/ 'Só nos registros'", () => {
    const out = mergeStageOptions(
      [deals],
      new Map([["negocio", new Set(["Proposta", "Antiga"])]])
    );
    expect(out).toEqual([
      { value: "Novo", label: "Novo", group: "Vendas" },
      { value: "Proposta", label: "Proposta", group: "Vendas" },
      { value: "Novo", label: "Novo", group: "Enterprise" },
      { value: "Antiga", label: "Antiga", group: ONLY_IN_RECORDS_GROUP },
    ]);
  });

  it("várias Bases: o grupo diz de qual Base é (fase × etapa não se misturam)", () => {
    const out = mergeStageOptions([deals, leads], new Map());
    expect(out.map((o) => o.group)).toEqual([
      "Negócios · Vendas",
      "Negócios · Vendas",
      "Negócios · Enterprise",
      "Leads",
    ]);
  });

  it("Base sem lista declarada usa os valores dos registros", () => {
    const out = mergeStageOptions(
      [{ key: "x", label: "X", recordType: "x", declared: null }],
      new Map([["x", new Set(["B", "A"])]])
    );
    expect(out).toEqual([
      { value: "A", label: "A" },
      { value: "B", label: "B" },
    ]);
  });
});
