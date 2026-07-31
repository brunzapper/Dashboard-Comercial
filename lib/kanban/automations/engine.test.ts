// Versão: 1.0 | Data: 27/07/2026
// Engine I/O das automações com fake-supabase (fail-closed — toda tabela
// tocada é declarada): quadro por VALOR move via update de records (carimbo
// field_modified_at + locally_modified_at, audit origin 'automation',
// bookkeeping da regra); quadro Personalizar move via upsert de
// kanban_placements SEM tocar em records; modo tarefas é fatal visível; o
// runRecordList sai com escopo explícito de org (opts.orgId).
// recalc/webhook são mockados (têm service client próprio — efeitos batch
// assertados pelas chamadas).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/records/recalc", () => ({
  recalcFormulaFieldsForRecords: vi.fn(async () => 0),
}));
vi.mock("@/lib/webhooks/emit", () => ({
  emitWebhookEvent: vi.fn(async () => undefined),
}));

import { recalcFormulaFieldsForRecords } from "@/lib/records/recalc";
import { emitWebhookEvent } from "@/lib/webhooks/emit";
import { fakeSupabase, hasStep, type RecordedQuery } from "@/tests/helpers/fake-supabase";
import { runBoardAutomations } from "./engine";
import type { AutomationRule } from "./types";

const recordRow = (id: string, stage: string) => ({
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
  opened_at: null,
  source_created_at: "2026-07-01T09:00:00-03:00",
  responsible_id: null,
  operation_id: null,
  related_lead_id: null,
  lead_time_days: null,
  custom_fields: {},
  last_synced_at: null,
  locally_modified_at: null,
  is_mock: false,
});

const RULE: AutomationRule = {
  v: 1,
  conditions: [
    { kind: "field", filter: { field: "stage", op: "eq", value: "novo" } },
    { kind: "tasks", metric: "open", op: "eq", value: 0 },
  ],
  action: { type: "move_to_column", targetKey: "quente" },
};

const ruleRow = (rule: unknown = RULE) => ({
  id: "rule-1",
  name: "Esquentar",
  enabled: true,
  position: 0,
  rule,
  last_run_at: null,
  last_error: null,
  last_moved_count: 0,
});

const boardRow = (kanban: unknown) => ({
  id: "board-1",
  organization_id: "org1",
  status: "active",
  settings: { kanban },
});

// Handler de records: distingue o load do quadro (range paginado) do estado
// fresco do move (select com source_id) pela cadeia gravada.
function recordsHandler(rows: ReturnType<typeof recordRow>[]) {
  return (q: RecordedQuery) => {
    const sel = String(q.steps.find((s) => s.method === "select")?.args[0] ?? "");
    if (sel.includes("source_id")) {
      return {
        data: rows.map((r) => ({
          id: r.id,
          field_modified_at: null,
          custom_fields: r.custom_fields,
          source_id: null,
          is_mock: r.is_mock,
        })),
        error: null,
      };
    }
    const ranges = q.steps.filter((s) => s.method === "range").length;
    return { data: ranges <= 1 ? rows : [], error: null };
  };
}

beforeEach(() => {
  vi.mocked(recalcFormulaFieldsForRecords).mockClear();
  vi.mocked(emitWebhookEvent).mockClear();
});

