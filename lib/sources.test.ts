// Versão: 1.0 | Data: 24/07/2026
// Testes dos resolvers de fonte — em especial os cientes do catálogo (0078):
// sub-fonte compartilha o record_type da PAI, então toRecordType/toSourceKey
// por identidade NÃO servem para subs. planSourceLegs é a invariante 10 em
// código: pai cobre sub (absorção, sem duplicar), sub avulsa recorta a pai, e
// "conviver"/2 subs da mesma pai viram pernas extras.
import { describe, expect, it } from "vitest";

import {
  BUILTIN_SOURCES,
  fieldAppliesToSource,
  isSubSource,
  parentKeyOf,
  planSourceLegs,
  recordTypeOf,
  rootSources,
  sourcePredicate,
  subSourcesOf,
  toRecordType,
  toSourceKey,
  type SourceDef,
} from "@/lib/sources";

const LITE_FILTER = [{ field: "pipeline", op: "eq" as const, value: "Lite" }];

// Catálogo sintético: builtins + uma fonte dinâmica (identidade) + duas
// sub-fontes da mesma pai (leads), como no exemplo real Leads/Clientes Lite.
const CATALOG: SourceDef[] = [
  ...BUILTIN_SOURCES,
  {
    key: "csv_vendas",
    recordType: "csv_vendas",
    label: "CSV Vendas",
    shortLabel: "CSV",
    defaultPeriodField: "source_created_at",
    builtin: false,
    manualEntry: true,
  },
  {
    key: "leads_lite",
    recordType: "lead",
    label: "Leads / Clientes Lite",
    shortLabel: "Lite",
    defaultPeriodField: "custom:data_lite",
    builtin: false,
    manualEntry: false,
    parentKey: "leads",
    filter: LITE_FILTER,
  },
  {
    key: "leads_mudanca",
    recordType: "lead",
    label: "Leads / Mudança de etapa",
    shortLabel: "Mudança",
    defaultPeriodField: "custom:data_mudanca",
    builtin: false,
    manualEntry: false,
    parentKey: "leads",
    filter: [{ field: "custom:etapa", op: "not_null" as const }],
  },
];

describe("toRecordType / toSourceKey (identidade, SEM catálogo)", () => {
  it("builtins mapeados; desconhecido = identidade", () => {
    expect(toRecordType("deals")).toBe("negocio");
    expect(toRecordType("estudo")).toBe("venda_site");
    expect(toRecordType("csv_vendas")).toBe("csv_vendas");
    expect(toSourceKey("negocio")).toBe("deals");
    expect(toSourceKey("csv_vendas")).toBe("csv_vendas");
  });
});

describe("recordTypeOf (ciente do catálogo)", () => {
  it("sub-fonte resolve para o record_type da PAI", () => {
    expect(recordTypeOf("leads_lite", CATALOG)).toBe("lead");
    expect(recordTypeOf("leads_mudanca", CATALOG)).toBe("lead");
  });

  it("raiz e fora do catálogo caem no fallback identidade/builtin", () => {
    expect(recordTypeOf("deals", CATALOG)).toBe("negocio");
    expect(recordTypeOf("inexistente", CATALOG)).toBe("inexistente");
  });
});

describe("sourcePredicate / relações de sub-fonte", () => {
  it("raiz → []; sub → o filter; desconhecida → []", () => {
    expect(sourcePredicate("leads", CATALOG)).toEqual([]);
    expect(sourcePredicate("leads_lite", CATALOG)).toEqual(LITE_FILTER);
    expect(sourcePredicate("nada", CATALOG)).toEqual([]);
  });

  it("isSubSource / parentKeyOf / rootSources / subSourcesOf", () => {
    expect(isSubSource("leads_lite", CATALOG)).toBe(true);
    expect(isSubSource("leads", CATALOG)).toBe(false);
    expect(parentKeyOf("leads_lite", CATALOG)).toBe("leads");
    expect(parentKeyOf("leads", CATALOG)).toBeNull();
    expect(rootSources(CATALOG).map((s) => s.key)).toEqual([
      "leads",
      "deals",
      "estudo",
      "csv_vendas",
    ]);
    expect(subSourcesOf("leads", CATALOG).map((s) => s.key)).toEqual([
      "leads_lite",
      "leads_mudanca",
    ]);
  });
});

describe("fieldAppliesToSource", () => {
  it("applies_to vazio/ausente vale para todas as fontes", () => {
    expect(fieldAppliesToSource(null, "deals", CATALOG)).toBe(true);
    expect(fieldAppliesToSource([], "leads_lite", CATALOG)).toBe(true);
  });

  it("sub-fonte herda os campos da pai (compara por record_type)", () => {
    expect(fieldAppliesToSource(["lead"], "leads_lite", CATALOG)).toBe(true);
    expect(fieldAppliesToSource(["negocio"], "leads_lite", CATALOG)).toBe(
      false
    );
  });
});

describe("planSourceLegs (invariante 10)", () => {
  it("seleção vazia = todas as fontes → allMain, sem subs", () => {
    expect(planSourceLegs(undefined, undefined, CATALOG)).toEqual({
      mainSources: [],
      allMain: true,
      extraLegs: [],
    });
    expect(planSourceLegs([], ["leads_lite"], CATALOG).allMain).toBe(true);
  });

  it("pai + sub selecionadas → sub ABSORVIDA (a pai cobre, sem duplicar)", () => {
    expect(planSourceLegs(["leads", "leads_lite"], undefined, CATALOG)).toEqual(
      { mainSources: ["leads"], allMain: false, extraLegs: [] }
    );
  });

  it("sub avulsa (pai fora) → é a fonte efetiva do record_type", () => {
    expect(planSourceLegs(["leads_lite"], undefined, CATALOG)).toEqual({
      mainSources: ["leads_lite"],
      allMain: false,
      extraLegs: [],
    });
  });

  it("pai + sub em 'conviver' → sub vira perna EXTRA", () => {
    expect(
      planSourceLegs(["leads", "leads_lite"], ["leads_lite"], CATALOG)
    ).toEqual({
      mainSources: ["leads"],
      allMain: false,
      extraLegs: ["leads_lite"],
    });
  });

  it("2 subs da mesma pai (pai fora) → 1ª na principal, 2ª extra", () => {
    expect(
      planSourceLegs(["leads_lite", "leads_mudanca"], undefined, CATALOG)
    ).toEqual({
      mainSources: ["leads_lite"],
      allMain: false,
      extraLegs: ["leads_mudanca"],
    });
  });

  it("record_types diferentes convivem na principal", () => {
    expect(
      planSourceLegs(["deals", "csv_vendas"], undefined, CATALOG)
    ).toEqual({
      mainSources: ["deals", "csv_vendas"],
      allMain: false,
      extraLegs: [],
    });
  });
});
