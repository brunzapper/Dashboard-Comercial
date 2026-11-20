// Versão: 1.0 | Data: 19/11/2026
import { describe, expect, it } from "vitest";

import type { SourceDef } from "@/lib/sources";
import { coreEditChoices, rootSourceOf, sharedBaseFieldLabel } from "./base-core";

const src = (over: Partial<SourceDef>): SourceDef => ({
  key: "x",
  recordType: "x",
  label: "X",
  shortLabel: "X",
  defaultPeriodField: "source_created_at",
  builtin: false,
  manualEntry: false,
  ...over,
});

const SOURCES: SourceDef[] = [
  src({ key: "leads", recordType: "lead", fieldLabels: { "core:stage": "Etapa do lead" } }),
  src({ key: "deals", recordType: "negocio", fieldLabels: { "core:stage": "Fase do negócio" } }),
  src({ key: "deals_ent", recordType: "negocio", parentKey: "deals" }),
  src({ key: "meetime", recordType: "meetime" }),
];

const DEAL_STAGES = [
  { value: "Novas Oportunidades", group: "Vendas" },
  { value: "Estruturação da proposta", group: "Vendas" },
  { value: "Demo", group: "Special Deals" },
];

describe("rootSourceOf", () => {
  it("devolve a raiz, nunca a sub-base", () => {
    expect(rootSourceOf(SOURCES, "negocio")?.key).toBe("deals");
    expect(rootSourceOf(SOURCES, null)).toBeUndefined();
  });
});

describe("sharedBaseFieldLabel", () => {
  it("uma Base com rótulo próprio ⇒ o rótulo dela", () => {
    expect(sharedBaseFieldLabel(SOURCES, ["negocio", "negocio"], "stage")).toBe(
      "Fase do negócio"
    );
  });
  it("Bases diferentes ⇒ null (o rótulo geral vale para as duas)", () => {
    expect(sharedBaseFieldLabel(SOURCES, ["negocio", "lead"], "stage")).toBeNull();
  });
  it("Base sem rótulo próprio ou desconhecida ⇒ null", () => {
    expect(sharedBaseFieldLabel(SOURCES, ["meetime"], "stage")).toBeNull();
    expect(sharedBaseFieldLabel(SOURCES, ["fantasma"], "stage")).toBeNull();
    expect(sharedBaseFieldLabel(SOURCES, [], "stage")).toBeNull();
  });
});

describe("coreEditChoices", () => {
  it("só as fases do pipeline do registro", () => {
    expect(coreEditChoices(DEAL_STAGES, "Vendas", "Novas Oportunidades")).toEqual([
      { value: "Novas Oportunidades", label: "Novas Oportunidades" },
      { value: "Estruturação da proposta", label: "Estruturação da proposta" },
    ]);
  });
  it("valor atual fora da lista entra primeiro (nunca vira '—')", () => {
    const out = coreEditChoices(DEAL_STAGES, "Vendas", "Fase antiga");
    expect(out?.[0]).toEqual({ value: "Fase antiga", label: "Fase antiga" });
    expect(out).toHaveLength(3);
  });
  it("pipeline sem casar ⇒ todas, com o pipeline no rótulo", () => {
    expect(coreEditChoices(DEAL_STAGES, null, "Demo")).toEqual([
      { value: "Novas Oportunidades", label: "Vendas · Novas Oportunidades" },
      { value: "Estruturação da proposta", label: "Vendas · Estruturação da proposta" },
      { value: "Demo", label: "Special Deals · Demo" },
    ]);
  });
  it("sem opções declaradas ⇒ null (comportamento anterior)", () => {
    expect(coreEditChoices(null, "Vendas", "x")).toBeNull();
    expect(coreEditChoices([], "Vendas", "x")).toBeNull();
  });
});
