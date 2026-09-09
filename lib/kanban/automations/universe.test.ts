// Versão: 1.0 | Data: 08/09/2026
// Automação com escopo de BASE (0127): o universo são os registros da base, e
// não os cards de um quadro. O que este teste protege é a fronteira — o ramo
// de Base não pode encostar em quadro nenhum (nem ler `dashboards`, nem
// consultar `kanban_placements`), e `move_to_column` tem que morrer sozinho
// pelo caminho que já existia para "coluna removida", sem guarda inventada.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/records/recalc", () => ({
  recalcFormulaFieldsForRecords: vi.fn(async () => 0),
}));
vi.mock("@/lib/webhooks/emit", () => ({
  emitWebhookEvent: vi.fn(async () => undefined),
}));

import { recalcFormulaFieldsForRecords } from "@/lib/records/recalc";
import {
  fakeSupabase,
  type RecordedQuery,
} from "@/tests/helpers/fake-supabase";
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

/** set_field: o que uma automação sem quadro sabe fazer. */
const SET_RULE: AutomationRule = {
  v: 1,
  conditions: [{ kind: "field", filter: { field: "stage", op: "eq", value: "novo" } }],
  action: { type: "set_field", field: "stage", value: "quente" },
};

/** move_to_column num escopo sem colunas — deve morrer na avaliação. */
const MOVE_RULE: AutomationRule = {
  v: 1,
  conditions: [{ kind: "field", filter: { field: "stage", op: "eq", value: "novo" } }],
  action: { type: "move_to_column", targetKey: "quente" },
};

const ruleRow = (rule: unknown) => ({
  id: "rule-1",
  name: "Regra de base",
  enabled: true,
  position: 0,
  rule,
  last_run_at: null,
  last_error: null,
  last_moved_count: 0,
  // Sem quadro-pai: a org vem da própria linha (carimbada pela action).
  organization_id: "org1",
});

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

function makeFake(rule: unknown) {
  return fakeSupabase({
    tables: {
      automation_rules: (q) =>
        q.steps.some((s) => s.method === "update")
          ? { data: null, error: null }
          : { data: [ruleRow(rule)], error: null },
      // `dashboards` NÃO é declarada de propósito: o fake é fail-closed, então
      // qualquer leitura de quadro faria o teste explodir. É assim que se
      // prova que o ramo de Base não encosta em quadro.
      data_sources: [],
      field_definitions: [],
      field_correspondences: [],
      records: recordsHandler([
        recordRow("r1", "novo"),
        recordRow("r2", "quente"),
      ]),
      record_matches: [],
      tasks: [],
      audit_log: () => ({ data: null, error: null }),
    },
  });
}

beforeEach(() => {
  vi.mocked(recalcFormulaFieldsForRecords).mockClear();
});

describe("automação com escopo de Base", () => {
  it("avalia os registros da base sem ler quadro nenhum", async () => {
    const { db, queries } = makeFake(SET_RULE);
    const summary = await runBoardAutomations(db, {
      kind: "source",
      id: "leads",
    });

    expect(summary.fatal).toBeUndefined();
    expect(summary.evaluated).toBe(2);
    // r1 casa e é escrito; r2 já está em "quente" (idempotente, consome sem
    // escrever) — a mesma semântica do escopo de quadro.
    expect(summary.moved).toBe(1);
    expect(queries.some((q) => q.table === "dashboards")).toBe(false);
    expect(queries.some((q) => q.table === "widgets")).toBe(false);
    expect(queries.some((q) => q.table === "kanban_placements")).toBe(false);
  });

  it("enxerga a base pela coluna source_key da regra", async () => {
    const { db, queries } = makeFake(SET_RULE);
    await runBoardAutomations(db, { kind: "source", id: "leads" });
    const rulesRead = queries.find(
      (q) => q.table === "automation_rules" && !q.steps.some((s) => s.method === "update")
    );
    expect(
      rulesRead?.steps.some(
        (s) => s.method === "eq" && s.args[0] === "source_key"
      )
    ).toBe(true);
  });

  it("mover de coluna morre na avaliação, com motivo — nunca em silêncio", async () => {
    const { db } = makeFake(MOVE_RULE);
    const summary = await runBoardAutomations(db, {
      kind: "source",
      id: "leads",
    });

    expect(summary.moved).toBe(0);
    expect(summary.ruleErrors).toHaveLength(1);
    // Reusa a mensagem que já existia para "coluna removida do quadro": sem
    // colunas, o alvo simplesmente não existe.
    expect(summary.ruleErrors[0].message).toMatch(/não existe no quadro/i);
  });

  it("base inexistente é fatal legível, não uma rodada vazia", async () => {
    const { db } = makeFake(SET_RULE);
    const summary = await runBoardAutomations(db, {
      kind: "source",
      id: "base_que_sumiu",
    });
    expect(summary.fatal).toMatch(/não existe mais/i);
    expect(summary.moved).toBe(0);
  });

  it("escreve local: sem quadro não há toggle de devolver ao CRM", async () => {
    const { db, queries } = makeFake(SET_RULE);
    await runBoardAutomations(db, { kind: "source", id: "leads" });
    // O write-back enfileira em bitrix_writeback_queue; a tabela não está
    // declarada no fake, então qualquer tentativa explodiria o teste.
    expect(queries.some((q) => q.table === "bitrix_writeback_queue")).toBe(false);
    expect(recalcFormulaFieldsForRecords).toHaveBeenCalled();
  });
});
