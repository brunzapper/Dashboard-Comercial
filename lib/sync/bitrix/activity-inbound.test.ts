// Versão: 1.2 | Data: 09/10/2026
// v1.2 (09/10/2026): atividade desconhecida só entra com Tree ATIVO; concluída
//   só dentro de 30 dias antes da ativação, com a data de conclusão DE LÁ; e a
//   carga inicial de um registro (`loadRecordActivitiesNow`) marca 'done'.
// v1.1 (10/09/2026): a guarda de TRUNCAMENTO. O teste "apagada LÁ apaga AQUI"
//   sozinho dava falsa segurança: ele prova que a ausência apaga, e o que
//   faltava provar é que a ausência de uma lista CORTADA não apaga.
// A LEITURA DE VOLTA (0137). O que está em risco aqui não é duplicar — é
// APAGAR o que não devia e sobrescrever o que é nosso.
//
// Três invariantes que os testes pinam, porque nenhuma é óbvia no código:
//   - só CRM_TODO vira tarefa (o portal chama de "atividade" também ligação,
//     e-mail e reunião — importá-las encheria a lista de tarefas);
//   - tarefa JÁ espelhada nunca tem o conteúdo sobrescrito (o outbound é o
//     dono do título/prazo; só o estado de conclusão vem de lá);
//   - a atividade que sumiu da lista do dono apaga a tarefa — e é por isso que
//     a leitura precisa da lista COMPLETA, nunca de uma página.
import { describe, expect, it, vi } from "vitest";

import {
  activityCompletedAt,
  deadlineToLocalDay,
  isTodoActivity,
  loadRecordActivitiesNow,
  shouldImportActivity,
  syncBitrixActivitiesInbound,
} from "./activity-inbound";

describe("isTodoActivity", () => {
  it("só o TODO da timeline", () => {
    expect(isTodoActivity({ ID: 1, PROVIDER_ID: "CRM_TODO" })).toBe(true);
    expect(isTodoActivity({ ID: 1, PROVIDER_ID: "CRM_EMAIL" })).toBe(false);
    expect(isTodoActivity({ ID: 1 })).toBe(false);
  });
});

describe("deadlineToLocalDay", () => {
  // O portal responde no fuso DELE. 02:00 em Moscou ainda é o dia anterior
  // aqui — cortar os 10 primeiros caracteres adiantaria a tarefa um dia.
  it("converte para o dia civil de Brasília", () => {
    expect(deadlineToLocalDay("2026-09-30T02:00:00+03:00")).toBe("2026-09-29");
    expect(deadlineToLocalDay("2026-09-30T18:00:00+03:00")).toBe("2026-09-30");
  });

  it("sem prazo não inventa data", () => {
    expect(deadlineToLocalDay(null)).toBeNull();
    expect(deadlineToLocalDay("")).toBeNull();
    expect(deadlineToLocalDay("qualquer coisa")).toBeNull();
  });
});

/** Dublê do PostgREST com só o que o inbound encadeia. */
function fakeDb(seed: {
  sources?: Record<string, unknown>[];
  openTasks?: Record<string, unknown>[];
  attrs?: Record<string, unknown>[];
  records?: Record<string, unknown>[];
  tasks?: Record<string, unknown>[];
  comments?: Record<string, unknown>[];
}) {
  const ops: { table: string; op: string; payload?: unknown }[] = [];
  const rowsFor = (table: string, filters: Record<string, unknown>) => {
    if (table === "data_sources") return seed.sources ?? [];
    if (table === "record_attributes") return seed.attrs ?? [];
    if (table === "records") return seed.records ?? [];
    if (table === "responsibles") return [];
    if (table === "comments") return seed.comments ?? [];
    if (table === "tasks") {
      // `pendingActivityOwners` pede as ABERTAS espelhadas; a conciliação pede
      // todas as espelhadas do lote. O dublê distingue pelo `.is()`.
      return filters.completedNull ? (seed.openTasks ?? []) : (seed.tasks ?? []);
    }
    return [];
  };

  const make = (table: string) => {
    const filters: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.select = self;
    b.eq = self;
    b.in = self;
    b.not = self;
    b.order = self;
    b.is = (col: string) => {
      if (col === "completed_at") filters.completedNull = true;
      return b;
    };
    b.limit = () => Promise.resolve({ data: rowsFor(table, filters) });
    b.maybeSingle = () =>
      Promise.resolve({ data: rowsFor(table, filters)[0] ?? null });
    b.insert = (payload: unknown) => {
      ops.push({ table, op: "insert", payload });
      const ins: Record<string, unknown> = {};
      ins.select = () => ins;
      ins.maybeSingle = () => Promise.resolve({ data: { id: "novo" } });
      return ins;
    };
    b.update = (payload: unknown) => {
      ops.push({ table, op: "update", payload });
      return b;
    };
    b.delete = () => {
      ops.push({ table, op: "delete" });
      return b;
    };
    b.then = (res: (v: { data: unknown[] }) => unknown) =>
      Promise.resolve({ data: rowsFor(table, filters) }).then(res);
    return b;
  };
  return { ops, db: { from: make } as never };
}

