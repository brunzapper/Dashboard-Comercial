// Versão: 1.0 | Data: 08/09/2026
// A ação `create_task` existe num sistema onde o tick roda A CADA MINUTO. O
// que estes testes protegem é a única coisa que a torna utilizável: ela não
// pode criar a mesma tarefa de novo a cada rodada. São duas camadas —
// o avaliador pula quem já tem tarefa aberta, e o índice único da 0129 pega a
// corrida que o avaliador não vê.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/webhooks/emit", () => ({
  emitWebhookEvent: vi.fn(async () => undefined),
}));

import { emitWebhookEvent } from "@/lib/webhooks/emit";
import { addDaysIso, decideActions } from "./evaluate";
import type { CardFacts, EvalContext } from "./evaluate";
import { executeAutomationTasks } from "./task";
import type { AutomationRow } from "./types";

const TASK_RULE: AutomationRow = {
  id: "rule-task",
  name: "Cobrar retomada",
  enabled: true,
  position: 0,
  rule: {
    v: 1,
    conditions: [
      { kind: "field", filter: { field: "stage", op: "eq", value: "novo" } },
    ],
    action: {
      type: "create_task",
      title: "Retomar contato",
      dueInDays: 3,
      responsibleFrom: "record",
    },
  },
  last_run_at: null,
  last_error: null,
  last_moved_count: 0,
};

const card = (over: Partial<CardFacts> = {}): CardFacts => ({
  record: {
    id: "r1",
    stage: "novo",
    responsible_id: "resp-9",
    custom_fields: {},
  } as unknown as CardFacts["record"],
  columnKey: "",
  isMock: false,
  openTasks: 0,
  overdueTasks: 0,
  relatedCounts: {},
  fieldModifiedAt: null,
  sourceCreatedAt: null,
  placementUpdatedAt: null,
  openAutomationRuleIds: [],
  seriesOccurrences: [],
  ...over,
});

const ctx: EvalContext = {
  available: [],
  todayIso: "2026-09-08",
  columns: [],
  allocationFieldKey: null,
};

describe("decideActions — create_task", () => {
  it("planeja a tarefa com prazo e responsável do registro", () => {
    const { tasks } = decideActions([TASK_RULE], [card()], ctx);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      recordId: "r1",
      ruleId: "rule-task",
      title: "Retomar contato",
      dueDate: "2026-09-11",
      responsibleId: "resp-9",
    });
  });

  it("NÃO recria quando já há tarefa aberta desta regra", () => {
    // É este teste que impede 1.440 tarefas por dia por registro.
    const { tasks } = decideActions(
      [TASK_RULE],
      [card({ openAutomationRuleIds: ["rule-task"] })],
      ctx
    );
    expect(tasks).toHaveLength(0);
  });

  it("tarefa aberta de OUTRA regra não bloqueia esta", () => {
    const { tasks } = decideActions(
      [TASK_RULE],
      [card({ openAutomationRuleIds: ["outra-regra"] })],
      ctx
    );
    expect(tasks).toHaveLength(1);
  });

  it("mock nunca gera tarefa", () => {
    const { tasks } = decideActions([TASK_RULE], [card({ isMock: true })], ctx);
    expect(tasks).toHaveLength(0);
  });

  it("sem prazo configurado, a tarefa nasce sem data", () => {
    const rule = {
      ...TASK_RULE,
      rule: {
        ...TASK_RULE.rule,
        action: { ...TASK_RULE.rule.action, dueInDays: null },
      },
    } as AutomationRow;
    const { tasks } = decideActions([rule], [card()], ctx);
    expect(tasks[0].dueDate).toBeNull();
  });
});

describe("addDaysIso", () => {
  it("soma dias de calendário sem escorregar de fuso", () => {
    expect(addDaysIso("2026-09-08", 3)).toBe("2026-09-11");
    expect(addDaysIso("2026-09-08", 0)).toBe("2026-09-08");
    // Virada de mês e de ano.
    expect(addDaysIso("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    // Horário de verão do Brasil (out/2026) não pode comer um dia.
    expect(addDaysIso("2026-10-17", 1)).toBe("2026-10-18");
  });
});

describe("executeAutomationTasks", () => {
  function fakeDb(insertResult: { data?: unknown; error?: unknown }) {
    const inserted: Record<string, unknown>[] = [];
    const db = {
      from() {
        return {
          insert(row: Record<string, unknown>) {
            inserted.push(row);
            return {
              select: () => ({ single: async () => insertResult }),
            };
          },
        };
      },
    };
    return { db, inserted };
  }

  it("grava o vínculo com a regra — é ele que trava a duplicata", async () => {
    vi.mocked(emitWebhookEvent).mockClear();
    const { db, inserted } = fakeDb({ data: { id: "t1" }, error: null });
    const res = await executeAutomationTasks(db as never, {
      tasks: [
        {
          recordId: "r1",
          ruleId: "rule-task",
          title: "Retomar contato",
          description: null,
          dueDate: "2026-09-11",
          responsibleId: "resp-9",
        },
      ],
      orgId: "org1",
      createdBy: "user-1",
    });

    expect(res.okIds).toEqual(["t1"]);
    expect(inserted[0]).toMatchObject({
      organization_id: "org1",
      automation_rule_id: "rule-task",
      record_id: "r1",
      responsible_id: "resp-9",
      due_date: "2026-09-11",
      created_by: "user-1",
    });
    expect(emitWebhookEvent).toHaveBeenCalledWith(
      "task.created",
      expect.objectContaining({ taskId: "t1" }),
      "org1"
    );
  });

  it("corrida com outra rodada é no-op, não erro da regra", async () => {
    // O índice único da 0129 rejeita a segunda inserção. Tratar isso como
    // falha encheria o last_error da regra de ruído — o resultado é o
    // desejado: existe exatamente uma tarefa aberta.
    const { db } = fakeDb({
      data: null,
      error: { code: "23505", message: 'duplicate key value violates "uq_tasks_open_per_automation"' },
    });
    const res = await executeAutomationTasks(db as never, {
      tasks: [
        {
          recordId: "r1",
          ruleId: "rule-task",
          title: "T",
          description: null,
          dueDate: null,
          responsibleId: null,
        },
      ],
      orgId: "org1",
      createdBy: null,
    });
    expect(res.okIds).toHaveLength(0);
    expect(res.failed).toHaveLength(0);
  });

  it("erro de verdade vira falha reportada", async () => {
    const { db } = fakeDb({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });
    const res = await executeAutomationTasks(db as never, {
      tasks: [
        {
          recordId: "r1",
          ruleId: "rule-task",
          title: "T",
          description: null,
          dueDate: null,
          responsibleId: null,
        },
      ],
      orgId: "org1",
      createdBy: null,
    });
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].message).toMatch(/permission denied/);
  });
});