describe("runBoardAutomations — quadro por valor", () => {
  const kanban = {
    mode: "registros",
    source: "leads",
    groupField: "stage",
    columns: [{ key: "novo" }, { key: "quente" }],
  };

  function makeFake() {
    return fakeSupabase({
      tables: {
        kanban_automations: (q) =>
          q.steps.some((s) => s.method === "update")
            ? { data: null, error: null }
            : { data: [ruleRow()], error: null },
        dashboards: () => ({ data: boardRow(kanban), error: null }),
        data_sources: [],
        field_definitions: [],
        field_correspondences: [],
        records: recordsHandler([recordRow("r1", "novo"), recordRow("r2", "quente")]),
        record_matches: [],
        tasks: [],
        audit_log: () => ({ data: null, error: null }),
      },
    });
  }

  it("move a primeira carta que casa, com carimbo e audit 'automation'", async () => {
    const { db, queries } = makeFake();
    const summary = await runBoardAutomations(db, {
      kind: "board",
      id: "board-1",
    });
    expect(summary.fatal).toBeUndefined();
    expect(summary.evaluated).toBe(2);
    expect(summary.moved).toBe(1); // r2 já está em "quente" (no-op)
    expect(summary.ruleErrors).toEqual([]);

    // Load do quadro com escopo explícito de org (opts.orgId → runRecordList).
    const boardLoad = queries.find(
      (q) =>
        q.table === "records" &&
        q.steps.some((s) => s.method === "range")
    )!;
    expect(hasStep(boardLoad, "eq", "organization_id", "org1")).toBe(true);

    // Update do registro movido: stage + carimbos.
    const upd = queries.find(
      (q) =>
        q.table === "records" && q.steps.some((s) => s.method === "update")
    )!;
    const updArgs = upd.steps.find((s) => s.method === "update")!
      .args[0] as Record<string, unknown>;
    expect(updArgs.stage).toBe("quente");
    expect(updArgs.locally_modified_at).toBeTruthy();
    expect(
      (updArgs.field_modified_at as Record<string, string>).stage
    ).toBeTruthy();
    expect(hasStep(upd, "eq", "id", "r1")).toBe(true);

    // Audit em lote com origem 'automation' e user_id nulo.
    const audit = queries.find((q) => q.table === "audit_log")!;
    const rows = audit.steps.find((s) => s.method === "insert")!
      .args[0] as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].origin).toBe("automation");
    expect(rows[0].user_id).toBeNull();
    expect(rows[0].record_id).toBe("r1");

    // Efeitos batch: UM recalc com os movidos; webhook por registro.
    expect(recalcFormulaFieldsForRecords).toHaveBeenCalledWith(["r1"]);
    expect(emitWebhookEvent).toHaveBeenCalledTimes(1);

    // Bookkeeping da regra: rodada ok, 1 movido.
    const bk = queries.find(
      (q) =>
        q.table === "kanban_automations" &&
        q.steps.some((s) => s.method === "update")
    )!;
    const bkArgs = bk.steps.find((s) => s.method === "update")!
      .args[0] as Record<string, unknown>;
    expect(bkArgs.last_error).toBeNull();
    expect(bkArgs.last_moved_count).toBe(1);
    expect(bkArgs.last_run_at).toBeTruthy();
  });

  it("regra malformada não roda e sai em last_error", async () => {
    const { db, queries } = fakeSupabase({
      tables: {
        kanban_automations: (q) =>
          q.steps.some((s) => s.method === "update")
            ? { data: null, error: null }
            : { data: [ruleRow({ v: 99 })], error: null },
        dashboards: () => ({ data: boardRow(kanban), error: null }),
        data_sources: [],
        field_definitions: [],
        field_correspondences: [],
        records: recordsHandler([recordRow("r1", "novo")]),
        record_matches: [],
        tasks: [],
      },
    });
    const summary = await runBoardAutomations(db, {
      kind: "board",
      id: "board-1",
    });
    expect(summary.moved).toBe(0);
    expect(summary.ruleErrors[0]?.message).toMatch(/inválida/);
    const bk = queries.find(
      (q) =>
        q.table === "kanban_automations" &&
        q.steps.some((s) => s.method === "update")
    )!;
    const bkArgs = bk.steps.find((s) => s.method === "update")!
      .args[0] as Record<string, unknown>;
    expect(bkArgs.last_error).toMatch(/inválida/);
  });

  it("modo tarefas é fatal visível (nunca silêncio)", async () => {
    const { db, queries } = fakeSupabase({
      tables: {
        kanban_automations: (q) =>
          q.steps.some((s) => s.method === "update")
            ? { data: null, error: null }
            : { data: [ruleRow()], error: null },
        dashboards: () => ({ data: boardRow({ mode: "tarefas" }), error: null }),
      },
    });
    const summary = await runBoardAutomations(db, {
      kind: "board",
      id: "board-1",
    });
    expect(summary.fatal).toMatch(/tarefas/);
    const bk = queries.find(
      (q) =>
        q.table === "kanban_automations" &&
        q.steps.some((s) => s.method === "update")
    )!;
    expect(
      (bk.steps.find((s) => s.method === "update")!.args[0] as Record<string, unknown>)
        .last_error
    ).toMatch(/tarefas/);
  });
});

