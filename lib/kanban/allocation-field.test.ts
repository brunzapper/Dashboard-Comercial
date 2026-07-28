// Versão: 1.0 | Data: 28/07/2026
// Alocação-como-campo (invariante 24): puras (colunas visíveis, options,
// diff do quadro, normalização no save) + escrita com fake-supabase (só
// diffs, carimbos field_modified_at/locally_modified_at, escopo de org,
// mock nunca recebe escrita, recalc em lote). recalc é mockado (service
// client próprio).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/records/recalc", () => ({
  recalcFormulaFieldsForRecords: vi.fn(async () => 0),
}));

import { recalcFormulaFieldsForRecords } from "@/lib/records/recalc";
import { fakeSupabase, hasStep } from "@/tests/helpers/fake-supabase";
import type { RecordRow } from "@/lib/records/types";
import type { KanbanBoardData, KanbanCard } from "./data";
import { DEFAULT_CUSTOM_COLUMNS, type KanbanSettings } from "./types";
import {
  applyAllocationForSettings,
  buildAllocationOptions,
  normalizeKanbanAllocationOnSave,
  planAllocationUpdates,
  visibleCustomColumns,
  writeAllocationValues,
} from "./allocation-field";

const baseSettings = (over: Partial<KanbanSettings> = {}): KanbanSettings => ({
  mode: "registros",
  source: "leads",
  columnSource: "custom",
  columns: [
    { key: "c_a", label: "Novo" },
    { key: "c_b", label: "Em análise" },
    { key: "c_c", label: "Fechado" },
  ],
  allocationFieldKey: "fase_vendas",
  ...over,
});

function card(
  id: string,
  columnKey: string,
  custom: Record<string, unknown>,
  over: Partial<KanbanCard> = {}
): KanbanCard {
  return {
    id,
    title: id,
    columnKey,
    groupKey: columnKey,
    dateValue: null,
    colorValue: null,
    fields: [],
    metricValue: null,
    isMock: false,
    openTasks: 0,
    record: { id, custom_fields: custom } as unknown as RecordRow,
    ...over,
  };
}

function board(
  cols: { key: string; label: string; cards: KanbanCard[] }[]
): KanbanBoardData {
  return {
    mode: "registros",
    metricLabel: null,
    metricIsMoney: false,
    columns: cols.map((c) => ({
      key: c.key,
      label: c.label,
      cards: c.cards,
      count: c.cards.length,
      metricSum: null,
    })),
  };
}

describe("visibleCustomColumns", () => {
  it("filtra ocultas, usa key quando o rótulo é vazio e respeita a ordem", () => {
    const cols = visibleCustomColumns(
      baseSettings({
        columns: [
          { key: "c_a", label: "Novo" },
          { key: "c_b", hidden: true, label: "Oculta" },
          { key: "c_c", label: "  " },
        ],
      })
    );
    expect(cols).toEqual([
      { key: "c_a", label: "Novo" },
      { key: "c_c", label: "c_c" },
    ]);
  });

  it("sem columns usa o seed DEFAULT_CUSTOM_COLUMNS", () => {
    const cols = visibleCustomColumns(baseSettings({ columns: undefined }));
    expect(cols.map((c) => c.key)).toEqual(
      DEFAULT_CUSTOM_COLUMNS.map((c) => c.key)
    );
  });

  it("vazio fora do modo Personalizar", () => {
    expect(
      visibleCustomColumns(baseSettings({ columnSource: undefined }))
    ).toEqual([]);
    expect(visibleCustomColumns({ mode: "tarefas" })).toEqual([]);
  });
});

describe("buildAllocationOptions", () => {
  it("rótulos visíveis em ordem, deduplicados", () => {
    const options = buildAllocationOptions(
      baseSettings({
        columns: [
          { key: "c_a", label: "Novo" },
          { key: "c_b", label: "Novo" },
          { key: "c_c", label: "Fechado" },
          { key: "c_d", hidden: true, label: "Oculta" },
        ],
      })
    );
    expect(options).toEqual(["Novo", "Fechado"]);
  });
});

