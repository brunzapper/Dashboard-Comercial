// Versão: 1.0 | Data: 09/09/2026
// A série abre tarefa sozinha, para sempre, e o tick roda a cada minuto.
// O que estes testes protegem é o que a torna utilizável:
//  - a trava é por OCORRÊNCIA, não por "tarefa aberta" (a 3ª quinzena vence
//    tenha ou não a 2ª sido feita — é ver as duas que mostra a conduta);
//  - a mesma ocorrência não vira duas tarefas, e a corrida com o banco é
//    NO-OP, nunca erro da regra;
//  - desligada para um recorte, não gera nada — sem perder o atributo.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/webhooks/emit", () => ({
  emitWebhookEvent: vi.fn(async () => undefined),
}));

vi.mock("@/lib/sync/bitrix/task-mirror", () => ({
  mirrorTaskAfterWrite: vi.fn(async () => undefined),
  enqueueTaskMirrorMany: vi.fn(async () => undefined),
  loadMirrorOwners: vi.fn(async () =>
    new Map([["rec-1", { entity: "deal", sourceId: "123" }]])
  ),
}));

import { decideActions, type CardFacts, type EvalContext } from "./evaluate";
import {
  executeAutomationSeries,
  executeSeriesRevocations,
  mirrorDueNow,
} from "./series";
import {
  enqueueTaskMirrorMany,
  mirrorTaskAfterWrite,
} from "@/lib/sync/bitrix/task-mirror";
import {
  DEFAULT_MIRROR_LEAD_DAYS,
  DEFAULT_SERIES_LOOKAHEAD,
} from "@/lib/series/types";
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

/** Uma ocorrência já criada para a regra do teste. */
function occ(occurrence: number, open: boolean) {
  return { ruleId: "rule-1", occurrence, open };
}

