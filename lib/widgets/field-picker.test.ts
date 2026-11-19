// Versão: 1.0 | Data: 19/11/2026
import { describe, expect, it } from "vitest";

import type { SourceDef } from "@/lib/sources";
import type { AvailableField } from "./fields";
import {
  ALL_BASES_GROUP,
  COMMON_FIELDS_GROUP,
  organizeFieldOptions,
  SAVED_METRICS_GROUP,
  widgetRootKeys,
} from "./field-picker";

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

const CATALOG: SourceDef[] = [
  src({ key: "leads", recordType: "lead", label: "Leads", shortLabel: "Leads", fieldLabels: { "core:stage": "Etapa do lead" } }),
  src({ key: "deals", recordType: "negocio", label: "Negócios", shortLabel: "Deals", fieldLabels: { "core:stage": "Fase do negócio" } }),
  src({ key: "deals_ent", recordType: "negocio", label: "Ent", shortLabel: "Ent", parentKey: "deals" }),
];

const f = (over: Partial<AvailableField>): AvailableField => ({
  field: "x",
  label: "X",
  isNumeric: false,
  isDate: false,
  ...over,
});

const AVAILABLE: AvailableField[] = [
  f({ field: "stage", label: "Etapa" }),
  f({ field: "closed_at", label: "Data de fechamento", isDate: true }),
  f({ field: "custom:segmento", label: "Segmento", source: "deals", code: "UF_CRM_9" }),
  f({ field: "custom:mrr", label: "MRR contrato", source: "deals", isNumeric: true }),
  f({ field: "custom:origem_lead", label: "Origem", source: "leads" }),
  f({ field: "unified:fonte", label: "↔ Fonte", unified: true }),
  f({ field: "custom:conv", label: "Conversão", aggCalc: true, calc: true }),
];

const opts = () =>
  AVAILABLE.map((a) => ({ value: a.field, label: a.label, group: "x" }));

describe("organizeFieldOptions", () => {
  it("UMA Base: núcleo entra na Base com o rótulo dela; outra Base vai p/ 'Fora do widget'", () => {
    const out = organizeFieldOptions(
      [{ value: "*", label: "Contagem" }, ...opts()],
      { available: AVAILABLE, catalog: CATALOG, widgetSources: ["deals_ent"] }
    );
    expect(out[0].value).toBe("*");
    expect(out[1].group).toBe(SAVED_METRICS_GROUP);
    expect(out[2].group).toBe(COMMON_FIELDS_GROUP);
    const stage = out.find((o) => o.value === "stage")!;
    expect(stage.label).toBe("Fase do negócio");
    expect(stage.group).toBe("Deals · Principais");
    expect(out.find((o) => o.value === "closed_at")!.group).toBe("Deals · Datas");
    expect(out.find((o) => o.value === "custom:mrr")!.group).toBe("Deals · Números");
    const seg = out.find((o) => o.value === "custom:segmento")!;
    expect(seg.searchText).toBe("UF_CRM_9");
    const other = out.find((o) => o.value === "custom:origem_lead")!;
    expect(other.group).toBe("Fora do widget · Leads");
    expect(other.title).toMatch(/não consulta/);
    expect(out[out.length - 1].value).toBe("custom:origem_lead");
  });

  it("várias Bases: núcleo em 'Todas as Bases', sem rótulo de uma só Base", () => {
    const out = organizeFieldOptions(opts(), {
      available: AVAILABLE,
      catalog: CATALOG,
      widgetSources: ["deals", "leads"],
    });
    const stage = out.find((o) => o.value === "stage")!;
    expect(stage.label).toBe("Etapa");
    expect(stage.group).toBe(`${ALL_BASES_GROUP} · Principais`);
    expect(out.find((o) => o.value === "custom:origem_lead")!.group).toBe(
      "Leads · Listas e textos"
    );
  });

  it("mantém todos os valores (só reordena)", () => {
    const out = organizeFieldOptions(opts(), {
      available: AVAILABLE,
      catalog: CATALOG,
      widgetSources: [],
    });
    expect(out.map((o) => o.value).sort()).toEqual(AVAILABLE.map((a) => a.field).sort());
  });

  it("raízes do widget", () => {
    expect(widgetRootKeys(["deals_ent", "leads"], CATALOG)).toEqual(["leads", "deals"]);
  });
});
