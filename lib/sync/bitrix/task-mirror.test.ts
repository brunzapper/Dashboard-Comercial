// Versão: 1.2 | Data: 10/09/2026
// v1.2 (10/09/2026): a resolução de dono EM LOTE e a guarda de que as ações em
// massa espelham. Sem elas, concluir 20 tarefas de uma vez deixava 20
// atividades abertas no CRM — e a leitura de volta (0137) reabria as 20 na
// sincronização seguinte, para sempre.
// v1.1 (10/09/2026): as duas operações de 0137 — apagar a atividade e mandar a
// anotação como comentário. A de apagar é a que tem armadilha: a ordem existe
// SEM tarefa (a linha já foi removida), então tudo o que ela tem é o
// `activity_id`.
// O espelho de tarefa como ATIVIDADE do CRM (0136).
//
// O que está em risco aqui é duplicar: o tick roda a cada minuto, e uma
// atividade criada duas vezes polui o feed do negócio — que é justamente o
// lugar onde o time lê o histórico. Por isso os testes de idempotência são a
// maior parte.
import { describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";

import {
  activityDeadline,
  activityFields,
  drainTaskMirrorQueue,
  loadMirrorOwners,
} from "./task-mirror";

const TASK = {
  id: "t1",
  title: "Acompanhar deal em Nutrição",
  description: null,
  due_date: "2026-09-29",
  due_time: null,
  completed_at: null,
  responsible_id: "r1",
  bitrix_activity_id: null as string | null,
};

describe("activityDeadline", () => {
  it("sem hora, meio-dia de Brasília", () => {
    // 00:00 no fuso do portal (Moscou) cairia no dia ANTERIOR para quem lê lá.
    expect(activityDeadline("2026-09-29", null)).toBe(
      "2026-09-29T12:00:00-03:00"
    );
  });

  it("com hora, a hora da tarefa", () => {
    expect(activityDeadline("2026-09-29", "14:30:00")).toBe(
      "2026-09-29T14:30:00-03:00"
    );
  });

  it("sem prazo não inventa data", () => {
    expect(activityDeadline(null, "14:30")).toBeNull();
  });
});

describe("activityFields", () => {
  it("monta o TODO da timeline amarrado ao negócio", () => {
    const f = activityFields(TASK, "deal", "123", "89");
    expect(f.TYPE_ID).toBe(6);
    expect(f.PROVIDER_ID).toBe("CRM_TODO");
    expect(f.OWNER_ID).toBe("123");
    expect(f.OWNER_TYPE_ID).toBe(2); // deal
    expect(f.BINDINGS).toEqual([{ OWNER_ID: "123", OWNER_TYPE_ID: 2 }]);
    expect(f.RESPONSIBLE_ID).toBe("89");
    expect(f.COMPLETED).toBe("N");
  });

  it("lead usa OWNER_TYPE_ID 1", () => {
    expect(activityFields(TASK, "lead", "9", null).OWNER_TYPE_ID).toBe(1);
  });

  it("tarefa concluída fecha a atividade", () => {
    const f = activityFields(
      { ...TASK, completed_at: "2026-09-30T10:00:00Z" },
      "deal",
      "123",
      null
    );
    expect(f.COMPLETED).toBe("Y");
  });

  it("responsável sem usuário no Bitrix não manda o campo", () => {
    expect(activityFields(TASK, "deal", "123", null).RESPONSIBLE_ID).toBeUndefined();
  });
});

/** Dublê do PostgREST com só o que o dreno encadeia. */
function fakeDb(opts: {
  queue: Record<string, unknown>[];
  task: Record<string, unknown> | null;
  comment?: Record<string, unknown> | null;
}) {
  const updates: { table: string; patch: Record<string, unknown> }[] = [];
  const make = (table: string) => {
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.select = self;
    b.eq = self;
    b.order = self;
    b.update = (patch: Record<string, unknown>) => {
      updates.push({ table, patch });
      return b;
    };
    b.limit = () =>
      Promise.resolve({ data: table === "bitrix_task_queue" ? opts.queue : [] });
    b.maybeSingle = () =>
      Promise.resolve({
        data:
          table === "tasks"
            ? opts.task
            : table === "responsibles"
              ? { bitrix_user_id: "89" }
              : table === "comments"
                ? (opts.comment ?? null)
                : null,
      });
    return b;
  };
  return { updates, db: { from: make } as never };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: "q1",
  task_id: "t1",
  comment_id: null,
  target: "task",
  op: "create",
  owner_entity: "deal",
  owner_source_id: "123",
  activity_id: null,
  attempts: 0,
  ...over,
});

