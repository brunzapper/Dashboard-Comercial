// Versão: 1.0 | Data: 07/08/2026
// Registry efetivo (código ∪ banco): parse FAIL-CLOSED das linhas de
// mapping_domains, colisão de key (código vence) e o filtro por record_type.
import { describe, expect, it } from "vitest";

import { MAPPING_DOMAINS, UNCLASSIFIED } from "./domains";
import {
  domainsForRecordType,
  mergeDomains,
  parseDomainRow,
  type MappingDomainRow,
} from "./registry";

function validRow(overrides: Partial<MappingDomainRow> = {}): MappingDomainRow {
  return {
    key: "porte",
    label: "Porte",
    record_types: ["meetime_outbound"],
    raw_field_key: "porte",
    raw_field_label: "Porte da empresa",
    targets: [
      { fieldKey: "porte_classificado", label: "Porte (classificado)", options: ["P", "M", "G"] },
    ],
    ...overrides,
  };
}

describe("parseDomainRow (fail-closed)", () => {
  it("linha válida vira MappingDomain sem suggest e com fallback/options", () => {
    const d = parseDomainRow(validRow());
    expect(d).not.toBeNull();
    expect(d!.key).toBe("porte");
    expect(d!.suggest).toBeUndefined();
    expect(d!.targets).toEqual([
      { fieldKey: "porte_classificado", label: "Porte (classificado)" },
    ]);
    expect(d!.fallback).toEqual({ porte_classificado: UNCLASSIFIED });
    // UNCLASSIFIED entra nas options canônicas (dropdown/validação da IA).
    expect(d!.options.porte_classificado).toEqual(["P", "M", "G", UNCLASSIFIED]);
  });

  it("key/raw_field_key fora do slug, targets vazios ou duplicados ⇒ null", () => {
    expect(parseDomainRow(validRow({ key: "Porte!" }))).toBeNull();
    expect(parseDomainRow(validRow({ raw_field_key: "custom:porte" }))).toBeNull();
    expect(parseDomainRow(validRow({ targets: [] }))).toBeNull();
    expect(parseDomainRow(validRow({ record_types: [] }))).toBeNull();
    expect(
      parseDomainRow(
        validRow({
          targets: [
            { fieldKey: "x", label: "X" },
            { fieldKey: "x", label: "X de novo" },
          ],
        })
      )
    ).toBeNull();
    expect(
      parseDomainRow(validRow({ targets: [{ fieldKey: "ok", label: "" }] }))
    ).toBeNull();
  });
});

describe("mergeDomains", () => {
  it("código ∪ dinâmicos; colisão de key: código vence e a linha é pulada", () => {
    const { domains, skipped } = mergeDomains([
      validRow(),
      validRow({ key: "cargo" }), // colide com o domínio em código
      validRow({ key: "Quebrado!" }), // malformada
    ]);
    expect(skipped).toEqual(["cargo", "Quebrado!"]);
    const keys = domains.map((d) => d.key);
    expect(keys).toEqual([...MAPPING_DOMAINS.map((d) => d.key), "porte"]);
    // O "cargo" efetivo segue sendo o de código (tem suggest).
    expect(domains.find((d) => d.key === "cargo")!.suggest).toBeDefined();
  });
});

describe("domainsForRecordType", () => {
  it("filtra a lista JÁ carregada", () => {
    const { domains } = mergeDomains([validRow({ record_types: ["lead"] })]);
    expect(domainsForRecordType(domains, "lead").map((d) => d.key)).toEqual([
      "porte",
    ]);
    expect(
      domainsForRecordType(domains, "meetime_outbound").map((d) => d.key)
    ).toEqual(["cargo", "segmento"]);
  });
});
