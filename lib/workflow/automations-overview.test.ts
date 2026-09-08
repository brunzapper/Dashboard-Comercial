// Versão: 1.0 | Data: 08/09/2026
// A lista de automações da organização: o que ela promete é que a pessoa
// RECONHEÇA cada regra sem abrir o quadro dela — dono com rótulo humano, e as
// quebradas no topo, porque são as que exigem alguém.
import { describe, expect, it } from "vitest";

import { fakeSupabase } from "@/tests/helpers/fake-supabase";
import { loadOrgAutomations } from "./automations-overview";

const rule = {
  v: 1,
  conditions: [{ kind: "field", filter: { field: "stage", op: "eq", value: "novo" } }],
  action: { type: "set_field", field: "stage", value: "quente" },
};

const row = (over: Record<string, unknown>) => ({
  id: "a1",
  name: "Regra",
  enabled: true,
  position: 0,
  widget_id: null,
  board_id: null,
  source_key: null,
  rule,
  last_run_at: null,
  last_error: null,
  last_moved_count: 0,
  ...over,
});

function fake(rows: unknown[]) {
  return fakeSupabase({
    tables: {
      automation_rules: () => ({ data: rows, error: null }),
      widgets: () => ({
        data: [{ id: "w1", dashboard_id: "b9" }],
        error: null,
      }),
      dashboards: () => ({
        data: [
          { id: "b1", title: "Parceiros" },
          { id: "b9", title: "Painel Comercial" },
        ],
        error: null,
      }),
      data_sources: [],
      sync_config: () => ({ data: null, error: null }),
    },
  });
}

describe("loadOrgAutomations", () => {
  it("dá nome humano a cada tipo de dono", async () => {
    const { db } = fake([
      row({ id: "a1", source_key: "leads" }),
      row({ id: "a2", board_id: "b1" }),
      row({ id: "a3", widget_id: "w1" }),
    ]);
    const rows = await loadOrgAutomations(db, "org1");
    const byId = new Map(rows.map((r) => [r.id, r]));

    // Base: o rótulo curado, nunca a key crua.
    expect(byId.get("a1")?.ownerLabel).toBe("Base Leads");
    expect(byId.get("a2")?.ownerLabel).toBe("Quadro Parceiros");
    // Widget: o rótulo vem do dashboard que o contém.
    expect(byId.get("a3")?.ownerLabel).toBe("Quadro Painel Comercial");
  });

  it("leva ao quadro quando há um; regra de base não tem para onde ir", async () => {
    const { db } = fake([
      row({ id: "a1", source_key: "leads" }),
      row({ id: "a2", board_id: "b1" }),
    ]);
    const rows = await loadOrgAutomations(db, "org1");
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("a1")?.ownerHref).toBeNull();
    expect(byId.get("a2")?.ownerHref).toBe("/kanbans/b1");
  });

  it("as quebradas vêm primeiro — são as que precisam de alguém", async () => {
    const { db } = fake([
      row({ id: "ok", board_id: "b1" }),
      row({ id: "ruim", source_key: "leads", last_error: "Base sumiu." }),
    ]);
    const rows = await loadOrgAutomations(db, "org1");
    expect(rows[0].id).toBe("ruim");
  });

  it("jsonb inválido vira rule null, não derruba a lista", async () => {
    const { db } = fake([
      row({ id: "a1", source_key: "leads", rule: { v: 99 } }),
      row({ id: "a2", board_id: "b1" }),
    ]);
    const rows = await loadOrgAutomations(db, "org1");
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === "a1")?.rule).toBeNull();
    expect(rows.find((r) => r.id === "a2")?.rule).not.toBeNull();
  });

  it("recorta pela organização ativa", async () => {
    const { db, queries } = fake([row({ source_key: "leads" })]);
    await loadOrgAutomations(db, "org1");
    const q = queries.find((x) => x.table === "automation_rules");
    expect(
      q?.steps.some(
        (s) => s.method === "eq" && s.args[0] === "organization_id"
      )
    ).toBe(true);
  });
});
