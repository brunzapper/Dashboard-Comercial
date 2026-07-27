// Versão: 1.0 | Data: 27/07/2026
// Contagem de conectados (condição related_count): consulta simétrica em
// record_matches, dedupe de par (vínculos por regras diferentes contam uma
// conexão), filtro dos parceiros em memória, predicado de sub-base e escopo
// EXPLÍCITO de org nas consultas (chamador service-role).
import { describe, expect, it } from "vitest";

import { BUILTIN_SOURCES, type SourceDef } from "@/lib/sources";
import { fakeSupabase, hasStep } from "@/tests/helpers/fake-supabase";
import { countRelatedBySource } from "./related-count";

const leadRow = (id: string, stage: string, custom: Record<string, unknown> = {}) => ({
  id,
  record_type: "lead",
  source_system: "bitrix",
  title: id,
  pipeline: null,
  stage,
  value: null,
  mrr: null,
  currency: null,
  sale_type: null,
  channel: null,
  closed: false,
  closed_at: null,
  source_created_at: null,
  responsible_id: null,
  operation_id: null,
  related_lead_id: null,
  lead_time_days: null,
  custom_fields: custom,
  last_synced_at: null,
  locally_modified_at: null,
  is_mock: false,
});

describe("countRelatedBySource", () => {
  it("conta por origem com dedupe de par, filtro e escopo de org", async () => {
    const { db, queries } = fakeSupabase({
      tables: {
        record_matches: [
          { record_a_id: "p1", record_b_id: "l1" },
          // Direção invertida: p1 também é lado B.
          { record_a_id: "l2", record_b_id: "p1" },
          // Vínculo DUPLICADO do mesmo par (outra regra de match) — conta 1.
          { record_a_id: "p1", record_b_id: "l1" },
        ],
        records: [leadRow("l1", "ganho"), leadRow("l2", "perdido")],
      },
    });
    const counts = await countRelatedBySource(
      db,
      "org1",
      ["p1"],
      "leads",
      [{ field: "stage", op: "eq", value: "ganho" }],
      [],
      BUILTIN_SOURCES
    );
    // Só l1 passa no filtro; o par duplicado não conta duas vezes.
    expect(counts.get("p1")).toBe(1);

    const matchQuery = queries.find((q) => q.table === "record_matches")!;
    expect(
      hasStep(
        matchQuery,
        "or",
        "record_a_id.in.(p1),record_b_id.in.(p1)"
      )
    ).toBe(true);
    const partnerQuery = queries.find((q) => q.table === "records")!;
    expect(hasStep(partnerQuery, "eq", "record_type", "lead")).toBe(true);
    expect(hasStep(partnerQuery, "eq", "organization_id", "org1")).toBe(true);
  });

  it("sub-base aplica o predicado da sub além dos filtros da condição", async () => {
    const catalog: SourceDef[] = [
      ...BUILTIN_SOURCES,
      {
        key: "leads_mql",
        recordType: "lead",
        label: "Leads MQL",
        shortLabel: "MQL",
        defaultPeriodField: "source_created_at",
        builtin: false,
        manualEntry: false,
        parentKey: "leads",
        filter: [{ field: "custom:fase", op: "eq", value: "MQL" }],
        sortOrder: 0,
      },
    ];
    const { db } = fakeSupabase({
      tables: {
        record_matches: [
          { record_a_id: "p1", record_b_id: "l1" },
          { record_a_id: "p1", record_b_id: "l2" },
        ],
        records: [
          leadRow("l1", "ganho", { fase: "MQL" }),
          leadRow("l2", "ganho", { fase: "SQL" }),
        ],
      },
    });
    const counts = await countRelatedBySource(
      db,
      null,
      ["p1"],
      "leads_mql",
      [],
      [],
      catalog
    );
    expect(counts.get("p1")).toBe(1); // l2 está fora do recorte da sub
  });

  it("sem conexões → mapa vazio (contagem 0 no avaliador)", async () => {
    const { db } = fakeSupabase({ tables: { record_matches: [] } });
    const counts = await countRelatedBySource(
      db,
      null,
      ["p1"],
      "leads",
      [],
      [],
      BUILTIN_SOURCES
    );
    expect(counts.size).toBe(0);
  });
});