describe("drainTaskMirrorQueue", () => {
  it("cria a atividade e GUARDA o id na tarefa", async () => {
    const { db, updates } = fakeDb({ queue: [row()], task: { ...TASK } });
    const call = vi.fn().mockResolvedValue({ result: 777 });
    const out = await drainTaskMirrorQueue(db, Date.now() + 10_000, { call });

    expect(call).toHaveBeenCalledWith("crm.activity.add", expect.anything());
    // Sem gravar o id, a próxima rodada criaria a MESMA atividade de novo.
    expect(updates).toContainEqual({
      table: "tasks",
      patch: { bitrix_activity_id: "777" },
    });
    expect(out.done).toBe(1);
  });

  // A trava de verdade: a tarefa JÁ tem id, então 'create' vira atualização.
  it("tarefa já espelhada NÃO cria de novo — atualiza", async () => {
    const { db } = fakeDb({
      queue: [row()],
      task: { ...TASK, bitrix_activity_id: "777" },
    });
    const call = vi.fn().mockResolvedValue({ result: true });
    await drainTaskMirrorQueue(db, Date.now() + 10_000, { call });

    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0]).toBe("crm.activity.update");
    expect(call.mock.calls[0][1]).toMatchObject({ id: "777" });
  });

  it("concluir manda COMPLETED 'Y' na atividade existente", async () => {
    const { db } = fakeDb({
      queue: [row({ op: "complete", activity_id: "777" })],
      task: {
        ...TASK,
        bitrix_activity_id: "777",
        completed_at: "2026-09-30T10:00:00Z",
      },
    });
    const call = vi.fn().mockResolvedValue({ result: true });
    await drainTaskMirrorQueue(db, Date.now() + 10_000, { call });

    expect(call.mock.calls[0][0]).toBe("crm.activity.update");
    const fields = (call.mock.calls[0][1] as { fields: Record<string, unknown> })
      .fields;
    expect(fields.COMPLETED).toBe("Y");
  });

  it("tarefa apagada vira 'error' sem retentativa — não é falha do Bitrix", async () => {
    const { db, updates } = fakeDb({ queue: [row()], task: null });
    const call = vi.fn();
    const out = await drainTaskMirrorQueue(db, Date.now() + 10_000, { call });

    expect(call).not.toHaveBeenCalled();
    expect(out.errors).toBe(1);
    const patch = updates.find((u) => u.table === "bitrix_task_queue")!.patch;
    expect(patch.status).toBe("error"); // WriteBackFatal: não repete
  });

  it("falha do portal fica 'pending' para a próxima rodada", async () => {
    const { db, updates } = fakeDb({ queue: [row()], task: { ...TASK } });
    const call = vi.fn().mockRejectedValue(new Error("QUERY_LIMIT_EXCEEDED"));
    const out = await drainTaskMirrorQueue(db, Date.now() + 10_000, { call });

    expect(out.errors).toBe(1);
    const patch = updates.find((u) => u.table === "bitrix_task_queue")!.patch;
    expect(patch.status).toBe("pending");
    expect(patch.attempts).toBe(1);
  });

  it("na 5ª tentativa desiste", async () => {
    const { db, updates } = fakeDb({
      queue: [row({ attempts: 4 })],
      task: { ...TASK },
    });
    const call = vi.fn().mockRejectedValue(new Error("falhou"));
    await drainTaskMirrorQueue(db, Date.now() + 10_000, { call });

    const patch = updates.find((u) => u.table === "bitrix_task_queue")!.patch;
    expect(patch.status).toBe("error");
  });

  it("fila vazia não chama o Bitrix", async () => {
    const { db } = fakeDb({ queue: [], task: null });
    const call = vi.fn();
    expect(await drainTaskMirrorQueue(db, Date.now() + 10_000, { call })).toEqual(
      { done: 0, errors: 0 }
    );
    expect(call).not.toHaveBeenCalled();
  });

  // A ordem de exclusão sobrevive à tarefa: a FK virou `set null` na 0137
  // justamente porque, quando o dreno roda, a linha já não existe.
  it("excluir chama crm.activity.delete SEM tarefa", async () => {
    const { db, updates } = fakeDb({
      queue: [
        row({ op: "delete", task_id: null, activity_id: "777" }),
      ],
      task: null,
    });
    const call = vi.fn().mockResolvedValue({ result: true });
    const out = await drainTaskMirrorQueue(db, Date.now() + 10_000, { call });

    expect(call).toHaveBeenCalledWith("crm.activity.delete", { id: "777" });
    expect(out.done).toBe(1);
    expect(
      updates.find((u) => u.table === "bitrix_task_queue")!.patch.status
    ).toBe("done");
  });

  // Apagar o que já não existe é o RESULTADO desejado, não uma falha a repetir
  // cinco vezes.
  it("atividade que já sumiu lá conta como feita", async () => {
    const { db, updates } = fakeDb({
      queue: [row({ op: "delete", task_id: null, activity_id: "777" })],
      task: null,
    });
    const call = vi.fn().mockRejectedValue(new Error("NOT_FOUND"));
    const out = await drainTaskMirrorQueue(db, Date.now() + 10_000, { call });

    expect(out.done).toBe(1);
    expect(
      updates.find((u) => u.table === "bitrix_task_queue")!.patch.status
    ).toBe("done");
  });

  it("excluir sem id da atividade não repete — não é falha do portal", async () => {
    const { db, updates } = fakeDb({
      queue: [row({ op: "delete", task_id: null, activity_id: null })],
      task: null,
    });
    const call = vi.fn();
    await drainTaskMirrorQueue(db, Date.now() + 10_000, { call });

    expect(call).not.toHaveBeenCalled();
    expect(
      updates.find((u) => u.table === "bitrix_task_queue")!.patch.status
    ).toBe("error");
  });

  it("anotação vira comentário e GUARDA o id", async () => {
    const { db, updates } = fakeDb({
      queue: [
        row({
          op: "comment_add",
          target: "comment",
          task_id: null,
          comment_id: "c1",
        }),
      ],
      task: null,
      comment: { id: "c1", body: "Cliente pediu proposta", bitrix_comment_id: null },
    });
    const call = vi.fn().mockResolvedValue({ result: 555 });
    await drainTaskMirrorQueue(db, Date.now() + 10_000, { call });

    expect(call.mock.calls[0][0]).toBe("crm.timeline.comment.add");
    expect(updates).toContainEqual({
      table: "comments",
      patch: { bitrix_comment_id: "555" },
    });
  });

  // Sem esta guarda, uma retentativa duplicaria o comentário no feed.
  it("anotação já espelhada não comenta de novo", async () => {
    const { db } = fakeDb({
      queue: [
        row({
          op: "comment_add",
          target: "comment",
          task_id: null,
          comment_id: "c1",
        }),
      ],
      task: null,
      comment: { id: "c1", body: "oi", bitrix_comment_id: "555" },
    });
    const call = vi.fn();
    const out = await drainTaskMirrorQueue(db, Date.now() + 10_000, { call });

    expect(call).not.toHaveBeenCalled();
    expect(out.done).toBe(1);
  });

  it("orçamento estourado para antes de chamar", async () => {
    const { db } = fakeDb({ queue: [row()], task: { ...TASK } });
    const call = vi.fn();
    await drainTaskMirrorQueue(db, Date.now() - 1, { call });
    expect(call).not.toHaveBeenCalled();
  });
});


