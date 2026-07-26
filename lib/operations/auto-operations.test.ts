// Versão: 1.0 | Data: 26/07/2026
// Sub-operações automáticas (0106): cria com carimbo de org + perfil gerado,
// renomeia pela identidade auto_source_record_id, adota homônima sem vínculo,
// inativa quando o registro some, reativa quando volta e é idempotente.
// Cliente fake (tests/helpers).
import { describe, expect, it } from "vitest";

import { ensureAutoOperationsForSource } from "@/lib/operations/auto-operations";
import {
  fakeSupabase,
  hasStep,
  type RecordedQuery,
} from "../../tests/helpers/fake-supabase";

const PARENT = "op-parceiro";
const ORG = "org-1";

const CONFIG = {
  source_key: "parceiros",
  parent_operation_id: PARENT,
  name_field: "title",
  value_field: "custom:email",
  target_field: "custom:bitrix_uf_crm_1784828550",
  target_sources: ["leads"],
  profile_op: "eq_ci",
  enabled: true,
  organization_id: ORG,
};

const ACME = {
  id: "rec-acme",
  record_type: "parceiros",
  title: "Acme",
  custom_fields: { email: "contato@acme.com" },
};

const PROFILE_ACME = [
  {
    field: "custom:bitrix_uf_crm_1784828550",
    op: "eq_ci",
    value: "contato@acme.com",
    sources: ["leads"],
  },
];

interface Mutations {
  updates: { id: unknown; patch: Record<string, unknown> }[];
  inserts: Record<string, unknown>[];
}

function build(opts: {
  records?: unknown[];
  children?: unknown[];
  config?: Record<string, unknown> | null;
}) {
  const calls: Mutations = { updates: [], inserts: [] };
  const fake = fakeSupabase({
    tables: {
      source_auto_operations: () => ({
        data: opts.config === undefined ? CONFIG : opts.config,
        error: null,
      }),
      data_sources: () => ({ data: { record_type: "parceiros" }, error: null }),
      records: (q: RecordedQuery) => {
        const range = q.steps.find((s) => s.method === "range");
        const from = Number(range?.args[0] ?? 0);
        return { data: from === 0 ? (opts.records ?? []) : [], error: null };
      },
      operations: (q: RecordedQuery) => {
        const first = q.steps[0];
        if (first.method === "update") {
          const eq = q.steps.find((s) => s.method === "eq");
          calls.updates.push({
            id: eq?.args[1],
            patch: first.args[0] as Record<string, unknown>,
          });
          return { data: null, error: null };
        }
        if (first.method === "insert") {
          calls.inserts.push(first.args[0] as Record<string, unknown>);
          return { data: { id: `new-${calls.inserts.length}` }, error: null };
        }
        if (hasStep(q, "eq", "id", PARENT)) {
          return { data: { id: PARENT }, error: null };
        }
        return { data: opts.children ?? [], error: null };
      },
    },
  });
  return { fake, calls };
}

describe("ensureAutoOperationsForSource", () => {
  it("cria sub-operação nova com carimbo de org, vínculo e perfil gerado", async () => {
    const { fake, calls } = build({ records: [ACME], children: [] });
    const res = await ensureAutoOperationsForSource(fake.db, "parceiros");
    expect(res).toMatchObject({ configured: true, created: 1 });
    expect(calls.inserts).toEqual([
      {
        name: "Acme",
        parent_operation_id: PARENT,
        organization_id: ORG,
        auto_source_record_id: "rec-acme",
        filter: PROFILE_ACME,
      },
    ]);
  });

  it("renomeia e regenera o perfil pela identidade (auto_source_record_id)", async () => {
    const { fake, calls } = build({
      records: [ACME],
      children: [
        {
          id: "op-1",
          name: "Acme Antiga",
          active: true,
          filter: [],
          auto_source_record_id: "rec-acme",
        },
      ],
    });
    const res = await ensureAutoOperationsForSource(fake.db, "parceiros");
    expect(res).toMatchObject({ renamed: 1, created: 0 });
    expect(calls.updates).toEqual([
      {
        id: "op-1",
        patch: { name: "Acme", active: true, filter: PROFILE_ACME },
      },
    ]);
  });

  it("adota operação homônima sem vínculo em vez de duplicar", async () => {
    const { fake, calls } = build({
      records: [ACME],
      children: [
        {
          id: "op-manual",
          name: "acme",
          active: true,
          filter: [],
          auto_source_record_id: null,
        },
      ],
    });
    const res = await ensureAutoOperationsForSource(fake.db, "parceiros");
    expect(res).toMatchObject({ adopted: 1, created: 0 });
    expect(calls.updates[0]).toMatchObject({
      id: "op-manual",
      patch: { auto_source_record_id: "rec-acme", name: "Acme" },
    });
  });

  it("inativa sub-operação gerada cujo registro sumiu (nunca exclui)", async () => {
    const { fake, calls } = build({
      records: [],
      children: [
        {
          id: "op-1",
          name: "Acme",
          active: true,
          filter: PROFILE_ACME,
          auto_source_record_id: "rec-acme",
        },
      ],
    });
    const res = await ensureAutoOperationsForSource(fake.db, "parceiros");
    expect(res).toMatchObject({ deactivated: 1 });
    expect(calls.updates).toEqual([{ id: "op-1", patch: { active: false } }]);
  });

  it("reativa quando o registro volta; rodada idempotente não escreve nada", async () => {
    const inactive = {
      id: "op-1",
      name: "Acme",
      active: false,
      filter: PROFILE_ACME,
      auto_source_record_id: "rec-acme",
    };
    const first = build({ records: [ACME], children: [inactive] });
    const res1 = await ensureAutoOperationsForSource(first.fake.db, "parceiros");
    expect(res1).toMatchObject({ reactivated: 1 });
    expect(first.calls.updates).toEqual([
      { id: "op-1", patch: { name: "Acme", active: true, filter: PROFILE_ACME } },
    ]);

    const second = build({
      records: [ACME],
      children: [{ ...inactive, active: true }],
    });
    const res2 = await ensureAutoOperationsForSource(second.fake.db, "parceiros");
    expect(res2).toMatchObject({
      created: 0,
      renamed: 0,
      adopted: 0,
      reactivated: 0,
      deactivated: 0,
    });
    expect(second.calls.updates).toEqual([]);
    expect(second.calls.inserts).toEqual([]);
  });

  it("registro sem identificador é pulado (e a operação vinculada inativa)", async () => {
    const semEmail = { ...ACME, custom_fields: {} };
    const { fake, calls } = build({
      records: [semEmail],
      children: [
        {
          id: "op-1",
          name: "Acme",
          active: true,
          filter: PROFILE_ACME,
          auto_source_record_id: "rec-acme",
        },
      ],
    });
    const res = await ensureAutoOperationsForSource(fake.db, "parceiros");
    expect(res).toMatchObject({ skipped: 1, deactivated: 1 });
    expect(calls.updates).toEqual([{ id: "op-1", patch: { active: false } }]);
  });

  it("sem config habilitada não faz nada", async () => {
    const { fake, calls } = build({ config: null });
    const res = await ensureAutoOperationsForSource(fake.db, "parceiros");
    expect(res.configured).toBe(false);
    expect(calls.inserts).toEqual([]);
    expect(fake.queries.filter((q) => q.table === "records")).toEqual([]);
  });
});
