// Versão: 1.0 | Data: 28/07/2026
// Métricas do kanban (lib/kanban/metrics.ts): normalização canônica do legado
// (metric string → columnMetric soma; badges ausente → badge de tarefas
// abertas), sanitização de jsonb quebrado, roundtrip encode/parse, agregação
// por coluna e idade do registro (prefixo YYYY-MM-DD, dia de Brasília).
import { describe, expect, it } from "vitest";

import { BUILTIN_SOURCES } from "@/lib/sources";
import type { KanbanSettings } from "./types";
import {
  aggregateMetric,
  defaultAggFor,
  encodeMetricSpec,
  kanbanMetricOptions,
  linkedMetricLabel,
  metricSpecLabel,
  normalizeKanbanMetrics,
  parseMetricSpec,
  recordAgeDays,
  sanitizeMetricSpec,
} from "./metrics";

const base: KanbanSettings = { mode: "registros", source: "deals" };

describe("normalizeKanbanMetrics", () => {
  it("legado: metric string vira columnMetric de soma; badges ausente vira tarefas abertas", () => {
    const n = normalizeKanbanMetrics({ ...base, metric: "value" });
    expect(n.columnMetric).toEqual({
      spec: { kind: "field", ref: "value" },
      agg: "sum",
    });
    expect(n.badges).toEqual([{ kind: "tasks", metric: "open" }]);
  });

  it("sem métrica nenhuma → columnMetric null", () => {
    expect(normalizeKanbanMetrics(base).columnMetric).toBeNull();
  });

  it("columnMetric vence o metric legado", () => {
    const n = normalizeKanbanMetrics({
      ...base,
      metric: "value",
      columnMetric: { spec: { kind: "linked", source: "leads" } },
    });
    expect(n.columnMetric?.spec).toEqual({ kind: "linked", source: "leads" });
    // Agregação ausente = default do kind.
    expect(n.columnMetric?.agg).toBe("sum");
  });

  it("badges [] explícito vence o default (sem badges)", () => {
    const n = normalizeKanbanMetrics({ ...base, card: { badges: [] } });
    expect(n.badges).toEqual([]);
  });

  it("badges: sanitiza shapes quebrados e corta no teto de 3", () => {
    const n = normalizeKanbanMetrics({
      ...base,
      card: {
        badges: [
          { kind: "age" },
          { kind: "nope" } as never,
          { kind: "linked", source: "" } as never,
          { kind: "tasks", metric: "overdue" },
          { kind: "linked", source: "leads" },
          { kind: "field", ref: "mrr" },
        ],
      },
    });
    expect(n.badges).toEqual([
      { kind: "age" },
      { kind: "tasks", metric: "overdue" },
      { kind: "linked", source: "leads" },
    ]);
  });

  it("columnMetric com spec quebrado cai no legado", () => {
    const n = normalizeKanbanMetrics({
      ...base,
      metric: "mrr",
      columnMetric: { spec: { kind: "field", ref: "" } as never },
    });
    expect(n.columnMetric).toEqual({
      spec: { kind: "field", ref: "mrr" },
      agg: "sum",
    });
  });

  it("age default = média; agg inválida cai no default", () => {
    expect(defaultAggFor({ kind: "age" })).toBe("avg");
    const n = normalizeKanbanMetrics({
      ...base,
      columnMetric: { spec: { kind: "age" }, agg: "mediana" as never },
    });
    expect(n.columnMetric?.agg).toBe("avg");
  });
});

describe("sanitizeMetricSpec", () => {
  it("aceita os 4 kinds válidos e rejeita o resto", () => {
    expect(sanitizeMetricSpec({ kind: "field", ref: "value" })).toEqual({
      kind: "field",
      ref: "value",
    });
    expect(sanitizeMetricSpec({ kind: "age", extra: 1 })).toEqual({
      kind: "age",
    });
    expect(sanitizeMetricSpec({ kind: "tasks", metric: "fechada" })).toBeNull();
    expect(sanitizeMetricSpec("age")).toBeNull();
    expect(sanitizeMetricSpec(null)).toBeNull();
  });
});

