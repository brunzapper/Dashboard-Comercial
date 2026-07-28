// Versão: 1.0 | Data: 28/07/2026
// Testes do módulo canônico de opções do campo de período por base (0110 —
// lib/source-date-fields.ts, puro): candidatos custom de DATA (exclui override
// core da 0086, tipos não-data e applies_to de outra base; sub herda o
// record_type da pai), lista "só colunas com dados" (fallback core p/ base sem
// linhas; filtragem pelo set do probe; valor salvo sempre presente, com rótulo
// do catálogo ou cru quando o campo foi excluído) e ensurePeriodOption no-op
// quando o valor já está na lista.
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "@/lib/records/types";
import {
  ALWAYS_FILLED_CORE_PERIOD_FIELDS,
  buildCustomDateFieldOptions,
  buildPeriodFieldOptions,
  CORE_PERIOD_FIELD_OPTIONS,
  ensurePeriodOption,
  periodFieldLabel,
} from "@/lib/source-date-fields";
import type { SourceDef } from "@/lib/sources";

function src(key: string, extra: Partial<SourceDef> = {}): SourceDef {
  return {
    key,
    recordType: key,
    label: key,
    shortLabel: key,
    defaultPeriodField: "source_created_at",
    builtin: false,
    manualEntry: true,
    ...extra,
  };
}

function def(
  field_key: string,
  extra: Partial<FieldDefinition> = {}
): FieldDefinition {
  return {
    id: field_key,
    field_key,
    label: field_key,
    data_type: "data",
    options: [],
    visible_to_roles: [],
    editable_by_roles: [],
    is_local: false,
    sort_order: 0,
    ...extra,
  };
}

// Catálogo: pai "parceiros" + sub que herda o record_type dela.
const SOURCES: SourceDef[] = [
  src("parceiros"),
  src("outra"),
  { ...src("parceiros_ativos", { recordType: "parceiros" }), parentKey: "parceiros", filter: [] },
];

const FIELDS: FieldDefinition[] = [
  def("data_contrato", { label: "Data do contrato", applies_to: ["parceiros"] }),
  def("valor", { label: "Valor", data_type: "numero", applies_to: ["parceiros"] }),
  def("data_geral", { label: "Data geral" }), // applies_to vazio = todas
  def("data_alheia", { label: "Data alheia", applies_to: ["outra"] }),
  // Override core da 0086: data_type 'data' + applies_to vazio — NUNCA vira
  // opção `custom:closed_at`.
  def("closed_at", { label: "Fechamento", source_system: "core" }),
];

describe("buildCustomDateFieldOptions", () => {
  it("filtra por data, exclui override core e applies_to de outra base", () => {
    expect(buildCustomDateFieldOptions(FIELDS, "parceiros", SOURCES)).toEqual([
      { value: "custom:data_contrato", label: "Data do contrato" },
      { value: "custom:data_geral", label: "Data geral" },
    ]);
  });

  it("sub-base resolve pelo record_type da pai", () => {
    expect(
      buildCustomDateFieldOptions(FIELDS, "parceiros_ativos", SOURCES).map(
        (o) => o.value
      )
    ).toEqual(["custom:data_contrato", "custom:data_geral"]);
  });
});

describe("buildPeriodFieldOptions", () => {
  const customOptions = buildCustomDateFieldOptions(FIELDS, "parceiros", SOURCES);

  it("base sem linhas não-mock cai nas colunas core, mesmo com candidatos", () => {
    expect(
      buildPeriodFieldOptions({
        customOptions,
        hasRows: false,
        filled: new Set(),
      })
    ).toEqual(CORE_PERIOD_FIELD_OPTIONS);
  });

  it("filtra core e custom pelo set de preenchidos", () => {
    const filled = new Set([
      ...ALWAYS_FILLED_CORE_PERIOD_FIELDS,
      "source_created_at",
      "custom:data_contrato",
    ]);
    expect(
      buildPeriodFieldOptions({ customOptions, hasRows: true, filled }).map(
        (o) => o.value
      )
    ).toEqual([
      "source_created_at",
      "created_at",
      "updated_at",
      "custom:data_contrato",
    ]);
  });

  it("valor salvo vazio é injetado com o rótulo do catálogo", () => {
    const options = buildPeriodFieldOptions({
      customOptions,
      hasRows: true,
      filled: new Set(["created_at"]),
      savedValue: "custom:data_geral",
    });
    expect(options).toContainEqual({
      value: "custom:data_geral",
      label: "Data geral",
    });
  });

  it("valor salvo de campo excluído é injetado com o valor cru", () => {
    const options = buildPeriodFieldOptions({
      customOptions,
      hasRows: true,
      filled: new Set(["created_at"]),
      savedValue: "custom:sumiu",
    });
    expect(options).toContainEqual({
      value: "custom:sumiu",
      label: "custom:sumiu",
    });
  });
});

describe("ensurePeriodOption / periodFieldLabel", () => {
  it("no-op quando o valor já está na lista", () => {
    const options = [{ value: "closed_at", label: "Data de fechamento" }];
    expect(ensurePeriodOption(options, "closed_at")).toBe(options);
  });

  it("injeta core ausente com o rótulo canônico", () => {
    expect(ensurePeriodOption([], "opened_at")).toEqual([
      { value: "opened_at", label: "Data de abertura" },
    ]);
  });

  it("periodFieldLabel: lista dada → core → valor cru", () => {
    const custom = [{ value: "custom:x", label: "X" }];
    expect(periodFieldLabel("custom:x", custom)).toBe("X");
    expect(periodFieldLabel("updated_at", custom)).toBe("Atualizado no app");
    expect(periodFieldLabel("custom:sumiu", custom)).toBe("custom:sumiu");
  });
});
