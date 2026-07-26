// Versão: 1.0 | Data: 26/07/2026
// Agrupamento de responsáveis (0101): mapa de grupos, expansão de ids/filtros
// e colapso de opções — tudo puro (sem banco).
import { describe, expect, it } from "vitest";

import {
  EMPTY_CANON,
  buildResponsibleCanon,
  canonicalOf,
  collapseResponsibleOptions,
  expandResponsibleFilters,
  expandResponsibleIds,
  filtersReferenceResponsible,
  widgetReferencesResponsible,
} from "./responsible-canon";
import type { WidgetFilter } from "@/lib/widgets/types";

const ROWS = [
  { id: "ana", canonical_id: null },
  { id: "ana2", canonical_id: "ana" },
  { id: "ana3", canonical_id: "ana" },
  { id: "beto", canonical_id: null },
];
const CANON = buildResponsibleCanon(ROWS);

describe("buildResponsibleCanon", () => {
  it("sem apelidos retorna EMPTY_CANON (mesma referência)", () => {
    expect(buildResponsibleCanon([{ id: "x" }, { id: "y", canonical_id: null }]))
      .toBe(EMPTY_CANON);
  });

  it("monta grupo plano: qualquer membro aponta o grupo completo", () => {
    expect(CANON.canonicalById.get("ana2")).toBe("ana");
    expect(CANON.groupById.get("ana")).toEqual(["ana", "ana2", "ana3"]);
    expect(CANON.groupById.get("ana3")).toEqual(["ana", "ana2", "ana3"]);
    expect(CANON.groupById.has("beto")).toBe(false);
  });

  it("achata cadeias (defensivo) e sobrevive a ciclo sem laçar", () => {
    const chained = buildResponsibleCanon([
      { id: "a", canonical_id: "b" },
      { id: "b", canonical_id: "c" },
      { id: "c" },
    ]);
    expect(chained.canonicalById.get("a")).toBe("c");
    const cycle = buildResponsibleCanon([
      { id: "a", canonical_id: "b" },
      { id: "b", canonical_id: "a" },
    ]);
    // Ciclo: cada um resolve para o outro (não trava); grupo segue consultável.
    expect(cycle.canonicalById.size).toBe(2);
  });
});

describe("canonicalOf / expandResponsibleIds", () => {
  it("resolve principal e expande qualquer membro para o grupo", () => {
    expect(canonicalOf("ana2", CANON)).toBe("ana");
    expect(canonicalOf("beto", CANON)).toBe("beto");
    expect(expandResponsibleIds(["ana2"], CANON)).toEqual([
      "ana",
      "ana2",
      "ana3",
    ]);
    expect(expandResponsibleIds(["ana"], CANON)).toEqual([
      "ana",
      "ana2",
      "ana3",
    ]);
  });

  it("id desconhecido (ex.: uuid-zero do filtro impossível) passa intacto", () => {
    expect(
      expandResponsibleIds(["00000000-0000-0000-0000-000000000000"], CANON)
    ).toEqual(["00000000-0000-0000-0000-000000000000"]);
  });

  it("é idempotente e deduplica", () => {
    const once = expandResponsibleIds(["ana2", "beto"], CANON);
    expect(expandResponsibleIds(once, CANON)).toEqual(once);
    expect(once).toEqual(["ana", "ana2", "ana3", "beto"]);
  });
});

describe("expandResponsibleFilters", () => {
  it("eq com id de grupo vira in no grupo; eq fora de grupo fica intacto", () => {
    const filters: WidgetFilter[] = [
      { field: "responsible_id", op: "eq", value: "ana2" },
      { field: "responsible_id", op: "eq", value: "beto" },
      { field: "pipeline", op: "eq", value: "ana2" },
    ];
    const out = expandResponsibleFilters(filters, CANON);
    expect(out[0]).toEqual({
      field: "responsible_id",
      op: "in",
      value: ["ana", "ana2", "ana3"],
    });
    expect(out[1]).toBe(filters[1]);
    expect(out[2]).toBe(filters[2]);
  });

  it("in expande preservando os demais campos do filtro (sources etc.)", () => {
    const filters: WidgetFilter[] = [
      { field: "responsible_id", op: "in", value: ["ana3"], sources: ["leads"] },
    ];
    const out = expandResponsibleFilters(filters, CANON);
    expect(out[0].value).toEqual(["ana", "ana2", "ana3"]);
    expect(out[0].sources).toEqual(["leads"]);
  });

  it("eq_ci (condição de SOMASE já resolvida p/ UUID) também expande", () => {
    const out = expandResponsibleFilters(
      [{ field: "responsible_id", op: "eq_ci", value: "ana" }],
      CANON
    );
    expect(out[0]).toEqual({
      field: "responsible_id",
      op: "in",
      value: ["ana", "ana2", "ana3"],
    });
  });

  it("fast path: sem apelidos ou sem mudança real, retorna a MESMA lista", () => {
    const filters: WidgetFilter[] = [
      { field: "responsible_id", op: "eq", value: "beto" },
    ];
    expect(expandResponsibleFilters(filters, EMPTY_CANON)).toBe(filters);
    expect(expandResponsibleFilters(filters, CANON)).toBe(filters);
  });
});

describe("gates e colapso de opções", () => {
  it("filtersReferenceResponsible / widgetReferencesResponsible", () => {
    expect(filtersReferenceResponsible(undefined)).toBe(false);
    expect(
      filtersReferenceResponsible([
        { field: "responsible_id", op: "eq", value: "x" },
      ])
    ).toBe(true);
    expect(
      widgetReferencesResponsible({ dimensions: [{ field: "responsible_id" }] })
    ).toBe(true);
    expect(widgetReferencesResponsible({ filters: [], dimensions: [] })).toBe(
      false
    );
  });

  it("colapsa apelido só quando o principal está presente na lista", () => {
    const opts = [
      { value: "ana", label: "Ana Paula" },
      { value: "ana2", label: "Ana P." },
      { value: "beto", label: "Beto" },
    ];
    expect(collapseResponsibleOptions(opts, CANON)).toEqual([
      { value: "ana", label: "Ana Paula" },
      { value: "beto", label: "Beto" },
    ]);
    // Restrição sem o principal: o apelido fica (senão o grupo some inteiro).
    const soAlias = [{ value: "ana2", label: "Ana P." }];
    expect(collapseResponsibleOptions(soAlias, CANON)).toBe(soAlias);
  });
});
