// Versão: 1.0 | Data: 03/08/2026
// GUARDA das caudas de pós-ingestão — espelho executável do conserto do 504:
// as rotas de push (/api/sync/sheets e /api/ingest/[source]) NUNCA voltam a
// chamar a cauda global (runAutoMatch + recalcAllFormulaFields — O(N) na
// tabela inteira, estourava o teto de 60s da Vercel a cada push); ambas
// passam pelo choke point incremental lib/sync/post-ingest.ts. Rotas vivem em
// app/** (fora do include do vitest) — a guarda é estática, como
// rpc-parity.test.ts; o helper em si é testado funcionalmente abaixo.
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeSupabase } from "./helpers/fake-supabase";

const ROUTES = [
  "app/api/sync/sheets/route.ts",
  "app/api/ingest/[source]/route.ts",
];

describe("rotas de push usam a cauda incremental", () => {
  for (const route of ROUTES) {
    it(route, () => {
      const src = readFileSync(path.join(__dirname, "..", route), "utf8")
        // Comentários fora: os cabeçalhos CITAM a cauda antiga ao explicar o
        // conserto — a guarda é sobre o CÓDIGO (imports/chamadas).
        .replace(/\/\/.*$/gm, "");
      // `runAutoMatch(` não casa `runAutoMatchIncremental(` — o sufixo difere.
      expect(src).not.toMatch(/\brunAutoMatch\s*\(/);
      expect(src).not.toMatch(/\brecalcAllFormulaFields\b/);
      expect(src).toContain("runIncrementalPostSync");
    });
  }
});

// ---------------------------------------------------------------------------
// runIncrementalPostSync (funcional, fake client)

let fake: FakeSupabase;

vi.mock("@/lib/supabase/service", () => ({
  // recalcFormulaFieldsForRecords cria o próprio service client.
  createServiceClient: () => fake.db,
}));

import { runIncrementalPostSync } from "@/lib/sync/post-ingest";

beforeEach(() => {
  fake = fakeSupabase({
    tables: {
      match_rules: [],
      record_matches: [{ record_a_id: "t1", record_b_id: "p1" }],
      // Sem defs de fórmula — o contrato aqui é o RECORTE das consultas.
      field_definitions: [],
      records: [],
    },
  });
});

describe("runIncrementalPostSync", () => {
  it("orçamento estourado pula tudo (best-effort é limitado por TEMPO)", async () => {
    const res = await runIncrementalPostSync(fake.db, {
      recordTypes: ["venda_site"],
      since: "2026-08-03T00:00:00Z",
      touchedIds: ["t1"],
      budgetUntil: Date.now() - 1,
    });
    expect(res.ran).toBe(false);
    expect(fake.queries).toEqual([]);
  });

  it("sem ids tocados não toca o banco", async () => {
    const res = await runIncrementalPostSync(fake.db, {
      recordTypes: ["venda_site"],
      since: "2026-08-03T00:00:00Z",
      touchedIds: [],
      budgetUntil: Date.now() + 60_000,
    });
    expect(res.ran).toBe(false);
    expect(fake.queries).toEqual([]);
  });

  it("expande parceiros já casados e recalca touched ∪ parceiros por .in", async () => {
    const res = await runIncrementalPostSync(fake.db, {
      recordTypes: ["venda_site"],
      since: "2026-08-03T00:00:00Z",
      touchedIds: ["t1"],
      budgetUntil: Date.now() + 60_000,
    });
    expect(res.ran).toBe(true);

    // Auto-match incremental consultou as regras (nenhuma habilitada aqui).
    expect(fake.queries.filter((q) => q.table === "match_rules")).toHaveLength(1);

    // Parceiros de t1 em record_matches (qualquer direção).
    const matchQ = fake.queries.filter((q) => q.table === "record_matches");
    expect(matchQ).toHaveLength(1);
    const orStep = matchQ[0].steps.find((s) => s.method === "or");
    expect(orStep?.args[0]).toBe(
      "record_a_id.in.(t1),record_b_id.in.(t1)"
    );

    // Recalc DIRECIONADO: .in nos ids (nunca .range na tabela inteira).
    const recQ = fake.queries.filter((q) => q.table === "records");
    expect(recQ).toHaveLength(1);
    const inStep = recQ[0].steps.find((s) => s.method === "in");
    expect(inStep?.args).toEqual(["id", ["t1", "p1"]]);
    expect(recQ[0].steps.some((s) => s.method === "range")).toBe(false);
  });
});