describe("runBoardAutomations — ação set_field", () => {
  const kanban = {
    mode: "registros",
    source: "leads",
    groupField: "stage",
    columns: [{ key: "novo" }, { key: "quente" }],
  };
  const SET_RULE: AutomationRule = {
    v: 1,
    conditions: [
      { kind: "field", filter: { field: "stage", op: "eq", value: "novo" } },
    ],
    action: {
      type: "set_field",
      field: "custom:obs",
      value: "Paulo Vitor Santos",
    },
  };
  const obsDef = {
    id: "f1",
    field_key: "obs",
    label: "Obs",
    data_type: "texto",
    options: null,
    visible_to_roles: null,
    editable_by_roles: null,
    is_local: true,
    show_in_builder: true,
    formula: null,
    allow_negative: null,
    currency_code: null,
    currency_mode: null,
    show_as_percent: null,
    sort_order: 0,
    applies_to: null,
    source_system: null,
    source_field_id: null,
    write_back: false,
  };

  function makeFake(rows: ReturnType<typeof recordRow>[]) {
    return fakeSupabase({
      tables: {
        kanban_automations: (q) =>
          q.steps.some((s) => s.method === "update")
            ? { data: null, error: null }
            : { data: [ruleRow(SET_RULE)], error: null },
        dashboards: () => ({ data: boardRow(kanban), error: null }),
        data_sources: [],
        field_definitions: [obsDef],
        field_correspondences: [],
        records: recordsHandler(rows),
        record_matches: [],
        tasks: [],
        audit_log: () => ({ data: null, error: null }),
      },
    });
  }

  it("escreve o campo com carimbos + org explícita e audit 'automation'", async () => {
    const { db, queries } = makeFake([recordRow("r1", "novo")]);
    const summary = await runBoardAutomations(db, {
      kind: "board",
      id: "board-1",
    });
    expect(summary.fatal).toBeUndefined();
    expect(summary.ruleErrors).toEqual([]);
    expect(summary.moved).toBe(1); // "moved" agrega AÇÕES (moves + sets)

    const upd = queries.find(
      (q) =>
        q.table === "records" && q.steps.some((s) => s.method === "update")
    )!;
    const updArgs = upd.steps.find((s) => s.method === "update")!
      .args[0] as Record<string, unknown>;
    expect(
      (updArgs.custom_fields as Record<string, unknown>).obs
    ).toBe("Paulo Vitor Santos");
    expect(
      (updArgs.field_modified_at as Record<string, string>).obs
    ).toBeTruthy();
    expect(updArgs.locally_modified_at).toBeTruthy();
    expect(hasStep(upd, "eq", "id", "r1")).toBe(true);
    expect(hasStep(upd, "eq", "organization_id", "org1")).toBe(true);

    const audit = queries.find((q) => q.table === "audit_log")!;
    const rows = audit.steps.find((s) => s.method === "insert")!
      .args[0] as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({
      record_id: "r1",
      field: "obs",
      new_value: "Paulo Vitor Santos",
      origin: "automation",
      user_id: null,
    });
    expect(recalcFormulaFieldsForRecords).toHaveBeenCalledWith(["r1"]);
    expect(emitWebhookEvent).toHaveBeenCalledTimes(1);

    const bk = queries.find(
      (q) =>
        q.table === "kanban_automations" &&
        q.steps.some((s) => s.method === "update")
    )!;
    expect(
      (bk.steps.find((s) => s.method === "update")!.args[0] as Record<string, unknown>)
        .last_moved_count
    ).toBe(1);
  });

  it("idempotência fim-a-fim: valor já igual não gera UPDATE nem efeitos", async () => {
    const done = {
      ...recordRow("r1", "novo"),
      custom_fields: { obs: "Paulo Vitor Santos" },
    };
    const { db, queries } = makeFake([done]);
    const summary = await runBoardAutomations(db, {
      kind: "board",
      id: "board-1",
    });
    expect(summary.fatal).toBeUndefined();
    expect(summary.moved).toBe(0);
    expect(
      queries.some(
        (q) => q.table === "records" && q.steps.some((s) => s.method === "update")
      )
    ).toBe(false);
    expect(recalcFormulaFieldsForRecords).not.toHaveBeenCalled();
    expect(emitWebhookEvent).not.toHaveBeenCalled();
  });

  it("alvo proibido (campo inexistente) vira ruleError, nunca escrita", async () => {
    const badRule: AutomationRule = {
      v: 1,
      conditions: SET_RULE.conditions,
      action: { type: "set_field", field: "custom:sumiu", value: "x" },
    };
    const { db, queries } = fakeSupabase({
      tables: {
        kanban_automations: (q) =>
          q.steps.some((s) => s.method === "update")
            ? { data: null, error: null }
            : { data: [ruleRow(badRule)], error: null },
        dashboards: () => ({ data: boardRow(kanban), error: null }),
        data_sources: [],
        field_definitions: [obsDef],
        field_correspondences: [],
        records: recordsHandler([recordRow("r1", "novo")]),
        record_matches: [],
        tasks: [],
      },
    });
    const summary = await runBoardAutomations(db, {
      kind: "board",
      id: "board-1",
    });
    expect(summary.moved).toBe(0);
    expect(summary.ruleErrors[0]?.message).toMatch(/não existe/);
    expect(
      queries.some(
        (q) => q.table === "records" && q.steps.some((s) => s.method === "update")
      )
    ).toBe(false);
  });
});

