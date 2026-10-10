// Versão: 1.0 | Data: 10/10/2026
// v1.0 (10/10/2026): o filtro "Tem tarefa" — representação e predicado.
import { describe, expect, it } from "vitest";

import {
  MAX_TASK_FILTER_DAYS,
  parseTaskFilter,
  serializeTaskFilter,
  taskFilterWindow,
  taskMatchesFilter,
} from "./task-filter";

const TODAY = "2026-10-10";

describe("parseTaskFilter / serializeTaskFilter", () => {
  it("round-trip", () => {
    const spec = { status: "pendentes" as const, back: 30, ahead: 60 };
    expect(parseTaskFilter(serializeTaskFilter(spec))).toEqual(spec);
  });

  it("lado vazio é sem limite", () => {
    expect(parseTaskFilter({ field: "task:todas", op: "eq", value: ",15" })).toEqual(
      { status: "todas", back: null, ahead: 15 }
    );
    expect(parseTaskFilter({ field: "task:concluidas", op: "eq" })).toEqual({
      status: "concluidas",
      back: null,
      ahead: null,
    });
  });

  it("acima de 180 é inválido, nunca cortado", () => {
    expect(
      parseTaskFilter({ field: "task:pendentes", op: "eq", value: `${MAX_TASK_FILTER_DAYS + 1},0` })
    ).toBeNull();
    expect(
      parseTaskFilter({ field: "task:pendentes", op: "eq", value: "180,180" })
    ).not.toBeNull();
  });

  it("estado desconhecido, op diferente ou número quebrado são inválidos", () => {
    expect(parseTaskFilter({ field: "task:abertas", op: "eq", value: "" })).toBeNull();
    expect(parseTaskFilter({ field: "task:todas", op: "neq", value: "" })).toBeNull();
    expect(parseTaskFilter({ field: "task:todas", op: "eq", value: "-3," })).toBeNull();
    expect(parseTaskFilter({ field: "stage", op: "eq", value: "x" })).toBeNull();
  });
});

describe("taskFilterWindow", () => {
  it("30 atrás / 60 à frente sobre o prazo", () => {
    expect(
      taskFilterWindow({ status: "pendentes", back: 30, ahead: 60 }, TODAY)
    ).toEqual({ completed: "open", dueFrom: "2026-09-10", dueTo: "2026-12-09" });
  });

  it("atrasadas: o teto vira ontem", () => {
    expect(
      taskFilterWindow({ status: "atrasadas", back: 15, ahead: 15 }, TODAY)
    ).toEqual({ completed: "open", dueFrom: "2026-09-25", dueTo: "2026-10-09" });
    expect(
      taskFilterWindow({ status: "atrasadas", back: null, ahead: null }, TODAY)
    ).toEqual({ completed: "open", dueTo: "2026-10-09" });
  });

  it("concluídas e todas", () => {
    expect(taskFilterWindow({ status: "concluidas", back: null, ahead: null }, TODAY))
      .toEqual({ completed: "done" });
    expect(taskFilterWindow({ status: "todas", back: 0, ahead: 0 }, TODAY)).toEqual({
      completed: "any",
      dueFrom: TODAY,
      dueTo: TODAY,
    });
  });
});

describe("taskMatchesFilter", () => {
  const open = (due: string | null) => ({ due_date: due, completed_at: null });
  const done = (due: string | null) => ({ due_date: due, completed_at: "2026-10-01T10:00:00Z" });

  it("pendentes dentro da janela", () => {
    const spec = { status: "pendentes" as const, back: 15, ahead: 15 };
    expect(taskMatchesFilter([open("2026-10-20")], spec, TODAY)).toBe(true);
    expect(taskMatchesFilter([open("2026-11-20")], spec, TODAY)).toBe(false);
    expect(taskMatchesFilter([done("2026-10-20")], spec, TODAY)).toBe(false);
  });

  it("com janela, tarefa sem prazo não casa; sem janela, casa", () => {
    expect(
      taskMatchesFilter([open(null)], { status: "pendentes", back: 30, ahead: null }, TODAY)
    ).toBe(false);
    expect(
      taskMatchesFilter([open(null)], { status: "pendentes", back: null, ahead: null }, TODAY)
    ).toBe(true);
  });

  it("atrasada é pendente com prazo antes de hoje", () => {
    const spec = { status: "atrasadas" as const, back: null, ahead: null };
    expect(taskMatchesFilter([open("2026-10-09")], spec, TODAY)).toBe(true);
    expect(taskMatchesFilter([open(TODAY)], spec, TODAY)).toBe(false);
    expect(taskMatchesFilter([done("2026-10-01")], spec, TODAY)).toBe(false);
  });

  it("sem tarefa nenhuma nunca casa", () => {
    expect(
      taskMatchesFilter([], { status: "todas", back: null, ahead: null }, TODAY)
    ).toBe(false);
  });
});
