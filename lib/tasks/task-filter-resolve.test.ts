// Versão: 1.0 | Data: 10/10/2026
// v1.0 (10/10/2026): o filtro "Tem tarefa" chegando às consultas — ids p/ o
//   RPC (agregado) e embutido p/ o modo lista, com o MESMO predicado.
import { describe, expect, it } from "vitest";

import {
  applyTaskEmbedFilters,
  MAX_TASK_FILTER_RECORDS,
  resolveTaskFilters,
  TaskFilterTooBroadError,
  taskEmbedSelect,
} from "./task-filter-resolve";

const TODAY = "2026-10-10";

/** Dublê do PostgREST: registra as chamadas e devolve as linhas por página. */
function fakeDb(pages: { record_id: string | null }[][]) {
  const calls: [string, ...unknown[]][] = [];
  let page = 0;
  const b: Record<string, unknown> = {};
  for (const m of ["select", "not", "is", "gte", "lte", "order"]) {
    b[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return b;
    };
  }
  b.range = () => Promise.resolve({ data: pages[page++] ?? [], error: null });
  return { calls, db: { from: () => b } as never };
}

describe("resolveTaskFilters", () => {
  it("sem filtro de tarefa devolve a MESMA lista, sem consulta", async () => {
    const { db, calls } = fakeDb([]);
    const filters = [{ field: "stage", op: "eq" as const, value: "x" }];
    expect(await resolveTaskFilters(db, filters, TODAY)).toBe(filters);
    expect(calls).toHaveLength(0);
  });

  it("vira id in (ids distintos) com o predicado da janela", async () => {
    const { db, calls } = fakeDb([
      [{ record_id: "r1" }, { record_id: "r1" }, { record_id: "r2" }],
    ]);
    const out = await resolveTaskFilters(
      db,
      [
        { field: "stage", op: "eq", value: "x" },
        { field: "task:pendentes", op: "eq", value: "30,60" },
      ],
      TODAY
    );
    expect(out).toEqual([
      { field: "stage", op: "eq", value: "x" },
      { field: "id", op: "in", value: ["r1", "r2"] },
    ]);
    expect(calls).toContainEqual(["is", "completed_at", null]);
    expect(calls).toContainEqual(["gte", "due_date", "2026-09-10"]);
    expect(calls).toContainEqual(["lte", "due_date", "2026-12-09"]);
  });

  it("nenhum registro casa ⇒ resultado VAZIO (uuid-zero), nunca sem filtro", async () => {
    const { db } = fakeDb([[]]);
    const out = await resolveTaskFilters(
      db,
      [{ field: "task:concluidas", op: "eq", value: "" }],
      TODAY
    );
    expect(out).toEqual([
      { field: "id", op: "in", value: ["00000000-0000-0000-0000-000000000000"] },
    ]);
  });

  it("dois filtros de tarefa somam como E (interseção)", async () => {
    const { db } = fakeDb([
      [{ record_id: "r1" }, { record_id: "r2" }],
      [{ record_id: "r2" }, { record_id: "r3" }],
    ]);
    const out = await resolveTaskFilters(
      db,
      [
        { field: "task:pendentes", op: "eq", value: "" },
        { field: "task:atrasadas", op: "eq", value: "" },
      ],
      TODAY
    );
    expect(out).toEqual([{ field: "id", op: "in", value: ["r2"] }]);
  });

  it("filtro de tarefa inválido some (não vira consulta)", async () => {
    const { db, calls } = fakeDb([]);
    const out = await resolveTaskFilters(
      db,
      [{ field: "task:pendentes", op: "eq", value: "999," }],
      TODAY
    );
    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("acima do teto falha ALTO", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ record_id: `r${i}` }));
    const pages = Array.from(
      { length: Math.ceil(MAX_TASK_FILTER_RECORDS / 1000) + 1 },
      (_, p) => rows.map((r) => ({ record_id: `${r.record_id}-${p}` }))
    );
    const { db } = fakeDb(pages);
    await expect(
      resolveTaskFilters(db, [{ field: "task:todas", op: "eq", value: "" }], TODAY)
    ).rejects.toBeInstanceOf(TaskFilterTooBroadError);
  });
});

describe("modo lista: embutido", () => {
  it("um embutido vazio por filtro e o mesmo predicado no alias", () => {
    const specs = [
      { status: "atrasadas" as const, back: 15, ahead: null },
      { status: "concluidas" as const, back: null, ahead: null },
    ];
    expect(taskEmbedSelect(specs)).toBe(", tf0:tasks!inner(), tf1:tasks!inner()");
    const calls: unknown[][] = [];
    const q: Record<string, unknown> = {};
    for (const m of ["is", "not", "gte", "lte"]) {
      q[m] = (...a: unknown[]) => {
        calls.push([m, ...a]);
        return q;
      };
    }
    applyTaskEmbedFilters(q, specs, TODAY);
    expect(calls).toEqual([
      ["is", "tf0.completed_at", null],
      ["gte", "tf0.due_date", "2026-09-25"],
      ["lte", "tf0.due_date", "2026-10-09"],
      ["not", "tf1.completed_at", "is", null],
    ]);
  });
});
