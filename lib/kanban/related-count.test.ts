// Versão: 1.1 | Data: 28/07/2026
// v1.1 (28/07/2026): movido junto com o módulo p/ lib/kanban/ + casos de
//   opts.extraPairs (gêmeo related_lead_id): soma 1, dedupe gêmeo × match
//   real, parceiro inexistente/record_type errado não conta.
// Contagem de conectados (condição related_count + métricas "vinculados"):
// consulta simétrica em record_matches, dedupe de par (vínculos por regras
// diferentes contam uma conexão), filtro dos parceiros em memória, predicado
// de sub-base e escopo EXPLÍCITO de org nas consultas (chamador service-role).
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

  it("extraPairs (gêmeo related_lead_id) soma 1 sem linha em record_matches", async () => {
    const { db } = fakeSupabase({
      tables: {
        record_matches: [],
        records: [leadRow("l1", "ganho")],
      },
    });
    const counts = await countRelatedBySource(
      db,
      null,
      ["p1"],
      "leads",
      [],
      [],
      BUILTIN_SOURCES,
      { extraPairs: [{ selfId: "p1", partnerId: "l1" }] }
    );
    expect(counts.get("p1")).toBe(1);
  });

  it("extraPairs deduplica gêmeo × match real do MESMO par", async () => {
    const { db } = fakeSupabase({
      tables: {
        record_matches: [{ record_a_id: "p1", record_b_id: "l1" }],
        records: [leadRow("l1", "ganho")],
      },
    });
    const counts = await countRelatedBySource(
      db,
      null,
      ["p1"],
      "leads",
      [],
      [],
      BUILTIN_SOURCES,
      { extraPairs: [{ selfId: "p1", partnerId: "l1" }] }
    );
    expect(counts.get("p1")).toBe(1);
  });

  it("extraPairs: parceiro inexistente ou de record_type errado não conta", async () => {
    // d1 é negócio — não conta na base "leads". O handler-função aplica o
    // .eq(record_type) como o banco faria (o array fixo devolveria tudo).
    const rows = [{ ...leadRow("d1", "ganho"), record_type: "negocio" }];
    const { db } = fakeSupabase({
      tables: {
        record_matches: [],
        records: (q) => ({
          data: rows.filter((r) =>
            q.steps.some(
              (s) =>
                s.method === "eq" &&
                s.args[0] === "record_type" &&
                s.args[1] === r.record_type
            )
          ),
          error: null,
        }),
      },
    });
    const counts = await countRelatedBySource(
      db,
      null,
      ["p1"],
      "leads",
      [],
      [],
      BUILTIN_SOURCES,
      {
        extraPairs: [
          { selfId: "p1", partnerId: "d1" },
          { selfId: "p1", partnerId: "sumido" },
          // selfId fora do quadro é ignorado.
          { selfId: "outro", partnerId: "d1" },
        ],
      }
    );
    expect(counts.size).toBe(0);
  });
});