/** Dublê mínimo para `loadMirrorOwners`: duas tabelas, nada encadeado além. */
function ownersDb(seed: {
  sources: Record<string, unknown>[];
  records: Record<string, unknown>[];
}) {
  const queried: string[] = [];
  const make = (table: string) => {
    queried.push(table);
    const b: Record<string, unknown> = {};
    const self = () => b;
    b.select = self;
    b.in = self;
    b.not = self;
    b.then = (res: (v: { data: unknown[] }) => unknown) =>
      Promise.resolve({
        data: table === "data_sources" ? seed.sources : seed.records,
      }).then(res);
    return b;
  };
  return { queried, db: { from: make } as never };
}

describe("loadMirrorOwners", () => {
  const SOURCES = [{ record_type: "negocio", bitrix_activity_owner: "deal" }];

  it("resolve entidade e id do CRM por registro", async () => {
    const { db } = ownersDb({
      sources: SOURCES,
      records: [{ id: "r1", record_type: "negocio", source_id: 123 }],
    });
    const owners = await loadMirrorOwners(db, ["r1"]);
    expect(owners.get("r1")).toEqual({ entity: "deal", sourceId: "123" });
  });

  // O piso do resolveMirror, agora em lote: Base que não espelha fica fora.
  it("registro de Base que não espelha fica FORA do mapa", async () => {
    const { db } = ownersDb({
      sources: SOURCES,
      records: [{ id: "r2", record_type: "lead", source_id: 9 }],
    });
    expect((await loadMirrorOwners(db, ["r2"])).size).toBe(0);
  });

  // O ganho que motiva o lote: duas consultas no total, não duas por tarefa.
  it("nenhuma Base espelha: nem lê os registros", async () => {
    const { db, queried } = ownersDb({ sources: [], records: [] });
    expect((await loadMirrorOwners(db, ["r1", "r2", "r3"])).size).toBe(0);
    expect(queried).toEqual(["data_sources"]);
  });

  it("lista vazia não consulta nada", async () => {
    const { db, queried } = ownersDb({ sources: SOURCES, records: [] });
    expect((await loadMirrorOwners(db, [])).size).toBe(0);
    expect(queried).toEqual([]);
  });
});