const OWNER_SEED = {
  sources: [{ record_type: "negocio", bitrix_activity_owner: "deal" }],
  openTasks: [{ record_id: "r1" }],
  attrs: [],
  records: [
    {
      id: "r1",
      organization_id: "org1",
      record_type: "negocio",
      source_id: "123",
    },
  ],
};

/** v1.2: o mesmo dono, com o Tree ligado em 01/10/2026. */
const TREE_SEED = {
  ...OWNER_SEED,
  attrs: [
    {
      id: "a1",
      record_id: "r1",
      status: "ativo",
      config: { activatedAt: "2026-10-01T12:00:00Z" },
      created_at: "2026-09-01T12:00:00Z",
    },
  ],
};

const TODO = {
  ID: 777,
  OWNER_ID: 123,
  OWNER_TYPE_ID: 2,
  SUBJECT: "Follow-up",
  PROVIDER_ID: "CRM_TODO",
  COMPLETED: "N",
};

function apiWith(activities: unknown[]) {
  return {
    call: vi.fn().mockImplementation((method: string) => {
      if (method === "crm.activity.list") {
        return Promise.resolve({ result: activities });
      }
      return Promise.resolve({ result: [] });
    }),
  };
}

describe("syncBitrixActivitiesInbound", () => {
  it("nenhuma Base espelha: não chama o portal", async () => {
    const { db } = fakeDb({ sources: [] });
    const api = apiWith([]);
    expect(await syncBitrixActivitiesInbound(db, Date.now() + 9999, api))
      .toMatchObject({ completed: 0, created: 0, deleted: 0 });
    expect(api.call).not.toHaveBeenCalled();
  });

  it("concluída LÁ fecha a tarefa AQUI", async () => {
    const { db, ops } = fakeDb({
      ...OWNER_SEED,
      tasks: [
        {
          id: "t1",
          record_id: "r1",
          title: "Follow-up",
          completed_at: null,
          bitrix_activity_id: "777",
        },
      ],
    });
    const out = await syncBitrixActivitiesInbound(
      db,
      Date.now() + 9999,
      apiWith([{ ...TODO, COMPLETED: "Y" }])
    );
    expect(out.completed).toBe(1);
    const upd = ops.find((o) => o.table === "tasks" && o.op === "update");
    expect((upd!.payload as { completed_at: string }).completed_at).toBeTruthy();
  });

  // Sem isto, reabrir aqui seria re-fechado na rodada seguinte, para sempre.
  it("reaberta LÁ reabre AQUI", async () => {
    const { db, ops } = fakeDb({
      ...OWNER_SEED,
      tasks: [
        {
          id: "t1",
          record_id: "r1",
          title: "Follow-up",
          completed_at: "2026-09-01T10:00:00Z",
          bitrix_activity_id: "777",
        },
      ],
    });
    const out = await syncBitrixActivitiesInbound(
      db,
      Date.now() + 9999,
      apiWith([{ ...TODO, COMPLETED: "N" }])
    );
    expect(out.reopened).toBe(1);
    const upd = ops.find((o) => o.table === "tasks" && o.op === "update");
    expect((upd!.payload as { completed_at: null }).completed_at).toBeNull();
  });

  // A exclusão não emite nada no portal: a atividade só deixa de voltar.
  it("apagada LÁ apaga AQUI, de vez", async () => {
    const { db, ops } = fakeDb({
      ...OWNER_SEED,
      tasks: [
        {
          id: "t1",
          record_id: "r1",
          title: "Follow-up",
          completed_at: null,
          bitrix_activity_id: "777",
        },
      ],
    });
    const out = await syncBitrixActivitiesInbound(db, Date.now() + 9999, apiWith([]));
    expect(out.deleted).toBe(1);
    expect(ops.some((o) => o.table === "tasks" && o.op === "delete")).toBe(true);
  });

  // O contraponto do teste acima, e o motivo de ele não bastar: a lista do dono
  // pode acabar CORTADA (teto de páginas / orçamento). Aí a ausência não prova
  // nada, e apagar é irreversível.
  it("lista cortada não apaga nada", async () => {
    const { db, ops } = fakeDb({
      ...OWNER_SEED,
      tasks: [
        {
          id: "t1",
          record_id: "r1",
          title: "Follow-up",
          completed_at: null,
          bitrix_activity_id: "777",
        },
      ],
    });
    // Sempre com `next`: o laço só para no teto de páginas, nunca no fim.
    const api = {
      call: vi.fn().mockImplementation((method: string) => {
        if (method === "crm.activity.list") {
          return Promise.resolve({ result: [], next: 50 });
        }
        return Promise.resolve({ result: [] });
      }),
    };
    const out = await syncBitrixActivitiesInbound(db, Date.now() + 9999, api);
    expect(out.deleted).toBe(0);
    expect(ops.some((o) => o.table === "tasks" && o.op === "delete")).toBe(false);
  });

  // A conclusão depende do que VOLTOU, não do que faltou — então ela segue
  // valendo mesmo com a lista cortada.
  it("lista cortada ainda conclui o que voltou", async () => {
    const { db, ops } = fakeDb({
      ...OWNER_SEED,
      tasks: [
        {
          id: "t1",
          record_id: "r1",
          title: "Follow-up",
          completed_at: null,
          bitrix_activity_id: "777",
        },
      ],
    });
    let page = 0;
    const api = {
      call: vi.fn().mockImplementation((method: string) => {
        if (method === "crm.activity.list") {
          page += 1;
          return Promise.resolve({
            result: page === 1 ? [{ ...TODO, COMPLETED: "Y" }] : [],
            next: 50,
          });
        }
        return Promise.resolve({ result: [] });
      }),
    };
    const out = await syncBitrixActivitiesInbound(db, Date.now() + 9999, api);
    expect(out.completed).toBe(1);
    expect(ops.some((o) => o.table === "tasks" && o.op === "delete")).toBe(false);
  });

  // Uma chamada por registro não cabe num tick de minuto — o tick pede sem.
  it("comments:false não toca a timeline", async () => {
    const { db } = fakeDb({
      ...OWNER_SEED,
      attrs: [{ record_id: "r1" }],
      tasks: [],
    });
    const api = apiWith([]);
    await syncBitrixActivitiesInbound(db, Date.now() + 9999, api, {
      comments: false,
    });
    const methods = api.call.mock.calls.map((c) => c[0]);
    expect(methods).not.toContain("crm.timeline.comment.list");
  });

  it("atividade desconhecida vira tarefa (registro com Tree ativo)", async () => {
    const { db, ops } = fakeDb({ ...TREE_SEED, tasks: [] });
    const out = await syncBitrixActivitiesInbound(
      db,
      Date.now() + 9999,
      apiWith([TODO])
    );
    expect(out.created).toBe(1);
    const ins = ops.find((o) => o.table === "tasks" && o.op === "insert");
    expect(ins!.payload).toMatchObject({
      title: "Follow-up",
      record_id: "r1",
      organization_id: "org1",
      bitrix_activity_id: "777",
    });
  });

  // Ligação e e-mail SÃO atividades. Importá-las encheria a lista de tarefas.
  // v1.2: dono que entra só por ter tarefa espelhada aberta concilia as JÁ
  // conhecidas, mas não importa o resto da timeline.
  it("sem Tree ativo, atividade desconhecida NÃO vira tarefa", async () => {
    const { db, ops } = fakeDb({ ...OWNER_SEED, tasks: [] });
    const out = await syncBitrixActivitiesInbound(
      db,
      Date.now() + 9999,
      apiWith([TODO])
    );
    expect(out.created).toBe(0);
    expect(ops.some((o) => o.table === "tasks" && o.op === "insert")).toBe(false);
  });

  it("concluída dentro da janela entra com a data de conclusão DE LÁ", async () => {
    const { db, ops } = fakeDb({ ...TREE_SEED, tasks: [] });
    const out = await syncBitrixActivitiesInbound(
      db,
      Date.now() + 9999,
      apiWith([
        { ...TODO, COMPLETED: "Y", LAST_UPDATED: "2026-09-20T12:00:00+03:00" },
      ])
    );
    expect(out.created).toBe(1);
    const ins = ops.find((o) => o.table === "tasks" && o.op === "insert");
    expect((ins!.payload as { completed_at: string }).completed_at).toBe(
      "2026-09-20T09:00:00.000Z"
    );
  });

  it("concluída antes da janela de 30 dias fica só lá", async () => {
    const { db, ops } = fakeDb({ ...TREE_SEED, tasks: [] });
    const out = await syncBitrixActivitiesInbound(
      db,
      Date.now() + 9999,
      apiWith([
        { ...TODO, COMPLETED: "Y", LAST_UPDATED: "2026-08-01T12:00:00+03:00" },
      ])
    );
    expect(out.created).toBe(0);
    expect(ops.some((o) => o.table === "tasks" && o.op === "insert")).toBe(false);
  });

  it("atividade que não é CRM_TODO é ignorada", async () => {
    const { db, ops } = fakeDb({ ...TREE_SEED, tasks: [] });
    const out = await syncBitrixActivitiesInbound(
      db,
      Date.now() + 9999,
      apiWith([{ ...TODO, PROVIDER_ID: "CRM_EMAIL" }])
    );
    expect(out.created).toBe(0);
    expect(ops.some((o) => o.table === "tasks" && o.op === "insert")).toBe(false);
  });

  // O conteúdo é DAQUI: o outbound o leva. Só o estado vem de lá.
  it("tarefa já espelhada NÃO tem o título sobrescrito", async () => {
    const { db, ops } = fakeDb({
      ...OWNER_SEED,
      tasks: [
        {
          id: "t1",
          record_id: "r1",
          title: "Título que eu editei aqui",
          completed_at: null,
          bitrix_activity_id: "777",
        },
      ],
    });
    await syncBitrixActivitiesInbound(
      db,
      Date.now() + 9999,
      apiWith([{ ...TODO, SUBJECT: "Assunto velho do portal" }])
    );
    const writes = ops.filter((o) => o.table === "tasks" && o.op !== "delete");
    for (const w of writes) {
      expect(JSON.stringify(w.payload ?? {})).not.toContain("Assunto velho");
    }
  });

  it("orçamento estourado para antes de escrever", async () => {
    const { db, ops } = fakeDb({ ...TREE_SEED, tasks: [] });
    await syncBitrixActivitiesInbound(db, Date.now() - 1, apiWith([TODO]));
    expect(ops.some((o) => o.op === "insert")).toBe(false);
  });
});

