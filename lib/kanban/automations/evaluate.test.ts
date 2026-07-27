// Versão: 1.0 | Data: 27/07/2026
// Avaliador puro das automações do kanban: parse fail-closed, condições das 4
// famílias (mescláveis em E na MESMA regra), first-match-wins, guardas de
// mock/overflow/coluna sumida e dias de calendário com todayIso fixo.
import { describe, expect, it } from "vitest";

import type { RecordRow } from "@/lib/records/types";
import type { KanbanColumn } from "../types";
import {
  daysSince,
  decideMoves,
  evaluateCondition,
  fieldFilterMatches,
  type CardFacts,
  type EvalContext,
} from "./evaluate";
import {
  parseAutomationRule,
  relatedCountKey,
  type AutomationCondition,
  type AutomationRow,
  type AutomationRule,
} from "./types";

const TODAY = "2026-07-27";

function record(over: Partial<RecordRow> = {}): RecordRow {
  return {
    id: "r1",
    record_type: "negocio",
    source_system: "bitrix",
    title: "Parceiro X",
    pipeline: null,
    stage: "novo",
    value: 1500,
    mrr: null,
    currency: null,
    sale_type: null,
    channel: null,
    closed: false,
    closed_at: null,
    source_created_at: "2026-07-10T09:00:00-03:00",
    responsible_id: null,
    operation_id: null,
    related_lead_id: null,
    lead_time_days: null,
    custom_fields: { fonte: "Inbound" },
    last_synced_at: null,
    locally_modified_at: null,
    ...over,
  };
}

function facts(over: Partial<CardFacts> = {}): CardFacts {
  return {
    record: record(),
    columnKey: "novo",
    isMock: false,
    openTasks: 0,
    overdueTasks: 0,
    relatedCounts: {},
    fieldModifiedAt: null,
    sourceCreatedAt: "2026-07-10T09:00:00-03:00",
    placementUpdatedAt: null,
    ...over,
  };
}

const COLUMNS: KanbanColumn[] = [
  { key: "novo", label: "Novo" },
  { key: "quente", label: "Quente" },
  { key: "__outros__", label: "Outros", noDrop: true },
];

const CTX: EvalContext = { available: [], todayIso: TODAY, columns: COLUMNS };

function rule(
  id: string,
  conditions: AutomationCondition[],
  targetKey = "quente",
  position = 0
): AutomationRow {
  return {
    id,
    name: id,
    enabled: true,
    position,
    rule: { v: 1, conditions, action: { type: "move_to_column", targetKey } },
    last_run_at: null,
    last_error: null,
    last_moved_count: 0,
  };
}

describe("parseAutomationRule", () => {
  const ok: AutomationRule = {
    v: 1,
    conditions: [{ kind: "tasks", metric: "open", op: "eq", value: 0 }],
    action: { type: "move_to_column", targetKey: "quente" },
  };

  it("aceita regra válida (round-trip do jsonb)", () => {
    expect(parseAutomationRule(JSON.parse(JSON.stringify(ok)))).toEqual(ok);
  });

  it("fail-closed: estrutura fora do contrato vira null", () => {
    expect(parseAutomationRule(null)).toBeNull();
    expect(parseAutomationRule({})).toBeNull();
    expect(parseAutomationRule({ ...ok, v: 2 })).toBeNull();
    expect(parseAutomationRule({ ...ok, conditions: [] })).toBeNull();
    expect(
      parseAutomationRule({ ...ok, conditions: [{ kind: "x" }] })
    ).toBeNull();
    expect(
      parseAutomationRule({
        ...ok,
        action: { type: "move_to_column", targetKey: "" },
      })
    ).toBeNull();
    expect(
      parseAutomationRule({ ...ok, action: { type: "delete" } })
    ).toBeNull();
  });

  it("related_count: rejeita filtro com ref match: (1 nível só)", () => {
    expect(
      parseAutomationRule({
        ...ok,
        conditions: [
          {
            kind: "related_count",
            source: "leads",
            filters: [{ field: "match:deals:stage", op: "eq", value: "x" }],
            op: "gte",
            value: 1,
          },
        ],
      })
    ).toBeNull();
  });
});

describe("daysSince", () => {
  it("dias de calendário pelo prefixo YYYY-MM-DD (ignora hora/fuso)", () => {
    expect(daysSince("2026-07-20T23:59:00-03:00", TODAY)).toBe(7);
    expect(daysSince("2026-07-27", TODAY)).toBe(0);
    expect(daysSince("2026-08-01", TODAY)).toBe(-5);
  });

  it("sem data válida → null", () => {
    expect(daysSince(null, TODAY)).toBeNull();
    expect(daysSince("", TODAY)).toBeNull();
    expect(daysSince("ontem", TODAY)).toBeNull();
  });
});

describe("fieldFilterMatches", () => {
  const rawOf = (r: RecordRow) => (ref: string) =>
    ref.startsWith("custom:")
      ? r.custom_fields?.[ref.slice(7)]
      : (r as unknown as Record<string, unknown>)[ref];

  it("espelha a semântica dos widgets (trim/case-insensitive/null≡'')", () => {
    const r = record({ stage: "  Novo " });
    expect(
      fieldFilterMatches({ field: "stage", op: "eq", value: "novo" }, rawOf(r))
    ).toBe(true);
    expect(
      fieldFilterMatches({ field: "closed_at", op: "is_null" }, rawOf(r))
    ).toBe(true);
    expect(
      fieldFilterMatches({ field: "value", op: "gt", value: 1000 }, rawOf(r))
    ).toBe(true);
    expect(
      fieldFilterMatches(
        { field: "custom:fonte", op: "in", value: ["Inbound", "Outbound"] },
        rawOf(r)
      )
    ).toBe(true);
  });

  it("ilike local: contém case-insensitive; null nunca casa", () => {
    const r = record({ title: "Parceria Alfa" });
    expect(
      fieldFilterMatches({ field: "title", op: "ilike", value: "alfa" }, rawOf(r))
    ).toBe(true);
    expect(
      fieldFilterMatches(
        { field: "pipeline", op: "ilike", value: "x" },
        rawOf(r)
      )
    ).toBe(false);
  });

  it("fail-closed: op desconhecido ou valor não escalar → false", () => {
    const r = record();
    expect(
      fieldFilterMatches(
        { field: "stage", op: "xx" as never, value: "novo" },
        rawOf(r)
      )
    ).toBe(false);
    expect(
      fieldFilterMatches(
        { field: "stage", op: "eq", value: { a: 1 } },
        rawOf(r)
      )
    ).toBe(false);
  });
});

