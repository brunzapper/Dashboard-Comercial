// Versão: 1.1 | Data: 11/10/2026
// v1.1 (11/10/2026): o cursor lembra os TIPOS de dono — Base que liga o
//   espelho depois (lead, processo inteligente) recomeça a varredura.
// v1.0 (11/10/2026): a DESCOBERTA das atividades em todos os registros.
//
// O que está em risco: o cursor. Ele só pode andar pelo que foi processado —
// pular uma página deixaria atividade de fora para sempre (a fase incremental
// só olha para frente) — e as três fases têm de pedir ao portal exatamente o
// recorte combinado: pendentes de qualquer idade, concluídas de 90 dias, e
// depois só o que mudou.
import { describe, expect, it, vi } from "vitest";

import {
  discoverBitrixActivities,
  discoveryFilter,
  parseDiscoveryState,
  reconcileDiscoveryTypes,
} from "./activity-discovery";

describe("discoveryFilter", () => {
  const NOW = Date.parse("2026-10-11T12:00:00Z");

  it("fase 1: pendentes por ID, retomando do último visto", () => {
    expect(discoveryFilter({ phase: "pending" }, [2], NOW)).toEqual({
      filter: { "@OWNER_TYPE_ID": [2], COMPLETED: "N" },
      order: { ID: "ASC" },
    });
    expect(
      discoveryFilter({ phase: "pending", lastId: "90" }, [2], NOW).filter
    ).toMatchObject({ ">ID": "90" });
  });

  it("fase 2: concluídas dos 90 dias ANTES do início da varredura", () => {
    const { filter } = discoveryFilter(
      { phase: "done", startedAt: "2026-10-11T00:00:00.000Z" },
      [2, 1],
      NOW
    );
    expect(filter).toEqual({
      "@OWNER_TYPE_ID": [2, 1],
      COMPLETED: "Y",
      ">=LAST_UPDATED": "2026-07-13T00:00:00.000Z",
    });
  });

  it("fase 3: só o que mudou desde o último visto", () => {
    const out = discoveryFilter(
      { phase: "incremental", startedAt: "a", since: "2026-10-10T09:00:00+03:00" },
      [2],
      NOW
    );
    expect(out.filter).toEqual({
      "@OWNER_TYPE_ID": [2],
      ">=LAST_UPDATED": "2026-10-10T09:00:00+03:00",
    });
    expect(out.order).toEqual({ LAST_UPDATED: "ASC", ID: "ASC" });
  });
});

describe("parseDiscoveryState", () => {
  it("lixo ou ausência começa da fase 1", () => {
    expect(parseDiscoveryState(null)).toEqual({ phase: "pending" });
    expect(parseDiscoveryState({ phase: "x", lastId: 3 })).toEqual({
      phase: "pending",
    });
  });
});

/** Dublê do PostgREST: devolve linhas por tabela e registra as escritas. */
function fakeDb(seed: {
  state?: unknown;
  records?: Record<string, unknown>[];
  tasks?: Record<string, unknown>[];
}) {
  const ops: { table: string; op: string; payload?: unknown }[] = [];
  const rowsFor = (table: string) => {
    if (table === "data_sources")
      return [
        { record_type: "negocio", bitrix_activity_owner: "deal", organization_id: "org1" },
      ];
    if (table === "records") return seed.records ?? [];
    if (table === "tasks") return seed.tasks ?? [];
    if (table === "responsibles") return [];
    return [];
  };
  const make = (table: string) => {
    const b: Record<string, unknown> = {};
    const self = () => b;
    for (const m of ["select", "eq", "in", "not", "is", "order", "limit"]) b[m] = self;
    b.maybeSingle = () =>
      Promise.resolve({
        data: table === "sync_config" ? (seed.state ? { value: seed.state } : null) : (rowsFor(table)[0] ?? null),
      });
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
    b.upsert = (payload: unknown) => {
      ops.push({ table, op: "upsert", payload });
      return Promise.resolve({ error: null });
    };
    b.then = (res: (v: { data: unknown[] }) => unknown) =>
      Promise.resolve({ data: rowsFor(table) }).then(res);
    return b;
  };
  return { ops, db: { from: make } as never };
}

const REC = { id: "r1", organization_id: "org1", source_id: "123" };
const ACT = { ID: 500, OWNER_ID: 123, OWNER_TYPE_ID: 2, SUBJECT: "Ligar", COMPLETED: "N" };

function savedState(ops: { table: string; op: string; payload?: unknown }[]) {
  const up = ops.find((o) => o.table === "sync_config" && o.op === "upsert");
  return (up!.payload as { value: Record<string, unknown> }).value;
}