describe("shouldImportActivity", () => {
  const owner = { tree: true, treeActivatedAt: "2026-10-01T12:00:00Z" };
  const todo = { ID: 1, PROVIDER_ID: "CRM_TODO" };

  it("aberta entra sempre (com Tree)", () => {
    expect(shouldImportActivity(owner, { ...todo, COMPLETED: "N" })).toBe(true);
  });

  it("sem Tree nada entra", () => {
    expect(shouldImportActivity({ tree: false }, { ...todo, COMPLETED: "N" })).toBe(false);
  });

  it("a borda: exatamente 30 dias antes da ativação entra", () => {
    expect(
      shouldImportActivity(owner, {
        ...todo,
        COMPLETED: "Y",
        LAST_UPDATED: "2026-09-01T12:00:00Z",
      })
    ).toBe(true);
    expect(
      shouldImportActivity(owner, {
        ...todo,
        COMPLETED: "Y",
        LAST_UPDATED: "2026-09-01T11:59:00Z",
      })
    ).toBe(false);
  });

  it("concluída sem data não entra (não dá para provar a janela)", () => {
    expect(shouldImportActivity(owner, { ...todo, COMPLETED: "Y" })).toBe(false);
  });
});

describe("activityCompletedAt", () => {
  it("LAST_UPDATED primeiro, END_TIME de fallback", () => {
    expect(
      activityCompletedAt({
        LAST_UPDATED: "2026-09-20T12:00:00+03:00",
        END_TIME: "2026-09-01T12:00:00+03:00",
      })
    ).toBe("2026-09-20T09:00:00.000Z");
    expect(activityCompletedAt({ END_TIME: "2026-09-01T12:00:00+03:00" })).toBe(
      "2026-09-01T09:00:00.000Z"
    );
    expect(activityCompletedAt({})).toBeNull();
  });
});

describe("loadRecordActivitiesNow", () => {
  it("carrega o registro e marca a carga como concluída", async () => {
    const { db, ops } = fakeDb({
      ...TREE_SEED,
      attrs: [
        {
          ...TREE_SEED.attrs[0],
          config: { activatedAt: "2026-10-01T12:00:00Z", inboundLoad: "pending" },
        },
      ],
      tasks: [],
    });
    const out = await loadRecordActivitiesNow(db, "r1", {
      deadline: Date.now() + 9999,
      client: apiWith([TODO]),
    });
    expect(out.created).toBe(1);
    const mark = ops.find((o) => o.table === "record_attributes" && o.op === "update");
    expect(mark!.payload).toMatchObject({
      config: { activatedAt: "2026-10-01T12:00:00Z", inboundLoad: "done" },
    });
  });

  it("Tree pausado não carrega nada", async () => {
    const { db, ops } = fakeDb({
      ...TREE_SEED,
      attrs: [{ ...TREE_SEED.attrs[0], status: "pausado" }],
      tasks: [],
    });
    const api = apiWith([TODO]);
    await loadRecordActivitiesNow(db, "r1", { client: api });
    expect(api.call).not.toHaveBeenCalled();
    expect(ops).toHaveLength(0);
  });
});