describe("planAllocationUpdates", () => {
  it("só diffs entram; card correto fica de fora", () => {
    const data = board([
      {
        key: "c_a",
        label: "Novo",
        cards: [
          card("r1", "c_a", {}), // sem valor → grava "Novo"
          card("r2", "c_a", { fase_vendas: "Novo" }), // já correto
        ],
      },
      {
        key: "c_b",
        label: "Em análise",
        cards: [card("r3", "c_b", { fase_vendas: "Novo" })], // desatualizado
      },
    ]);
    expect(planAllocationUpdates(data, "fase_vendas")).toEqual([
      { recordId: "r1", value: "Novo" },
      { recordId: "r3", value: "Em análise" },
    ]);
  });

  it("mock e card sem record são pulados", () => {
    const data = board([
      {
        key: "c_a",
        label: "Novo",
        cards: [
          card("r1", "c_a", {}, { isMock: true }),
          card("r2", "c_a", {}, { record: undefined }),
        ],
      },
    ]);
    expect(planAllocationUpdates(data, "fase_vendas")).toEqual([]);
  });

  it("card sem posição/chave órfã já vem na 1ª coluna do runKanban — grava o rótulo dela", () => {
    // runKanban resolve placements/órfãos ANTES: aqui o card simplesmente
    // aparece na coluna 1 e o plano grava o rótulo correspondente.
    const data = board([
      { key: "c_a", label: "Novo", cards: [card("r1", "c_a", { fase_vendas: "Sumida" })] },
    ]);
    expect(planAllocationUpdates(data, "fase_vendas")).toEqual([
      { recordId: "r1", value: "Novo" },
    ]);
  });
});

describe("normalizeKanbanAllocationOnSave", () => {
  it("sem chave: passthrough", () => {
    const next = baseSettings({ allocationFieldKey: undefined });
    expect(normalizeKanbanAllocationOnSave(baseSettings(), next)).toEqual({
      kanban: next,
      maintenance: false,
    });
  });

  it("strip ao sair do modo Personalizar", () => {
    const { kanban } = normalizeKanbanAllocationOnSave(
      baseSettings(),
      baseSettings({ columnSource: undefined, groupField: "stage" })
    );
    expect(kanban.allocationFieldKey).toBeUndefined();
  });

  it("strip na troca de base", () => {
    const { kanban, maintenance } = normalizeKanbanAllocationOnSave(
      baseSettings(),
      baseSettings({ source: "deals" })
    );
    expect(kanban.allocationFieldKey).toBeUndefined();
    expect(maintenance).toBe(false);
  });

  it("rename/reorder/hide de coluna visível marca maintenance", () => {
    const prev = baseSettings();
    const renamed = normalizeKanbanAllocationOnSave(
      prev,
      baseSettings({
        columns: [
          { key: "c_a", label: "Entrada" },
          { key: "c_b", label: "Em análise" },
          { key: "c_c", label: "Fechado" },
        ],
      })
    );
    expect(renamed.kanban.allocationFieldKey).toBe("fase_vendas");
    expect(renamed.maintenance).toBe(true);

    const hidden = normalizeKanbanAllocationOnSave(
      prev,
      baseSettings({
        columns: [
          { key: "c_a", label: "Novo" },
          { key: "c_b", label: "Em análise", hidden: true },
          { key: "c_c", label: "Fechado" },
        ],
      })
    );
    expect(hidden.maintenance).toBe(true);
  });

  it("sem mudança de colunas (ex.: só cor/WIP) não marca maintenance", () => {
    const prev = baseSettings();
    const next = baseSettings({
      columns: [
        { key: "c_a", label: "Novo", color: "#f00", wipLimit: 3 },
        { key: "c_b", label: "Em análise" },
        { key: "c_c", label: "Fechado" },
      ],
    });
    expect(normalizeKanbanAllocationOnSave(prev, next).maintenance).toBe(false);
  });

  it("sem estado anterior mantém a chave sem disparar maintenance", () => {
    expect(normalizeKanbanAllocationOnSave(null, baseSettings())).toEqual({
      kanban: baseSettings(),
      maintenance: false,
    });
  });
});

