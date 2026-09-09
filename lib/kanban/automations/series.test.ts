// Versão: 1.0 | Data: 09/09/2026
// A série cobra o vendedor sozinha, para sempre, e o tick roda a cada minuto.
// O que estes testes protegem é o que a torna utilizável:
//  - a trava é por OCORRÊNCIA, não por "tarefa aberta" (a 3ª quinzena vence
//    tenha ou não a 2ª sido feita — é ver as duas que mostra a conduta);
//  - a mesma ocorrência não vira duas tarefas, e a corrida com o banco é
//    NO-OP, nunca erro da regra;
//  - desligada para um recorte, não cobra — sem perder o atributo.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/webhooks/emit", () => ({
  emitWebhookEvent: vi.fn(async () => undefined),
}));

import { decideActions, type CardFacts, type EvalContext } from "./evaluate";
import { executeAutomationSeries } from "./series";
import { parseAutomationRule, type AutomationRow } from "./types";

const SERIES = {
  key: "nutricao",
  title: "Follow-up de nutrição",
  anchor: { kind: "field_changed" as const, field: "stage" },
  cadence: {
    defaultDays: 14,
    overrideScopes: [{ kind: "record" as const }, { kind: "responsible" as const }],
  },
  firstAt: "apos_um_ciclo" as const,
  grantAttribute: "tree",
};

const RULE: AutomationRow = {
  id: "rule-1",
  name: "Nutrição",
  enabled: true,
  position: 0,
  rule: {
    v: 1,
    conditions: [
      { kind: "field", filter: { field: "stage", op: "eq", value: "Nutrição" } },
    ],
    action: { type: "create_task_series", series: SERIES },
  },
  last_run_at: null,
  last_error: null,
  last_moved_count: 0,
};

const card = (over: Partial<CardFacts> = {}): CardFacts => ({
  record: {
    id: "rec-1",
    stage: "Nutrição",
    responsible_id: "resp-1",
    custom_fields: {},
  } as unknown as CardFacts["record"],
  columnKey: "",
  isMock: false,
  openTasks: 0,
  overdueTasks: 0,
  relatedCounts: {},
  changedAt: new Map([["stage", "2026-09-01T09:00:00-03:00"]]),
  sourceCreatedAt: null,
  placementUpdatedAt: null,
  openAutomationRuleIds: [],
  seriesOccurrences: [],
  pausedAttributes: [],
  ...over,
});

const ctx = (over: Partial<EvalContext> = {}): EvalContext => ({
  available: [],
  todayIso: "2026-09-29",
  columns: [],
  allocationFieldKey: null,
  ...over,
});

describe("decideActions — série", () => {
  it("planeja a cobrança devida com prazo e responsável do registro", () => {
    const { seriesTasks } = decideActions([RULE], [card()], ctx());
    expect(seriesTasks[0]).toMatchObject({
      recordId: "rec-1",
      occurrence: 2,
      dueDate: "2026-09-29",
      responsibleId: "resp-1",
      seriesKey: "nutricao",
      grantAttribute: "tree",
    });
  });

  // v1.2 (09/09/2026): a série mantém abertas a devida hoje MAIS as próximas
  // `lookahead` (padrão 5) — antes só existia a do dia, e num ciclo quinzenal o
  // vendedor passava 15 dias sem ver nada nem poder remarcar o que vinha.
  it("planeja a devida hoje e as 5 seguintes, em datas crescentes", () => {
    const { seriesTasks } = decideActions([RULE], [card()], ctx());
    expect(seriesTasks).toHaveLength(6);
    expect(seriesTasks.map((t) => t.occurrence)).toEqual([2, 3, 4, 5, 6, 7]);
    // Cadência de 14 dias a partir da devida (2026-09-29).
    expect(seriesTasks.map((t) => t.dueDate)).toEqual([
      "2026-09-29",
      "2026-10-13",
      "2026-10-27",
      "2026-11-10",
      "2026-11-24",
      "2026-12-08",
    ]);
  });

  // A decisão de NÃO criar retroativo: um deal que entrou na etapa há meses não
  // abre de uma vez todas as cobranças que ninguém fez. Elas seguem visíveis na
  // Tree como galho vazio, que é onde a falta de acompanhamento deve aparecer.
  it("nunca planeja cobrança VENCIDA além da devida hoje", () => {
    const { seriesTasks } = decideActions([RULE], [card()], ctx());
    for (const t of seriesTasks) {
      expect(t.dueDate >= "2026-09-29").toBe(true);
    }
    expect(seriesTasks.some((t) => t.occurrence < 2)).toBe(false);
  });

  it("ocorrência já criada consome sem planejar de novo", () => {
    const { seriesTasks } = decideActions(
      [RULE],
      [card({ seriesOccurrences: ["rule-1:2"] })],
      ctx()
    );
    // A devida hoje sai da lista; as futuras seguem sendo planejadas.
    expect(seriesTasks.map((t) => t.occurrence)).toEqual([3, 4, 5, 6, 7]);
  });

  // v1.2: pausar o atributo PARA a cobrança. Antes o status era escrito pelo
  // executor e nunca lido por ninguém — pausar não pausava nada.
  it("atributo pausado no registro não gera cobrança", () => {
    const { seriesTasks } = decideActions(
      [RULE],
      [card({ pausedAttributes: ["tree"] })],
      ctx()
    );
    expect(seriesTasks).toHaveLength(0);
  });

  it("a cobrança ANTERIOR em aberto não impede a próxima", () => {
    // É a diferença para o create_task: lá, uma tarefa aberta bloqueia. Aqui, a
    // 2ª quinzena vence tenha ou não a 1ª sido feita — e é ver as duas em
    // aberto que mostra que o vendedor não está acompanhando.
    const { seriesTasks } = decideActions(
      [RULE],
      [card({ seriesOccurrences: ["rule-1:1"], openTasks: 1 })],
      ctx()
    );
    expect(seriesTasks[0]?.occurrence).toBe(2);
  });

  it("desligada para o responsável, não cobra", () => {
    const { seriesTasks } = decideActions(
      [RULE],
      [card()],
      ctx({
        seriesSettings: new Map([
          [
            "nutricao",
            [
              {
                scopeKind: "responsible" as const,
                scopeValue: "resp-1",
                cadenceDays: null,
                active: false,
              },
            ],
          ],
        ]),
      })
    );
    expect(seriesTasks).toHaveLength(0);
  });

  it("cadência do registro muda qual ocorrência vence", () => {
    const { seriesTasks } = decideActions(
      [RULE],
      [card()],
      ctx({
        seriesSettings: new Map([
          [
            "nutricao",
            [
              {
                scopeKind: "record" as const,
                scopeValue: "rec-1",
                cadenceDays: 7,
                active: true,
              },
            ],
          ],
        ]),
      })
    );
    // 28 dias desde a âncora, de 7 em 7.
    expect(seriesTasks[0]?.occurrence).toBe(4);
  });

  it("sem âncora (campo nunca alterado) não cobra", () => {
    const { seriesTasks } = decideActions(
      [RULE],
      [card({ changedAt: null })],
      ctx()
    );
    expect(seriesTasks).toHaveLength(0);
  });

  it("mock nunca é cobrado", () => {
    const { seriesTasks } = decideActions([RULE], [card({ isMock: true })], ctx());
    expect(seriesTasks).toHaveLength(0);
  });
});