describe("discoverBitrixActivities", () => {
  it("importa a pendente do negócio que nunca teve tarefa aqui", async () => {
    const { db, ops } = fakeDb({ records: [REC] });
    const api = {
      call: vi.fn().mockResolvedValue({ result: [ACT] }),
    };
    const out = await discoverBitrixActivities(db, Date.now() + 9999, api);
    expect(out).toMatchObject({ seen: 1, created: 1 });
    const ins = ops.find((o) => o.table === "tasks" && o.op === "insert");
    expect(ins!.payload).toMatchObject({
      record_id: "r1",
      bitrix_activity_id: "500",
      read_only: false,
    });
    // Sem `next`: fim das pendentes, a fase seguinte já fica gravada.
    expect(savedState(ops)).toMatchObject({ phase: "done" });
  });

  it("atividade de registro que não existe aqui é ignorada", async () => {
    const { db, ops } = fakeDb({ records: [] });
    const api = { call: vi.fn().mockResolvedValue({ result: [ACT] }) };
    const out = await discoverBitrixActivities(db, Date.now() + 9999, api);
    expect(out!.created).toBe(0);
    expect(ops.some((o) => o.op === "insert")).toBe(false);
  });

  it("conhecida concluída LÁ fecha a tarefa AQUI, sem duplicar", async () => {
    const { db, ops } = fakeDb({
      records: [REC],
      tasks: [{ id: "t1", completed_at: null, created_by: null, bitrix_activity_id: "500" }],
    });
    const api = {
      call: vi.fn().mockResolvedValue({
        result: [{ ...ACT, COMPLETED: "Y", LAST_UPDATED: "2026-10-10T12:00:00Z" }],
      }),
    };
    const out = await discoverBitrixActivities(db, Date.now() + 9999, api);
    expect(out).toMatchObject({ created: 0, completed: 1 });
    expect(ops.some((o) => o.op === "insert")).toBe(false);
    const upd = ops.find((o) => o.table === "tasks" && o.op === "update");
    expect(upd!.payload).toMatchObject({ read_only: true });
  });

  it("com `next`, o cursor anda pelo último ID processado e a fase segue", async () => {
    const { db, ops } = fakeDb({ records: [REC] });
    const api = {
      call: vi
        .fn()
        .mockResolvedValueOnce({ result: [ACT], next: 50 })
        .mockResolvedValue({ result: [{ ...ACT, ID: 501 }], next: 50 }),
    };
    await discoverBitrixActivities(db, Date.now() + 9999, api);
    expect(savedState(ops)).toMatchObject({ phase: "pending", lastId: "501" });
    // A 2ª página já pede a partir do último visto.
    expect(api.call.mock.calls[1][1].filter).toMatchObject({ ">ID": "500" });
  });

  it("orçamento estourado: não lê nada e o cursor não anda", async () => {
    const { db, ops } = fakeDb({ records: [REC], state: { phase: "pending", lastId: "7" } });
    const api = { call: vi.fn() };
    await discoverBitrixActivities(db, Date.now() - 1, api);
    expect(api.call).not.toHaveBeenCalled();
    expect(savedState(ops)).toMatchObject({ phase: "pending", lastId: "7" });
  });
});

describe("reconcileDiscoveryTypes (v1.1)", () => {
  const NOW_ISO = "2026-10-11T12:00:00.000Z";

  it("cursor novo só registra os tipos", () => {
    expect(reconcileDiscoveryTypes({ phase: "pending" }, [2], NOW_ISO)).toEqual({
      phase: "pending",
      typeIds: [2],
    });
  });

  it("mesmos tipos: o cursor segue onde estava", () => {
    const st = { phase: "incremental" as const, startedAt: "x", since: "y", typeIds: [1, 2] };
    expect(reconcileDiscoveryTypes(st, [2, 1], NOW_ISO)).toEqual(st);
  });

  it("tipo NOVO (lead ligado, processo aprovado) recomeça a fase 1", () => {
    const st = { phase: "incremental" as const, startedAt: "x", since: "y", typeIds: [2] };
    expect(reconcileDiscoveryTypes(st, [2, 1036], NOW_ISO)).toEqual({
      phase: "pending",
      startedAt: NOW_ISO,
      typeIds: [2, 1036],
    });
  });

  it("estado legado (sem typeIds) recomeça uma vez", () => {
    const st = { phase: "incremental" as const, startedAt: "x", since: "y" };
    expect(reconcileDiscoveryTypes(st, [2], NOW_ISO).phase).toBe("pending");
  });

  it("tipo DESLIGADO não recomeça", () => {
    const st = { phase: "done" as const, startedAt: "x", lastId: "9", typeIds: [1, 2] };
    expect(reconcileDiscoveryTypes(st, [2], NOW_ISO)).toMatchObject({
      phase: "done",
      lastId: "9",
    });
  });

  it("typeIds sobrevive ao parse", () => {
    expect(parseDiscoveryState({ phase: "done", typeIds: [2, "1036", -1] }).typeIds).toEqual([
      2, 1036,
    ]);
  });
});