describe("writeAllocationValues (fake-supabase)", () => {
  beforeEach(() => {
    vi.mocked(recalcFormulaFieldsForRecords).mockClear();
  });

  const freshRows = [
    {
      id: "r1",
      custom_fields: { outra: 1 },
      field_modified_at: { outra: "2026-07-01T00:00:00Z" },
      is_mock: false,
    },
    { id: "r2", custom_fields: {}, field_modified_at: null, is_mock: true },
  ];

  function makeDb() {
    return fakeSupabase({
      tables: {
        records: (q) => {
          if (q.steps.some((s) => s.method === "update")) {
            return { data: null, error: null };
          }
          return { data: freshRows, error: null };
        },
      },
    });
  }

  it("grava com carimbos, escopo de org, pula mock e recalca em lote", async () => {
    const fake = makeDb();
    const updated = await writeAllocationValues(fake.db, {
      fieldKey: "fase_vendas",
      orgId: "org1",
      updates: [
        { recordId: "r1", value: "Novo" },
        { recordId: "r2", value: "Novo" }, // mock — não escreve
        { recordId: "r9", value: "Novo" }, // inexistente — não escreve
      ],
    });
    expect(updated).toBe(1);

    const updates = fake.queries.filter(
      (q) => q.table === "records" && q.steps.some((s) => s.method === "update")
    );
    expect(updates).toHaveLength(1);
    expect(hasStep(updates[0], "eq", "id", "r1")).toBe(true);
    expect(hasStep(updates[0], "eq", "organization_id", "org1")).toBe(true);
    const payload = updates[0].steps.find((s) => s.method === "update")!
      .args[0] as {
      custom_fields: Record<string, unknown>;
      field_modified_at: Record<string, string>;
      locally_modified_at: string;
    };
    // Merge fresco: preserva chaves existentes e carimba a nova.
    expect(payload.custom_fields).toEqual({ outra: 1, fase_vendas: "Novo" });
    expect(payload.field_modified_at.outra).toBe("2026-07-01T00:00:00Z");
    expect(typeof payload.field_modified_at.fase_vendas).toBe("string");
    expect(typeof payload.locally_modified_at).toBe("string");

    expect(recalcFormulaFieldsForRecords).toHaveBeenCalledTimes(1);
    expect(recalcFormulaFieldsForRecords).toHaveBeenCalledWith(["r1"]);
  });

  it("deadline estourado não escreve nada", async () => {
    const fake = makeDb();
    const updated = await writeAllocationValues(fake.db, {
      fieldKey: "fase_vendas",
      orgId: "org1",
      updates: [{ recordId: "r1", value: "Novo" }],
      deadline: Date.now() - 1,
    });
    expect(updated).toBe(0);
    expect(fake.queries).toHaveLength(0);
    expect(recalcFormulaFieldsForRecords).not.toHaveBeenCalled();
  });

  it("applyAllocationForSettings traduz targetKey → rótulo (fallback 1ª coluna)", async () => {
    const fake = makeDb();
    await applyAllocationForSettings(fake.db, {
      settings: baseSettings(),
      orgId: "org1",
      moves: [
        { recordId: "r1", targetKey: "c_b" },
        { recordId: "r2", targetKey: "c_sumida" }, // chave órfã → 1ª coluna
      ],
    });
    const updates = fake.queries.filter(
      (q) => q.table === "records" && q.steps.some((s) => s.method === "update")
    );
    expect(updates).toHaveLength(1); // r2 é mock — só r1 escreve
    const payload = updates[0].steps.find((s) => s.method === "update")!
      .args[0] as { custom_fields: Record<string, unknown> };
    expect(payload.custom_fields.fase_vendas).toBe("Em análise");
  });

  it("sem allocationFieldKey é no-op", async () => {
    const fake = makeDb();
    await applyAllocationForSettings(fake.db, {
      settings: baseSettings({ allocationFieldKey: undefined }),
      orgId: "org1",
      moves: [{ recordId: "r1", targetKey: "c_b" }],
    });
    expect(fake.queries).toHaveLength(0);
  });
});
