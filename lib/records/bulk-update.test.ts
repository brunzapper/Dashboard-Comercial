// Versão: 1.0 | Data: 31/07/2026
// Choke point de escrita em lote do contrato registros-update
// (updateRecordValuesBulk) com fake-supabase: carimbos field_modified_at +
// locally_modified_at, idempotência por item ("Sem alterações." sem UPDATE),
// mock congelado, RLS negando por item (.select vazio), data core ancorada em
// Brasília, UM recalc batelado, audit origin 'app' com user real e webhook por
// registro com o array completo de mudanças.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fakeSupabase,
  hasStep,
  type FakeSupabase,
  type RecordedQuery,
} from "../../tests/helpers/fake-supabase";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/org", () => ({
  getActiveOrgId: vi.fn(async () => "org1"),
}));
vi.mock("@/lib/records/recalc", () => ({
  recalcFormulaFieldsForRecords: vi.fn(async () => 0),
}));
vi.mock("@/lib/webhooks/emit", () => ({
  emitWebhookEvent: vi.fn(async () => undefined),
}));

import { recalcFormulaFieldsForRecords } from "@/lib/records/recalc";
import { emitWebhookEvent } from "@/lib/webhooks/emit";
import type { EntryFieldSpec } from "@/lib/import/records/types";
import { updateRecordValuesBulk } from "@/lib/records/bulk-update";

const FIELDS: EntryFieldSpec[] = [
  { key: "title", label: "Título", kind: "core", dataType: "texto" },
  { key: "closed_at", label: "Fechamento", kind: "core", dataType: "data" },
  {
    key: "custom:sdr_reuniao",
    label: "SDR da Reunião",
    kind: "custom",
    dataType: "selecao",
    options: ["Paulo Vitor Santos"],
    strictOptions: true,
  },
  { key: "custom:obs", label: "Obs", kind: "custom", dataType: "texto" },
  {
    key: "responsible_id",
    label: "Responsável",
    kind: "relation",
    dataType: "relacao",
  },
];

interface FreshFixture {
  id: string;
  is_mock?: boolean;
  custom_fields?: Record<string, unknown>;
  responsible_id?: string | null;
  operation_id?: string | null;
  closed_at?: string | null;
  denyUpdate?: boolean;
}

function makeFake(rows: FreshFixture[]): FakeSupabase {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return fakeSupabase({
    tables: {
      records: (q: RecordedQuery) => {
        const upd = q.steps.find((s) => s.method === "update");
        if (upd) {
          const id = q.steps.find((s) => s.method === "eq")?.args[1] as string;
          const row = byId.get(id);
          if (row?.denyUpdate) return { data: [], error: null };
          return { data: [{ id }], error: null };
        }
        const wanted = q.steps.find((s) => s.method === "in")?.args[1] as string[];
        return {
          data: rows
            .filter((r) => wanted.includes(r.id))
            .map((r) => ({
              id: r.id,
              is_mock: r.is_mock ?? false,
              custom_fields: r.custom_fields ?? {},
              field_modified_at: null,
              responsible_id: r.responsible_id ?? null,
              operation_id: r.operation_id ?? null,
              closed_at: r.closed_at ?? null,
              title: r.id,
            })),
          error: null,
        };
      },
      audit_log: () => ({ data: null, error: null }),
    },
  });
}

beforeEach(() => {
  vi.mocked(recalcFormulaFieldsForRecords).mockClear();
  vi.mocked(emitWebhookEvent).mockClear();
});

