// Versão: 1.0 | Data: 28/07/2026
// Guarda da ordenação cronológica intra-dia da agenda (com hora primeiro,
// nota→tarefa→registro no desempate), da extração de hora por prefixo NAIVE
// (invariante 11 — nunca converter fuso; 00:00 = "só data") e do merge com
// dedupe de registros das pernas do Workspace.
import { describe, expect, it } from "vitest";

import type { AgendaItem } from "./types";
import {
  extractTimeHHMM,
  groupItemsByDay,
  mergeAgendaItems,
  sortDayItems,
} from "./day-items";

function item(partial: Partial<AgendaItem> & { id: string }): AgendaItem {
  return {
    kind: "task",
    date: "2026-07-28",
    time: null,
    title: partial.id,
    ...partial,
  } as AgendaItem;
}

describe("extractTimeHHMM", () => {
  it("lê o prefixo naive de datetimes (T e espaço), sem converter fuso", () => {
    expect(extractTimeHHMM("2026-07-28T14:30:00Z")).toBe("14:30");
    expect(extractTimeHHMM("2026-07-28T14:30:00-03:00")).toBe("14:30");
    expect(extractTimeHHMM("2026-07-28 09:05:00")).toBe("09:05");
  });

  it("date-only, meia-noite e lixo viram null", () => {
    expect(extractTimeHHMM("2026-07-28")).toBeNull();
    expect(extractTimeHHMM("2026-07-28T00:00:00-03:00")).toBeNull();
    expect(extractTimeHHMM("2026-07-28T99:99:00")).toBeNull();
    expect(extractTimeHHMM(null)).toBeNull();
    expect(extractTimeHHMM(1234)).toBeNull();
    expect(extractTimeHHMM("não é data")).toBeNull();
  });
});

describe("sortDayItems", () => {
  it("com hora primeiro (asc); sem hora depois, nota→tarefa→registro", () => {
    const sorted = sortDayItems([
      item({ id: "r1", kind: "record", title: "Registro" }),
      item({ id: "t2", kind: "task", time: "14:00", title: "Reunião" }),
      item({ id: "n1", kind: "note", title: "Anotação" }),
      item({ id: "t1", kind: "task", time: "09:00", title: "Ligação" }),
      item({ id: "t3", kind: "task", title: "Sem hora" }),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["t1", "t2", "n1", "t3", "r1"]);
  });

  it("desempata por título pt-BR e id (estável e determinístico)", () => {
    const sorted = sortDayItems([
      item({ id: "b", kind: "task", title: "Zebra" }),
      item({ id: "a", kind: "task", title: "Água" }),
      item({ id: "d2", kind: "task", title: "Igual" }),
      item({ id: "d1", kind: "task", title: "Igual" }),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["a", "d1", "d2", "b"]);
  });

  it("não muta a entrada", () => {
    const input = [
      item({ id: "b", kind: "task", time: "10:00" }),
      item({ id: "a", kind: "task", time: "09:00" }),
    ];
    sortDayItems(input);
    expect(input.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("groupItemsByDay", () => {
  it("agrupa por dia com cada dia já ordenado", () => {
    const map = groupItemsByDay([
      item({ id: "x", date: "2026-07-28", time: "15:00" }),
      item({ id: "y", date: "2026-07-29" }),
      item({ id: "z", date: "2026-07-28", time: "08:00" }),
    ]);
    expect(map.get("2026-07-28")?.map((i) => i.id)).toEqual(["z", "x"]);
    expect(map.get("2026-07-29")?.map((i) => i.id)).toEqual(["y"]);
  });
});

describe("mergeAgendaItems", () => {
  it("deduplica registro por id|date entre pernas; tarefas/notas passam", () => {
    const merged = mergeAgendaItems([
      [
        item({ id: "r1", kind: "record", date: "2026-07-28" }),
        item({ id: "t1", kind: "task", date: "2026-07-28" }),
      ],
      [
        // mesmo registro, mesmo dia (dois widgets com o mesmo campo) — some
        item({ id: "r1", kind: "record", date: "2026-07-28" }),
        // mesmo registro, dia DIFERENTE (campos de data distintos) — fica
        item({ id: "r1", kind: "record", date: "2026-07-30" }),
        item({ id: "n1", kind: "note", date: "2026-07-28" }),
      ],
    ]);
    expect(merged.map((i) => `${i.kind}:${i.id}:${i.date}`)).toEqual([
      "record:r1:2026-07-28",
      "task:t1:2026-07-28",
      "record:r1:2026-07-30",
      "note:n1:2026-07-28",
    ]);
  });
});
