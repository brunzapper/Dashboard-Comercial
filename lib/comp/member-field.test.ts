// Versão: 1.0 | Data: 02/08/2026
// memberFieldSourceError: campo de membro precisa existir em ao menos UMA
// fonte EFETIVA do fator (sources explícitas ∪ fontes dos operandos da
// fórmula); campo de OUTRA fonte era aceito e computava 0 em silêncio.
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "@/lib/records/types";
import type { SourceDef } from "@/lib/sources";

import { memberFieldSourceError } from "./member-field";

const sources: SourceDef[] = [
  {
    key: "deals",
    recordType: "negocio",
    label: "Negócios",
    shortLabel: "Neg",
    defaultPeriodField: "closed_at",
    builtin: true,
    manualEntry: false,
  },
  {
    key: "vendas_assinadas",
    recordType: "negocio",
    label: "Vendas AE",
    shortLabel: "VAE",
    defaultPeriodField: "custom:data_assinatura",
    builtin: false,
    manualEntry: false,
    parentKey: "deals",
    filter: [{ field: "stage", op: "eq", value: "Contrato assinado" }],
  },
  {
    key: "estudo",
    recordType: "venda_site",
    label: "Estudo",
    shortLabel: "Est",
    defaultPeriodField: "source_created_at",
    builtin: true,
    manualEntry: false,
  },
  {
    key: "vendas_site",
    recordType: "venda_site",
    label: "Vendas Site",
    shortLabel: "VS",
    defaultPeriodField: "source_created_at",
    builtin: false,
    manualEntry: false,
    parentKey: "estudo",
  },
  {
    key: "leads",
    recordType: "lead",
    label: "Leads",
    shortLabel: "Lead",
    defaultPeriodField: "source_created_at",
    builtin: true,
    manualEntry: false,
  },
];

const field = (over: Partial<FieldDefinition>): FieldDefinition =>
  ({
    field_key: "x",
    label: "X",
    data_type: "texto",
    formula: null,
    applies_to: null,
    ...over,
  }) as FieldDefinition;

const allFields: FieldDefinition[] = [
  field({
    field_key: "sdr_reuniao",
    label: "SDR da Reunião",
    data_type: "selecao",
    applies_to: ["lead"],
  }),
  field({
    field_key: "sdr_responsavel",
    label: "SDR Responsável",
    applies_to: ["negocio"],
  }),
  field({
    field_key: "mrr_contrato",
    label: "MRR do contrato",
    data_type: "numero",
    applies_to: ["negocio"],
  }),
  field({ field_key: "geral", label: "Campo geral", applies_to: [] }),
];

// Fórmula do fator de valor (padrão do preset): sources [] + operandos com
// escopo — as fontes efetivas saem dos refs.
const valorFormula = {
  tokens: [
    { kind: "field" as const, ref: "agg:sum:custom:mrr_contrato@vendas_assinadas" },
    { kind: "op" as const, op: "+" as const },
    { kind: "field" as const, ref: "agg:sum:mrr@vendas_site" },
  ],
};

const factor = (over: Partial<Parameters<typeof memberFieldSourceError>[0]>) => ({
  label: "Valor gerado (SDR)",
  memberField: undefined as string | undefined,
  sources: [] as string[],
  formula: valorFormula,
  ...over,
});

describe("memberFieldSourceError", () => {
  it("campo de LEAD em fator de vendas (fontes pelos operandos) é erro com fontes citadas", () => {
    const err = memberFieldSourceError(
      factor({ memberField: "custom:sdr_reuniao" }),
      allFields,
      sources
    );
    expect(err).toContain('"SDR da Reunião"');
    expect(err).toContain('"Valor gerado (SDR)"');
    expect(err).toContain("Vendas AE");
  });

  it("campo presente em UMA das fontes passa (Vendas Site sem o campo é design aceito)", () => {
    expect(
      memberFieldSourceError(
        factor({ memberField: "custom:sdr_responsavel" }),
        allFields,
        sources
      )
    ).toBeNull();
  });

  it("sources explícitas do fator valem quando presentes", () => {
    expect(
      memberFieldSourceError(
        factor({
          memberField: "custom:sdr_reuniao",
          sources: ["vendas_assinadas"],
          formula: { tokens: [{ kind: "field", ref: "agg:count:*" }] },
        }),
        allFields,
        sources
      )
    ).toContain("SDR da Reunião");
    expect(
      memberFieldSourceError(
        factor({
          memberField: "custom:sdr_reuniao",
          sources: ["leads"],
          formula: { tokens: [{ kind: "field", ref: "agg:count:*" }] },
        }),
        allFields,
        sources
      )
    ).toBeNull();
  });

  it("fail-open: sem memberField, ref não-custom, campo geral, campo fora do catálogo ou fórmula sem fontes", () => {
    expect(memberFieldSourceError(factor({}), allFields, sources)).toBeNull();
    expect(
      memberFieldSourceError(
        factor({ memberField: "stage" }),
        allFields,
        sources
      )
    ).toBeNull();
    expect(
      memberFieldSourceError(
        factor({ memberField: "custom:geral" }),
        allFields,
        sources
      )
    ).toBeNull();
    expect(
      memberFieldSourceError(
        factor({ memberField: "custom:inexistente" }),
        allFields,
        sources
      )
    ).toBeNull();
    expect(
      memberFieldSourceError(
        factor({
          memberField: "custom:sdr_reuniao",
          formula: { tokens: [{ kind: "field", ref: "agg:count:*" }] },
        }),
        allFields,
        sources
      )
    ).toBeNull();
  });
});