describe("updateRecordValuesBulk", () => {
  it("escreve custom com carimbos; no-op não gera UPDATE; mock e RLS falham por item", async () => {
    const fake = makeFake([
      { id: "r1", custom_fields: {} },
      { id: "r2", custom_fields: { sdr_reuniao: "Paulo Vitor Santos" } }, // no-op
      { id: "r3", is_mock: true },
      { id: "r4", custom_fields: {}, denyUpdate: true },
    ]);
    const out = await updateRecordValuesBulk(fake.db, ["r1", "r2", "r3", "r4"], {
      changes: { "custom:sdr_reuniao": "Paulo Vitor Santos" },
      fields: FIELDS,
      userId: "u1",
    });

    const by = new Map(out.results.map((r) => [r.id, r]));
    expect(by.get("r1")).toEqual({ id: "r1", ok: true });
    expect(by.get("r2")?.ok).toBe(true);
    expect(by.get("r2")?.message).toBe("Sem alterações.");
    expect(by.get("r3")?.ok).toBe(false);
    expect(by.get("r3")?.message).toMatch(/demonstração/);
    expect(by.get("r4")?.ok).toBe(false);
    expect(by.get("r4")?.message).toMatch(/permissão/);
    expect(out.changedCount).toBe(1);

    // Só r1 e r4 tentaram UPDATE (r2 é no-op; r3 nem chega).
    const updates = fake.queries.filter(
      (q) => q.table === "records" && q.steps.some((s) => s.method === "update")
    );
    expect(updates).toHaveLength(2);
    const updR1 = updates.find((q) => hasStep(q, "eq", "id", "r1"))!;
    const args = updR1.steps.find((s) => s.method === "update")!
      .args[0] as Record<string, unknown>;
    expect(
      (args.custom_fields as Record<string, unknown>).sdr_reuniao
    ).toBe("Paulo Vitor Santos");
    expect(
      (args.field_modified_at as Record<string, string>).sdr_reuniao
    ).toBeTruthy();
    expect(args.locally_modified_at).toBeTruthy();

    // Efeitos batelados: UM recalc só com os ESCRITOS; audit 'app' user real;
    // webhook só p/ r1.
    expect(recalcFormulaFieldsForRecords).toHaveBeenCalledTimes(1);
    expect(recalcFormulaFieldsForRecords).toHaveBeenCalledWith(["r1"]);
    const audit = fake.queries.find((q) => q.table === "audit_log")!;
    const rows = audit.steps.find((s) => s.method === "insert")!
      .args[0] as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      record_id: "r1",
      field: "sdr_reuniao",
      new_value: "Paulo Vitor Santos",
      origin: "app",
      user_id: "u1",
    });
    expect(emitWebhookEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitWebhookEvent).mock.calls[0][0]).toBe("record.updated");
  });

  it("data core ancora em Brasília; null limpa campo custom", async () => {
    const fake = makeFake([{ id: "r1", custom_fields: { obs: "velho" } }]);
    const out = await updateRecordValuesBulk(fake.db, ["r1"], {
      changes: { closed_at: "2026-07-01", "custom:obs": null },
      fields: FIELDS,
      userId: "u1",
    });
    expect(out.changedCount).toBe(1);
    const upd = fake.queries.find(
      (q) => q.table === "records" && q.steps.some((s) => s.method === "update")
    )!;
    const args = upd.steps.find((s) => s.method === "update")!
      .args[0] as Record<string, unknown>;
    // Invariante 11 (write side): dia digitado é dia de Brasília.
    expect(String(args.closed_at)).toBe("2026-07-01T00:00:00-03:00");
    expect((args.custom_fields as Record<string, unknown>).obs).toBeNull();
  });

  it("relação: grava responsible_id/operation_id resolvidos; igual não escreve", async () => {
    const fake = makeFake([
      { id: "r1", responsible_id: "old" },
      { id: "r2", responsible_id: "novo", operation_id: "op1" },
    ]);
    const out = await updateRecordValuesBulk(fake.db, ["r1", "r2"], {
      changes: { responsible_id: "Paulo Vitor Santos" },
      responsibleId: "novo",
      operationId: "op1",
      fields: FIELDS,
      userId: "u1",
    });
    expect(out.changedCount).toBe(1);
    const upd = fake.queries.find(
      (q) => q.table === "records" && q.steps.some((s) => s.method === "update")
    )!;
    expect(hasStep(upd, "eq", "id", "r1")).toBe(true);
    const args = upd.steps.find((s) => s.method === "update")!
      .args[0] as Record<string, unknown>;
    expect(args.responsible_id).toBe("novo");
    expect(args.operation_id).toBe("op1");
    const by = new Map(out.results.map((r) => [r.id, r]));
    expect(by.get("r2")?.message).toBe("Sem alterações.");
  });

  it("acima do teto lança; lista vazia não toca o banco", async () => {
    const fake = makeFake([]);
    await expect(
      updateRecordValuesBulk(
        fake.db,
        Array.from({ length: 201 }, (_, i) => `r${i}`),
        { changes: { "custom:obs": "x" }, fields: FIELDS, userId: "u1" }
      )
    ).rejects.toThrow(/Máximo de 200/);
    const empty = await updateRecordValuesBulk(fake.db, [], {
      changes: { "custom:obs": "x" },
      fields: FIELDS,
      userId: "u1",
    });
    expect(empty.results).toEqual([]);
    expect(fake.queries.filter((q) => q.table === "records")).toHaveLength(0);
  });
});