describe("evaluateCondition", () => {
  it("field resolve refs pelo catálogo (match: via __match)", () => {
    const partner = record({ id: "p1", stage: "ganho" });
    const f = facts({ record: record({ __match: { leads: partner } }) });
    expect(
      evaluateCondition(
        {
          kind: "field",
          filter: { field: "match:leads:stage", op: "eq", value: "ganho" },
        },
        f,
        CTX
      )
    ).toBe(true);
  });

  it("related_count compara pela chave canônica (ausente = 0)", () => {
    const cond: AutomationCondition = {
      kind: "related_count",
      source: "leads",
      filters: [{ field: "stage", op: "eq", value: "ganho" }],
      op: "gte",
      value: 3,
    };
    expect(
      evaluateCondition(
        cond,
        facts({ relatedCounts: { [relatedCountKey(cond)]: 5 } }),
        CTX
      )
    ).toBe(true);
    expect(evaluateCondition(cond, facts(), CTX)).toBe(false);
  });

  it("tasks: abertas × atrasadas", () => {
    expect(
      evaluateCondition(
        { kind: "tasks", metric: "open", op: "eq", value: 0 },
        facts({ openTasks: 0 }),
        CTX
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        { kind: "tasks", metric: "overdue", op: "gte", value: 1 },
        facts({ overdueTasks: 2 }),
        CTX
      )
    ).toBe(true);
  });

  it("time: base ausente não casa; gte/lte por dia de calendário", () => {
    expect(
      evaluateCondition(
        { kind: "time", basis: { type: "in_column" }, op: "gte", days: 1 },
        facts({ placementUpdatedAt: null }),
        CTX
      )
    ).toBe(false);
    expect(
      evaluateCondition(
        { kind: "time", basis: { type: "created" }, op: "gte", days: 10 },
        facts(),
        CTX
      )
    ).toBe(true);
    expect(
      evaluateCondition(
        {
          kind: "time",
          basis: { type: "field_changed", field: "stage" },
          op: "lte",
          days: 3,
        },
        facts({ fieldModifiedAt: { stage: "2026-07-26T10:00:00-03:00" } }),
        CTX
      )
    ).toBe(true);
  });
});

describe("decideMoves", () => {
  it("primeira regra que casa vence; já na coluna alvo consome sem mover", () => {
    const rules = [
      rule("r-a", [{ kind: "tasks", metric: "open", op: "eq", value: 0 }], "novo", 0),
      rule("r-b", [{ kind: "tasks", metric: "open", op: "eq", value: 0 }], "quente", 1),
    ];
    // Card em "novo": r-a casa primeiro (alvo = coluna atual) → nenhum
    // movimento, e r-b NÃO é avaliada (first-match-wins).
    const { moves, ruleErrors } = decideMoves(rules, [facts()], CTX);
    expect(moves).toEqual([]);
    expect(ruleErrors).toEqual([]);
  });

  it("mescla famílias em E na mesma regra e move quando todas casam", () => {
    const cond: AutomationCondition = {
      kind: "related_count",
      source: "leads",
      filters: [],
      op: "gte",
      value: 2,
    };
    const rules = [
      rule("r-mix", [
        { kind: "field", filter: { field: "stage", op: "eq", value: "novo" } },
        cond,
        { kind: "time", basis: { type: "created" }, op: "gte", days: 10 },
      ]),
    ];
    const card = facts({ relatedCounts: { [relatedCountKey(cond)]: 2 } });
    expect(decideMoves(rules, [card], CTX).moves).toEqual([
      { recordId: "r1", fromKey: "novo", targetKey: "quente", ruleId: "r-mix" },
    ]);
    // Uma condição falhando derruba a regra inteira (E lógico).
    const cold = facts({ relatedCounts: { [relatedCountKey(cond)]: 1 } });
    expect(decideMoves(rules, [cold], CTX).moves).toEqual([]);
  });

  it("mock nunca move; alvo overflow/inexistente vira erro e regra inerte", () => {
    const rules = [
      rule("r-bad", [{ kind: "tasks", metric: "open", op: "eq", value: 0 }], "__outros__"),
      rule("r-gone", [{ kind: "tasks", metric: "open", op: "eq", value: 0 }], "sumiu"),
      rule("r-ok", [{ kind: "tasks", metric: "open", op: "eq", value: 0 }], "quente"),
    ];
    const { moves, ruleErrors } = decideMoves(
      rules,
      [facts({ isMock: true }), facts()],
      CTX
    );
    expect(ruleErrors.map((e) => e.ruleId)).toEqual(["r-bad", "r-gone"]);
    // Só o card não-mock move, pela única regra válida.
    expect(moves).toEqual([
      { recordId: "r1", fromKey: "novo", targetKey: "quente", ruleId: "r-ok" },
    ]);
  });
});
