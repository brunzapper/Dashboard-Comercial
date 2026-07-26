// Versão: 1.0 | Data: 26/07/2026
// Auto-match INCREMENTAL (Parcerias, pós-sync do Bitrix): lado A restrito por
// last_synced_at, regras filtradas pelos record_types tocados, upsert com
// ignoreDuplicates preservado (nunca sobrescreve match manual) e retorno dos
// ids casados para o recalc direcionado. Cliente fake (tests/helpers).
import { describe, expect, it } from "vitest";

import { runAutoMatchIncremental } from "@/lib/records/matching-engine";
import {
  fakeSupabase,
  hasStep,
  type RecordedQuery,
} from "../../tests/helpers/fake-supabase";

const RULE = {
  id: "r1",
  label: "Leads → Parceiros",
  source_a: "lead",
  source_b: "parceiros",
  field_a_1: "custom:email_parceiro",
  field_b_1: "custom:email",
  field_a_2: null,
  field_b_2: null,
  enabled: true,
  priority: 0,
};

const SINCE = "2026-07-26T10:00:00.000Z";

// Handler de `records`: responde por record_type (1ª página; range além → []).
function recordsHandler(rowsByType: Record<string, unknown[]>) {
  return (q: RecordedQuery) => {
    const eq = q.steps.find((s) => s.method === "eq");
    const rt = String(eq?.args[1] ?? "");
    const range = q.steps.find((s) => s.method === "range");
    const from = Number(range?.args[0] ?? 0);
    return { data: from === 0 ? (rowsByType[rt] ?? []) : [], error: null };
  };
}

// Handler de `record_matches`: existentes vazio; upsert conta as linhas.
function matchesHandler() {
  return (q: RecordedQuery) => {
    const up = q.steps.find((s) => s.method === "upsert");
    if (up) {
      const rows = up.args[0] as unknown[];
      return { data: null, error: null, count: rows.length };
    }
    return { data: [], error: null };
  };
}

function build(rowsByType: Record<string, unknown[]>) {
  return fakeSupabase({
    tables: {
      match_rules: [RULE],
      records: recordsHandler(rowsByType),
      record_matches: matchesHandler(),
    },
  });
}

const LEAD = {
  id: "a1",
  record_type: "lead",
  custom_fields: { email_parceiro: "Contato@Acme.com " },
};
const PARTNER = {
  id: "b1",
  record_type: "parceiros",
  custom_fields: { email: "contato@acme.com" },
};

describe("runAutoMatchIncremental", () => {
  it("restringe o lado A por last_synced_at e casa normalizado", async () => {
    const fake = build({ lead: [LEAD], parceiros: [PARTNER] });
    const res = await runAutoMatchIncremental(fake.db, {
      touchedRecordTypes: ["lead", "negocio"],
      since: SINCE,
    });
    expect(res).toMatchObject({ rulesRun: 1, inserted: 1 });
    expect(res.recordIds.sort()).toEqual(["a1", "b1"]);

    const recQueries = fake.queries.filter((q) => q.table === "records");
    const sideA = recQueries.filter((q) =>
      hasStep(q, "eq", "record_type", "lead")
    );
    const sideB = recQueries.filter((q) =>
      hasStep(q, "eq", "record_type", "parceiros")
    );
    expect(sideA.length).toBeGreaterThan(0);
    expect(sideB.length).toBeGreaterThan(0);
    for (const q of sideA)
      expect(hasStep(q, "gte", "last_synced_at", SINCE)).toBe(true);
    for (const q of sideB)
      expect(q.steps.some((s) => s.method === "gte")).toBe(false);
  });

  it("preserva ignoreDuplicates no upsert (nunca sobrescreve manual)", async () => {
    const fake = build({ lead: [LEAD], parceiros: [PARTNER] });
    await runAutoMatchIncremental(fake.db, {
      touchedRecordTypes: ["lead"],
      since: SINCE,
    });
    const upsert = fake.queries
      .filter((q) => q.table === "record_matches")
      .flatMap((q) => q.steps)
      .find((s) => s.method === "upsert");
    expect(upsert).toBeDefined();
    expect(upsert!.args[1]).toMatchObject({
      onConflict: "record_a_id,record_b_id",
      ignoreDuplicates: true,
    });
  });

  it("regra sem record_type tocado é pulada por inteiro", async () => {
    const fake = build({});
    const res = await runAutoMatchIncremental(fake.db, {
      touchedRecordTypes: ["venda_site"],
      since: SINCE,
    });
    expect(res).toEqual({ rulesRun: 0, inserted: 0, recordIds: [] });
    expect(fake.queries.filter((q) => q.table === "records")).toEqual([]);
  });

  it("regra com SÓ o lado B tocado roda cheia (lado A sem restrição)", async () => {
    const fake = build({ lead: [LEAD], parceiros: [PARTNER] });
    await runAutoMatchIncremental(fake.db, {
      touchedRecordTypes: ["parceiros"],
      since: SINCE,
    });
    const sideA = fake.queries.filter(
      (q) => q.table === "records" && hasStep(q, "eq", "record_type", "lead")
    );
    expect(sideA.length).toBeGreaterThan(0);
    for (const q of sideA)
      expect(q.steps.some((s) => s.method === "gte")).toBe(false);
  });
});