describe("parseAutomationRule — série", () => {
  const withSeries = (series: unknown) => ({
    v: 1,
    conditions: [{ kind: "field", filter: { field: "stage", op: "eq", value: "x" } }],
    action: { type: "create_task_series", series },
  });

  it("aceita a configuração completa", () => {
    expect(parseAutomationRule(withSeries(SERIES))?.action).toMatchObject({
      type: "create_task_series",
    });
  });

  it("cadência fora de faixa derruba a regra (nunca cobra todo dia)", () => {
    expect(
      parseAutomationRule(
        withSeries({ ...SERIES, cadence: { defaultDays: 0, overrideScopes: [] } })
      )
    ).toBeNull();
  });

  it("âncora sem campo derruba a regra", () => {
    expect(
      parseAutomationRule(withSeries({ ...SERIES, anchor: { kind: "field_changed" } }))
    ).toBeNull();
  });
});

describe("executeAutomationSeries", () => {
  function fakeDb(insertResult: { data?: unknown; error?: unknown }) {
    const inserted: Record<string, unknown>[] = [];
    const upserted: Record<string, unknown>[] = [];
    const db = {
      from(table: string) {
        return {
          insert(row: Record<string, unknown>) {
            inserted.push(row);
            return { select: () => ({ single: async () => insertResult }) };
          },
          upsert(row: Record<string, unknown>) {
            if (table === "record_attributes") upserted.push(row);
            return Promise.resolve({ error: null });
          },
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    return { db, inserted, upserted };
  }

  const plan = {
    recordId: "rec-1",
    ruleId: "rule-1",
    seriesKey: "nutricao",
    occurrence: 2,
    title: "Follow-up",
    description: null,
    dueDate: "2026-09-29",
    responsibleId: "resp-1",
    grantAttribute: "tree",
  };

  beforeEach(() => vi.clearAllMocks());

  it("cria a tarefa com a ocorrência carimbada e concede o atributo", async () => {
    const { db, inserted, upserted } = fakeDb({ data: { id: "t-1" } });
    const out = await executeAutomationSeries(db, {
      series: [plan],
      orgId: "org-1",
      createdBy: "user-1",
    });
    expect(out.okIds).toEqual(["rec-1"]);
    expect(inserted[0]).toMatchObject({
      series_key: "nutricao",
      series_occurrence: 2,
      automation_rule_id: "rule-1",
      responsible_id: "resp-1",
      due_date: "2026-09-29",
    });
    expect(upserted[0]).toMatchObject({
      record_id: "rec-1",
      attribute_key: "tree",
    });
  });

  it("a trava do banco é NO-OP, não falha da regra", async () => {
    // A corrida entre o tick e o "Executar agora" bate aqui; poluir o
    // last_error com "duplicate key" esconderia os erros de verdade.
    const { db } = fakeDb({ error: { code: "23505", message: "duplicate key" } });
    const out = await executeAutomationSeries(db, {
      series: [plan],
      orgId: "org-1",
      createdBy: null,
    });
    expect(out.skipped).toBe(1);
    expect(out.okIds).toHaveLength(0);
    expect(out.failed).toHaveLength(0);
  });

  it("erro de verdade é reportado", async () => {
    const { db } = fakeDb({ error: { code: "42501", message: "permissão" } });
    const out = await executeAutomationSeries(db, {
      series: [plan],
      orgId: "org-1",
      createdBy: null,
    });
    expect(out.failed[0]).toMatchObject({ recordId: "rec-1" });
  });
});