describe("runBoardAutomations — colunas Personalizar", () => {
  const kanban = {
    mode: "registros",
    source: "leads",
    columnSource: "custom",
    columns: [{ key: "novo", label: "Novo" }, { key: "feito", label: "Feito" }],
  };

  it("move por upsert de kanban_placements sem tocar em records", async () => {
    const rule: AutomationRule = {
      v: 1,
      conditions: [
        { kind: "field", filter: { field: "stage", op: "eq", value: "novo" } },
      ],
      action: { type: "move_to_column", targetKey: "feito" },
    };
    const { db, queries } = fakeSupabase({
      tables: {
        kanban_automations: (q) =>
          q.steps.some((s) => s.method === "update")
            ? { data: null, error: null }
            : { data: [ruleRow(rule)], error: null },
        dashboards: () => ({ data: boardRow(kanban), error: null }),
        data_sources: [],
        field_definitions: [],
        field_correspondences: [],
        records: recordsHandler([recordRow("r1", "novo")]),
        record_matches: [],
        tasks: [],
        kanban_placements: (q) =>
          q.steps.some((s) => s.method === "upsert")
            ? { data: null, error: null }
            : { data: [], error: null },
      },
    });
    const summary = await runBoardAutomations(db, {
      kind: "board",
      id: "board-1",
    });
    expect(summary.fatal).toBeUndefined();
    expect(summary.moved).toBe(1);

    const up = queries.find(
      (q) =>
        q.table === "kanban_placements" &&
        q.steps.some((s) => s.method === "upsert")
    )!;
    const [rows, opts] = up.steps.find((s) => s.method === "upsert")!.args as [
      Record<string, unknown>[],
      { onConflict: string },
    ];
    expect(rows[0].board_id).toBe("board-1");
    expect(rows[0].record_id).toBe("r1");
    expect(rows[0].column_key).toBe("feito");
    expect(rows[0].updated_by).toBeNull();
    expect(opts.onConflict).toBe("board_id,record_id");

    // Personalizar nunca escreve no registro (dado da visão).
    expect(
      queries.some(
        (q) => q.table === "records" && q.steps.some((s) => s.method === "update")
      )
    ).toBe(false);
    expect(recalcFormulaFieldsForRecords).not.toHaveBeenCalled();
  });
});
