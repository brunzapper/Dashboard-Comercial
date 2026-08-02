// Versão: 1.0 | Data: 02/08/2026
// Testes do parse/validação do "Aplica-se a" editável na UI de Campos
// (02/08/2026): valores restritos a record_types de bases RAIZ, dedupe, vazio
// = campo geral; e a guarda de estreitamento que protege campo usado como
// período de base/sub (sub conta pelo record_type da PAI).
import { describe, expect, it } from "vitest";

import type { SourceDef } from "@/lib/sources";
import { appliesToPeriodConflict, parseAppliesTo } from "./applies-to";

const src = (over: Partial<SourceDef> & { key: string }): SourceDef => ({
  recordType: over.key,
  label: over.key,
  shortLabel: over.key,
  defaultPeriodField: "source_created_at",
  builtin: false,
  manualEntry: true,
  ...over,
});

const CATALOG: SourceDef[] = [
  src({ key: "leads", recordType: "lead", label: "Leads do Bitrix" }),
  src({ key: "deals", recordType: "negocio", label: "Deals do Bitrix" }),
  src({ key: "estudo", recordType: "venda_site", label: "Estudo de Fechamentos" }),
  // Sub-base: herda o record_type da pai; nunca é opção de applies_to.
  src({
    key: "reunioes",
    recordType: "lead",
    label: "Reuniões qualificadas",
    parentKey: "leads",
    defaultPeriodField: "custom:data_reuniao",
  }),
];

describe("parseAppliesTo", () => {
  it("aceita record_types de bases raiz, com dedupe e ordem preservada", () => {
    const r = parseAppliesTo(["lead", "negocio", "lead", " venda_site "], CATALOG);
    expect(r).toEqual({ ok: true, appliesTo: ["lead", "negocio", "venda_site"] });
  });

  it("vazio é válido (campo geral)", () => {
    expect(parseAppliesTo([], CATALOG)).toEqual({ ok: true, appliesTo: [] });
  });

  it("rejeita valor que não é record_type de base raiz (key de sub inclusa)", () => {
    expect(parseAppliesTo(["lead", "outra"], CATALOG).ok).toBe(false);
    // A key da sub ("reunioes") não é record_type de raiz — form adulterado.
    expect(parseAppliesTo(["reunioes"], CATALOG).ok).toBe(false);
  });
});

describe("appliesToPeriodConflict", () => {
  it("bloqueia estreitamento que órfã o campo de período de uma sub (record_type da pai)", () => {
    const msg = appliesToPeriodConflict(
      "data_reuniao",
      ["negocio"],
      CATALOG
    );
    expect(msg).toContain("Reuniões qualificadas");
  });

  it("cobertura mantida ou lista vazia (geral) passam", () => {
    expect(
      appliesToPeriodConflict("data_reuniao", ["lead", "negocio"], CATALOG)
    ).toBeNull();
    expect(appliesToPeriodConflict("data_reuniao", [], CATALOG)).toBeNull();
    // Campo que ninguém usa como período: sempre livre.
    expect(appliesToPeriodConflict("sdr_reuniao", ["negocio"], CATALOG)).toBeNull();
  });
});
