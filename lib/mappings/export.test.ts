// Versão: 1.0 | Data: 07/08/2026
// Export do domínio: o CSV template (pendências) preenchido faz round-trip
// pelo conversor + validador REAIS do contrato; o JSON de trabalho carrega
// categorias + mapeados + pendências.
import { describe, expect, it } from "vitest";

import { csvToClassifyJson } from "@/lib/import/mappings/csv";
import { validateMappingsClassify } from "@/lib/import/mappings/validate";
import type { MappingsClassifyContext } from "@/lib/import/mappings/types";
import type { DomainOverview } from "./overview";
import { domainCsv, domainJson } from "./export";

const overview: DomainOverview = {
  key: "porte",
  label: "Porte",
  rawFieldLabel: "Porte da empresa",
  targets: [{ fieldKey: "porte_classificado", label: "Porte (classificado)" }],
  optionsByTarget: { porte_classificado: ["Pequena", "Média", "Grande"] },
  mappings: [
    {
      id: "1",
      rawValue: "PME",
      rawNorm: "pme",
      outputs: { porte_classificado: "Média" },
      origin: "manual",
    },
  ],
  unmapped: [
    { value: "Startup early", count: 4 },
    { value: "Corporação", count: 2 },
  ],
  recordsWithValue: 6,
  system: false,
};

const ctx: MappingsClassifyContext = {
  domainKey: overview.key,
  domainLabel: overview.label,
  rawFieldLabel: overview.rawFieldLabel,
  targets: overview.targets,
  optionsByTarget: overview.optionsByTarget,
  pending: overview.unmapped.map((u) => ({
    value: u.value,
    norm: u.value.trim().toLowerCase(),
    count: u.count,
  })),
};

describe("domainCsv", () => {
  it("template das pendências preenchido cola de volta (round-trip real)", () => {
    const csv = domainCsv(overview);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("﻿valor;porte_classificado");
    expect(lines).toHaveLength(3); // header + 2 pendências (mapeados FORA)
    // "IA externa" preenche as colunas vazias:
    const filled = lines
      .map((l, i) => (i === 0 ? l : l.replace(/;$/, i === 1 ? ";Pequena" : ";Grande")))
      .join("\r\n");
    const conv = csvToClassifyJson(filled, ctx);
    expect(conv.ok, conv.ok ? "" : conv.errors.join("; ")).toBe(true);
    if (!conv.ok) return;
    const res = validateMappingsClassify(conv.json, ctx);
    expect(res.errors).toEqual([]);
    expect(res.items.map((i) => i.outputs.porte_classificado)).toEqual([
      "Pequena",
      "Grande",
    ]);
  });
});

describe("domainJson", () => {
  it("dump de trabalho: categorias + mapeados + pendências", () => {
    const parsed = JSON.parse(domainJson(overview));
    expect(parsed.dominio).toBe("porte");
    expect(parsed.categorias_aceitas.porte_classificado).toEqual([
      "Pequena",
      "Média",
      "Grande",
    ]);
    expect(parsed.mapeados).toEqual([
      { valor: "PME", saidas: { porte_classificado: "Média" }, origem: "manual" },
    ]);
    expect(parsed.pendentes).toEqual([
      { valor: "Startup early", registros: 4 },
      { valor: "Corporação", registros: 2 },
    ]);
  });
});