/**
 * A GUARDA da regressão. O risco não é a função de resolução — é alguém mexer
 * nas ações em massa e o espelho sumir de novo, em silêncio, com o sintoma
 * aparecendo só um minuto depois (o inbound reabrindo tudo).
 */
describe("as ações em massa espelham no Bitrix", () => {
  const src = readFileSync("lib/kanban/bulk-actions.ts", "utf8");

  it("concluir em lote enfileira o espelho", () => {
    expect(src).toContain("mirrorCompletedBulk");
    // Os dois ramos: por taskIds (modo tarefas) e por recordIds.
    expect(src.match(/await mirrorCompletedBulk\(/g)?.length).toBe(2);
  });

  it("excluir em lote lê o id da atividade ANTES do delete", () => {
    const readAt = src.indexOf("mirrorBefore");
    const deleteAt = src.indexOf('.from("tasks")\n      .delete()');
    expect(readAt).toBeGreaterThan(-1);
    // A leitura tem de vir primeiro: depois do delete a linha já não existe.
    if (deleteAt > -1) expect(readAt).toBeLessThan(deleteAt);
    expect(src).toContain("mirrorDeletedBulk");
  });

  it("usa a resolução em LOTE, não a por tarefa", () => {
    expect(src).toContain("loadMirrorOwners");
    // `mirrorTaskAfterWrite` resolve Base+registro por tarefa: em 200 itens
    // seriam 400 consultas.
    expect(src).not.toContain("mirrorTaskAfterWrite");
  });
});