describe("encode/parseMetricSpec", () => {
  it("roundtrip dos 4 kinds", () => {
    const specs = [
      { kind: "field", ref: "custom:receita" },
      { kind: "linked", source: "leads" },
      { kind: "tasks", metric: "overdue" },
      { kind: "age" },
    ] as const;
    for (const s of specs) {
      expect(parseMetricSpec(encodeMetricSpec(s))).toEqual(s);
    }
  });

  it("strings desconhecidas → null", () => {
    expect(parseMetricSpec("")).toBeNull();
    expect(parseMetricSpec("field:")).toBeNull();
    expect(parseMetricSpec("linked:")).toBeNull();
    expect(parseMetricSpec("tasks:concluida")).toBeNull();
    expect(parseMetricSpec("value")).toBeNull();
  });
});

describe("aggregateMetric", () => {
  it("sum/count definidos p/ vazio; avg/min/max → null; null não conta", () => {
    expect(aggregateMetric([], "sum")).toBe(0);
    expect(aggregateMetric([], "count")).toBe(0);
    expect(aggregateMetric([], "avg")).toBeNull();
    expect(aggregateMetric([], "min")).toBeNull();
    expect(aggregateMetric([], "max")).toBeNull();

    const vals = [10, null, 20, null, 30];
    expect(aggregateMetric(vals, "sum")).toBe(60);
    expect(aggregateMetric(vals, "count")).toBe(3);
    expect(aggregateMetric(vals, "avg")).toBe(20);
    expect(aggregateMetric(vals, "min")).toBe(10);
    expect(aggregateMetric(vals, "max")).toBe(30);
  });
});

describe("recordAgeDays", () => {
  it("abertura; fallback criação na origem; sem data → null", () => {
    expect(
      recordAgeDays(
        { opened_at: "2026-07-20T10:00:00-03:00", source_created_at: null },
        "2026-07-28"
      )
    ).toBe(8);
    expect(
      recordAgeDays(
        { opened_at: null, source_created_at: "2026-07-27" },
        "2026-07-28"
      )
    ).toBe(1);
    expect(
      recordAgeDays({ opened_at: null, source_created_at: null }, "2026-07-28")
    ).toBeNull();
  });
});

describe("rótulos e opções", () => {
  it("linkedMetricLabel usa o shortLabel da base ('Leads vinculados')", () => {
    expect(linkedMetricLabel("leads", BUILTIN_SOURCES)).toBe(
      "Leads vinculados"
    );
    // Fora do catálogo: cai na própria key.
    expect(linkedMetricLabel("parceiros", [])).toBe("parceiros vinculados");
  });

  it("metricSpecLabel cobre os 4 kinds", () => {
    expect(
      metricSpecLabel({ kind: "linked", source: "deals" }, [], BUILTIN_SOURCES)
    ).toBe("Deals vinculados");
    expect(
      metricSpecLabel({ kind: "tasks", metric: "open" }, [], [])
    ).toBe("Tarefas abertas");
    expect(
      metricSpecLabel({ kind: "tasks", metric: "overdue" }, [], [])
    ).toBe("Tarefas atrasadas");
    expect(metricSpecLabel({ kind: "age" }, [], [])).toBe("Idade (dias)");
  });

  it("kanbanMetricOptions: indicadores só de bases RAIZ + campos numéricos", () => {
    const catalog = [
      ...BUILTIN_SOURCES,
      {
        key: "leads_mql",
        recordType: "lead",
        label: "Leads MQL",
        shortLabel: "MQL",
        defaultPeriodField: "source_created_at",
        builtin: false,
        manualEntry: false,
        parentKey: "leads",
      },
    ];
    const { indicators, fields } = kanbanMetricOptions([], "deals", catalog);
    const values = indicators.map((o) => o.value);
    expect(values).toContain("linked:leads");
    expect(values).not.toContain("linked:leads_mql"); // sub nunca casa
    expect(values).toContain("tasks:open");
    expect(values).toContain("tasks:overdue");
    expect(values).toContain("age");
    expect(fields.map((o) => o.value)).toEqual([
      "field:value",
      "field:mrr",
    ]);
  });
});
