// Versão: 1.0 | Data: 26/07/2026
// Recalc DIRECIONADO (Parcerias): recalcFormulaFieldsForRecords consulta SÓ os
// ids pedidos (.in), sem varrer a tabela (.range), e dedupa a entrada. O
// service client é mockado com o fake de tests/helpers.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fakeSupabase,
  type FakeSupabase,
} from "../../tests/helpers/fake-supabase";

let fake: FakeSupabase;

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => fake.db,
}));

import { recalcFormulaFieldsForRecords } from "@/lib/records/recalc";

beforeEach(() => {
  fake = fakeSupabase({
    tables: {
      // Sem defs de fórmula (e sem chaves de data custom) — o teste é do
      // RECORTE da consulta, não do pipeline de avaliação.
      field_definitions: [],
      records: [],
    },
  });
});

describe("recalcFormulaFieldsForRecords", () => {
  it("consulta só os ids pedidos, deduplicados, sem range", async () => {
    const updated = await recalcFormulaFieldsForRecords(["a1", "b1", "a1"]);
    expect(updated).toBe(0);
    const recQueries = fake.queries.filter((q) => q.table === "records");
    expect(recQueries.length).toBe(1);
    const inStep = recQueries[0].steps.find((s) => s.method === "in");
    expect(inStep?.args).toEqual(["id", ["a1", "b1"]]);
    expect(recQueries[0].steps.some((s) => s.method === "range")).toBe(false);
  });

  it("lista vazia não toca o banco", async () => {
    const updated = await recalcFormulaFieldsForRecords([]);
    expect(updated).toBe(0);
    expect(fake.queries).toEqual([]);
  });
});