describe("decideActions — série", () => {
  it("planeja a ocorrência devida com prazo e responsável do registro", () => {
    const { seriesTasks } = decideActions([RULE], [card()], ctx());
    expect(seriesTasks[0]).toMatchObject({
      recordId: "rec-1",
      occurrence: 2,
      dueDate: "2026-09-29",
      responsibleId: "resp-1",
      seriesKey: "nutricao",
      grantAttribute: "tree",
    mirrorBitrix: "herdar" as const,
    });
  });

  // v1.2 (09/09/2026): a série mantém abertas a devida hoje MAIS as próximas
  // `lookahead` — antes só existia a do dia, e num ciclo quinzenal o vendedor
  // passava 15 dias sem ver nada nem poder remarcar o que vinha.
  // v1.3 (10/09/2026): o padrão passou de 5 para 3 futuras.
  it("planeja a devida hoje e as 3 seguintes, em datas crescentes", () => {
    const { seriesTasks } = decideActions([RULE], [card()], ctx());
    expect(seriesTasks).toHaveLength(1 + DEFAULT_SERIES_LOOKAHEAD);
    expect(seriesTasks.map((t) => t.occurrence)).toEqual([2, 3, 4, 5]);
    // Cadência de 14 dias a partir da devida (2026-09-29).
    expect(seriesTasks.map((t) => t.dueDate)).toEqual([
      "2026-09-29",
      "2026-10-13",
      "2026-10-27",
      "2026-11-10",
    ]);
  });

  // A decisão de NÃO criar retroativo: um deal que entrou na etapa há meses não
  // abre de uma vez todas as que ninguém fez. Elas seguem visíveis na
  // Tree como galho vazio, que é onde a falta de acompanhamento deve aparecer.
  it("nunca planeja ocorrência VENCIDA além da devida hoje", () => {
    const { seriesTasks } = decideActions([RULE], [card()], ctx());
    for (const t of seriesTasks) {
      expect(t.dueDate >= "2026-09-29").toBe(true);
    }
    expect(seriesTasks.some((t) => t.occurrence < 2)).toBe(false);
  });

  it("ocorrência já criada consome sem planejar de novo", () => {
    const { seriesTasks } = decideActions(
      [RULE],
      [card({ seriesOccurrences: [occ(2, true)] })],
      ctx()
    );
    // A devida hoje sai da lista; as futuras seguem sendo planejadas.
    expect(seriesTasks.map((t) => t.occurrence)).toEqual([3, 4, 5]);
  });

  // v1.3 (10/09/2026): o registro que MUDA DE ETAPA devolve o que não concluiu.
  // Sem isto, um deal que sai de Nutrição levava consigo as tarefas da etapa
  // antiga — abertas, no nome do vendedor, para sempre.
  it("saiu do recorte: devolve as ocorrências abertas", () => {
    const fora = card({
      record: {
        id: "rec-1",
        stage: "Proposta",
        responsible_id: "resp-1",
        custom_fields: {},
      } as unknown as CardFacts["record"],
      seriesOccurrences: [occ(2, true), occ(3, true)],
    });
    const { revokedSeries, seriesTasks } = decideActions([RULE], [fora], ctx());
    expect(revokedSeries).toEqual([{ recordId: "rec-1", ruleId: "rule-1" }]);
    // E não planeja nada de novo para quem saiu.
    expect(seriesTasks).toEqual([]);
  });

  // O que sobrou é histórico: nada a devolver, nada a apagar.
  it("saiu do recorte com tudo concluído: não devolve nada", () => {
    const fora = card({
      record: {
        id: "rec-1",
        stage: "Proposta",
        responsible_id: "resp-1",
        custom_fields: {},
      } as unknown as CardFacts["record"],
      seriesOccurrences: [occ(2, false)],
    });
    expect(decideActions([RULE], [fora], ctx()).revokedSeries).toEqual([]);
  });

  // Parar de gerar e apagar o que já foi gerado são decisões diferentes: a
  // regra continua CASANDO, ela só não produz nada enquanto o atributo pausa.
  it("atributo pausado não devolve nada (só para de gerar)", () => {
    const pausado = card({
      pausedAttributes: ["tree"],
      seriesOccurrences: [occ(2, true)],
    });
    const { revokedSeries, seriesTasks } = decideActions(
      [RULE],
      [pausado],
      ctx()
    );
    expect(revokedSeries).toEqual([]);
    expect(seriesTasks).toEqual([]);
  });

  // v1.2: pausar o atributo PARA a série. Antes o status era escrito pelo
  // executor e nunca lido por ninguém — pausar não pausava nada.
  it("atributo pausado no registro não gera tarefa", () => {
    const { seriesTasks } = decideActions(
      [RULE],
      [card({ pausedAttributes: ["tree"] })],
      ctx()
    );
    expect(seriesTasks).toHaveLength(0);
  });

  it("a tarefa ANTERIOR em aberto não impede a próxima", () => {
    // É a diferença para o create_task: lá, uma tarefa aberta bloqueia. Aqui, a
    // 2ª quinzena vence tenha ou não a 1ª sido feita — e é ver as duas em
    // aberto que mostra que o vendedor não está acompanhando.
    const { seriesTasks } = decideActions(
      [RULE],
      [card({ seriesOccurrences: [occ(1, true)], openTasks: 1 })],
      ctx()
    );
    expect(seriesTasks[0]?.occurrence).toBe(2);
  });

  it("desligada para o responsável, não gera nada", () => {
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

  it("sem âncora (campo nunca alterado) não gera nada", () => {
    const { seriesTasks } = decideActions(
      [RULE],
      [card({ changedAt: null })],
      ctx()
    );
    expect(seriesTasks).toHaveLength(0);
  });

  it("mock nunca gera tarefa", () => {
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

  it("cadência fora de faixa derruba a regra (nunca abre todo dia)", () => {
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
    mirrorBitrix: "herdar" as const,
    mirrorLeadDays: DEFAULT_MIRROR_LEAD_DAYS,
  };

  beforeEach(() => vi.clearAllMocks());

  // v1.3: a ocorrência distante existe AQUI desde já (é o que o vendedor
  // precisa ver), mas o CRM só a recebe quando o vencimento se aproxima.
  it("não espelha a ocorrência ainda longe do vencimento", async () => {
    const { db } = fakeDb({ data: { id: "t-1" } });
    await executeAutomationSeries(db, {
      series: [{ ...plan, dueDate: "2099-01-01" }],
      orgId: "org-1",
      createdBy: "user-1",
    });
    expect(mirrorTaskAfterWrite).not.toHaveBeenCalled();
  });

  it("espelha a que já está dentro da janela", async () => {
    const { db } = fakeDb({ data: { id: "t-1" } });
    await executeAutomationSeries(db, {
      series: [{ ...plan, dueDate: "2020-01-01" }],
      orgId: "org-1",
      createdBy: "user-1",
    });
    expect(mirrorTaskAfterWrite).toHaveBeenCalledTimes(1);
  });

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

// ---------------------------------------------------------------------------
// v1.3 — a ANTECEDÊNCIA do espelho.
// ---------------------------------------------------------------------------
describe("mirrorDueNow", () => {
  const hoje = "2026-09-10";

  it("dentro da janela, vai", () => {
    expect(mirrorDueNow("2026-09-13", 3, hoje)).toBe(true);
    expect(mirrorDueNow("2026-09-10", 3, hoje)).toBe(true);
  });

  it("fora da janela, espera", () => {
    expect(mirrorDueNow("2026-09-14", 3, hoje)).toBe(false);
    expect(mirrorDueNow("2026-11-24", 3, hoje)).toBe(false);
  });

  // Atrasado é o caso em que o CRM MAIS precisa saber.
  it("vencido conta como dentro da janela", () => {
    expect(mirrorDueNow("2026-08-01", 3, hoje)).toBe(true);
  });

  it("antecedência 0 é o próprio dia do vencimento", () => {
    expect(mirrorDueNow("2026-09-10", 0, hoje)).toBe(true);
    expect(mirrorDueNow("2026-09-11", 0, hoje)).toBe(false);
  });

  // Tarefa sem prazo não tem quando amadurecer — vai de uma vez.
  it("sem prazo, vai", () => {
    expect(mirrorDueNow(null, 3, hoje)).toBe(true);
  });
});

describe("executeSeriesRevocations", () => {
  /** Dublê com o encadeamento que a revogação usa: select filtrado + delete. */
  function fakeDb(open: Record<string, unknown>[]) {
    const deletedIds: string[][] = [];
    const chain = (rows: Record<string, unknown>[]) => {
      const self: Record<string, unknown> = {};
      for (const m of ["eq", "is", "not", "in", "select"]) {
        self[m] = () => self;
      }
      // O await no final da cadeia devolve o resultado do PostgREST.
      self.then = (
        resolve: (v: { data: Record<string, unknown>[]; error: null }) => void
      ) => resolve({ data: rows, error: null });
      return self;
    };
    const db = {
      from() {
        return {
          select: () => chain(open),
          delete: () => ({
            in: (_col: string, ids: string[]) => {
              deletedIds.push(ids);
              return Promise.resolve({ error: null });
            },
          }),
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    return { db, deletedIds };
  }

  beforeEach(() => vi.clearAllMocks());

  it("apaga as abertas do par (regra, registro) e avisa o CRM", async () => {
    const { db, deletedIds } = fakeDb([
      { id: "t-1", title: "Follow-up", record_id: "rec-1", bitrix_activity_id: "777" },
      { id: "t-2", title: "Follow-up", record_id: "rec-1", bitrix_activity_id: null },
    ]);
    const out = await executeSeriesRevocations(db, {
      revoked: [{ recordId: "rec-1", ruleId: "rule-1" }],
      orgId: "org-1",
      createdBy: "user-1",
    });
    expect(out.deleted).toBe(2);
    expect(deletedIds[0]).toEqual(["t-1", "t-2"]);
    // Só a que TINHA atividade lá gera ordem de exclusão no portal.
    const enqueued = vi.mocked(enqueueTaskMirrorMany).mock.calls[0]?.[1] ?? [];
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ op: "delete", activityId: "777" });
  });

  it("sem nada aberto, não apaga nem enfileira", async () => {
    const { db, deletedIds } = fakeDb([]);
    const out = await executeSeriesRevocations(db, {
      revoked: [{ recordId: "rec-1", ruleId: "rule-1" }],
      orgId: "org-1",
      createdBy: null,
    });
    expect(out.deleted).toBe(0);
    expect(deletedIds).toEqual([]);
    expect(enqueueTaskMirrorMany).not.toHaveBeenCalled();
  });
});
