// Versão: 1.0 | Data: 28/07/2026
// Pipeline do kanban (runKanban): fatos das métricas GATEADOS pela config
// (sem métrica nova = nenhuma consulta extra em record_matches), conectados
// com gêmeo related_lead_id, tarefas atrasadas na mesma query do badge, idade
// com média por coluna, falha de consulta → null (nunca 0 enganoso) e
// opts.lean (tick de automações pula badges/conectados).
import { describe, expect, it } from "vitest";

import { BUILTIN_SOURCES } from "@/lib/sources";
import { todayBrasiliaIso } from "@/lib/date/today";
import {
  fakeSupabase,
  type RecordedQuery,
  type TableHandler,
} from "@/tests/helpers/fake-supabase";
import { daysSince } from "./automations/evaluate";
import type { KanbanSettings } from "./types";
import { runKanban } from "./data";

type Row = Record<string, unknown>;

const baseRow = (id: string, recordType: string, over: Row = {}): Row => ({
  id,
  record_type: recordType,
  source_system: "bitrix",
  title: id,
  pipeline: null,
  stage: "novo",
  value: null,
  mrr: null,
  currency: null,
  sale_type: null,
  channel: null,
  closed: false,
  closed_at: null,
  opened_at: null,
  source_created_at: null,
  responsible_id: null,
  operation_id: null,
  related_lead_id: null,
  lead_time_days: null,
  custom_fields: {},
  last_synced_at: null,
  locally_modified_at: null,
  is_mock: false,
  ...over,
});

// Handler de `records` que se comporta como o banco: aplica eq/in e o ÚLTIMO
// .range da cadeia (o fetchAll pagina até o lote vazio — um array fixo
// devolveria tudo em todo lote e nunca terminaria).
const recordsHandler =
  (rows: Row[]): TableHandler =>
  (q: RecordedQuery) => {
    let out = rows;
    for (const s of q.steps) {
      if (s.method === "eq") {
        out = out.filter((r) => r[s.args[0] as string] === s.args[1]);
      }
      if (s.method === "in") {
        const list = s.args[1] as unknown[];
        out = out.filter((r) => list.includes(r[s.args[0] as string]));
      }
    }
    const ranges = q.steps.filter((s) => s.method === "range");
    if (ranges.length > 0) {
      const [from, to] = ranges[ranges.length - 1].args as [number, number];
      out = out.slice(from, to + 1);
    }
    return { data: out, error: null };
  };

const dealsBoard: KanbanSettings = {
  mode: "registros",
  source: "deals",
  groupField: "stage",
};

describe("runKanban — métricas", () => {
  it("config legada: metric soma, badge default de tarefas abertas e SÓ a consulta do attachMatches em record_matches", async () => {
    const { db, queries } = fakeSupabase({
      tables: {
        records: recordsHandler([
          baseRow("d1", "negocio", { value: 100 }),
          baseRow("d2", "negocio", { value: 50 }),
        ]),
        record_matches: [],
        tasks: [{ record_id: "d1", due_date: null }],
      },
    });
    const data = await runKanban(
      db,
      { ...dealsBoard, metric: "value" },
      null,
      [],
      {},
      undefined,
      { catalog: BUILTIN_SOURCES }
    );
    const col = data.columns.find((c) => c.key === "novo")!;
    expect(col.metricSum).toBe(150);
    expect(data.metricLabel).toBe("Valor");
    expect(data.metricIsMoney).toBe(true);
    expect(data.metricAgg).toBe("sum");
    expect(data.metricFormat).toBe("money");
    // Badge default (card.badges ausente) = tarefas abertas de sempre.
    const d1 = col.cards.find((c) => c.id === "d1")!;
    expect(d1.openTasks).toBe(1);
    expect(d1.badges).toEqual([
      { key: "tasks:open", label: "Tarefas abertas", kind: "tasks", value: 1 },
    ]);
    // Sem métrica linked → record_matches só do attachMatches (1 consulta).
    expect(queries.filter((q) => q.table === "record_matches")).toHaveLength(1);
    // A query de tasks agora carrega o prazo (atrasadas na mesma passada).
    const taskQuery = queries.find((q) => q.table === "tasks")!;
    expect(
      taskQuery.steps.some(
        (s) => s.method === "select" && s.args[0] === "record_id, due_date"
      )
    ).toBe(true);
  });

  it("linked: conta record_matches + gêmeo related_lead_id (dedupe), com contagem no cabeçalho e no badge", async () => {
    const { db, queries } = fakeSupabase({
      tables: {
        records: recordsHandler([
          // Quadro de deals; leads são os parceiros contados.
          baseRow("d1", "negocio", { related_lead_id: "l1" }),
          baseRow("d2", "negocio"),
          baseRow("l1", "lead"),
          baseRow("l2", "lead"),
        ]),
        record_matches: [
          { record_a_id: "d1", record_b_id: "l2" },
          // Match REAL do mesmo par do gêmeo — deduplica (conta 1).
          { record_a_id: "l1", record_b_id: "d1" },
        ],
        tasks: [],
      },
    });
    const data = await runKanban(
      db,
      {
        ...dealsBoard,
        columnMetric: { spec: { kind: "linked", source: "leads" } },
        card: { badges: [{ kind: "linked", source: "leads" }] },
      },
      null,
      [],
      {},
      undefined,
      { catalog: BUILTIN_SOURCES }
    );
    const col = data.columns.find((c) => c.key === "novo")!;
    const d1 = col.cards.find((c) => c.id === "d1")!;
    const d2 = col.cards.find((c) => c.id === "d2")!;
    expect(d1.metricValue).toBe(2); // l2 (match) + l1 (gêmeo, dedupado)
    expect(d2.metricValue).toBe(0);
    expect(col.metricSum).toBe(2);
    expect(data.metricLabel).toBe("Leads vinculados");
    expect(data.metricFormat).toBe("number");
    expect(d1.badges).toEqual([
      {
        key: "linked:leads",
        label: "Leads vinculados",
        kind: "linked",
        value: 2,
      },
    ]);
    // Cabeçalho e badge da MESMA base compartilham a consulta (attachMatches
    // + countRelatedBySource = 2 consultas em record_matches, não 3).
    expect(queries.filter((q) => q.table === "record_matches")).toHaveLength(2);
  });

  it("tarefas atrasadas e idade (média por coluna, formato days)", async () => {
    const today = todayBrasiliaIso();
    const age1 = daysSince("2026-01-01", today)!;
    const { db } = fakeSupabase({
      tables: {
        records: recordsHandler([
          baseRow("d1", "negocio", { opened_at: "2026-01-01T09:00:00-03:00" }),
          baseRow("d2", "negocio", { source_created_at: today }),
        ]),
        record_matches: [],
        tasks: [
          { record_id: "d1", due_date: "2000-01-01" },
          { record_id: "d1", due_date: "2999-01-01" },
          { record_id: "d1", due_date: null },
        ],
      },
    });
    const data = await runKanban(
      db,
      {
        ...dealsBoard,
        columnMetric: { spec: { kind: "age" } },
        card: {
          badges: [{ kind: "tasks", metric: "overdue" }, { kind: "age" }],
        },
      },
      null,
      [],
      {},
      undefined,
      { catalog: BUILTIN_SOURCES }
    );
    const col = data.columns.find((c) => c.key === "novo")!;
    const d1 = col.cards.find((c) => c.id === "d1")!;
    const d2 = col.cards.find((c) => c.id === "d2")!;
    // d1: 3 abertas, 1 atrasada (prazo no passado); idade pela abertura.
    expect(d1.openTasks).toBe(3);
    expect(d1.badges).toEqual([
      {
        key: "tasks:overdue",
        label: "Tarefas atrasadas",
        kind: "tasks",
        value: 1,
      },
      { key: "age", label: "Idade (dias)", kind: "age", value: age1 },
    ]);
    // d2: idade 0 (criado hoje, fallback source_created_at).
    expect(d2.badges?.[1]?.value).toBe(0);
    // Cabeçalho: idade média (default avg, sem sufixo de agregação).
    expect(col.metricSum).toBe(age1 / 2);
    expect(data.metricAgg).toBe("avg");
    expect(data.metricFormat).toBe("days");
    expect(data.metricLabel).toBe("Idade (dias)");
  });

  it("agregação escolhida ≠ default ganha sufixo no rótulo", async () => {
    const { db } = fakeSupabase({
      tables: {
        records: recordsHandler([
          baseRow("d1", "negocio", { value: 10 }),
          baseRow("d2", "negocio", { value: 30 }),
        ]),
        record_matches: [],
        tasks: [],
      },
    });
    const data = await runKanban(
      db,
      {
        ...dealsBoard,
        columnMetric: { spec: { kind: "field", ref: "value" }, agg: "avg" },
        card: { badges: [] },
      },
      null,
      [],
      {},
      undefined,
      { catalog: BUILTIN_SOURCES }
    );
    const col = data.columns.find((c) => c.key === "novo")!;
    expect(col.metricSum).toBe(20);
    expect(data.metricLabel).toBe("Valor — Média");
    expect(data.metricFormat).toBe("money");
    expect(col.cards[0]?.badges).toEqual([]); // [] explícito = sem badges
  });

  it("falha de consulta → null (badge oculto e cabeçalho sem 0 enganoso)", async () => {
    // record_matches responde ao attachMatches e LANÇA no countRelated (2ª
    // chamada) — simula adapter/tabela indisponível. `tasks` sem handler
    // lança sempre (fail-closed do snapshot).
    let rmCalls = 0;
    const { db } = fakeSupabase({
      tables: {
        records: recordsHandler([baseRow("d1", "negocio")]),
        record_matches: () => {
          rmCalls += 1;
          if (rmCalls > 1) throw new Error("indisponível");
          return { data: [], error: null };
        },
      },
    });
    const data = await runKanban(
      db,
      {
        ...dealsBoard,
        columnMetric: { spec: { kind: "linked", source: "leads" } },
        card: {
          badges: [
            { kind: "linked", source: "leads" },
            { kind: "tasks", metric: "open" },
          ],
        },
      },
      null,
      [],
      {},
      undefined,
      { catalog: BUILTIN_SOURCES }
    );
    const col = data.columns.find((c) => c.key === "novo")!;
    const d1 = col.cards[0]!;
    expect(d1.badges).toEqual([
      { key: "linked:leads", label: "Leads vinculados", kind: "linked", value: null },
      { key: "tasks:open", label: "Tarefas abertas", kind: "tasks", value: null },
    ]);
    expect(col.metricSum).toBeNull();
    expect(d1.openTasks).toBe(0); // legado: falha de tasks = 0, quadro segue
  });

  it("lean pula conectados e badges (tick de automações)", async () => {
    const { db, queries } = fakeSupabase({
      tables: {
        records: recordsHandler([baseRow("d1", "negocio")]),
        record_matches: [],
        tasks: [{ record_id: "d1", due_date: null }],
      },
    });
    const data = await runKanban(
      db,
      {
        ...dealsBoard,
        columnMetric: { spec: { kind: "linked", source: "leads" } },
        card: { badges: [{ kind: "linked", source: "leads" }] },
      },
      null,
      [],
      {},
      undefined,
      { catalog: BUILTIN_SOURCES, lean: true }
    );
    // Nenhuma consulta de conectados (só o attachMatches do modo lista).
    expect(queries.filter((q) => q.table === "record_matches")).toHaveLength(1);
    const col = data.columns.find((c) => c.key === "novo")!;
    expect(col.metricSum).toBeNull();
    expect(col.cards[0]?.badges).toEqual([]);
    expect(col.cards[0]?.openTasks).toBe(1); // automações seguem lendo
  });
});
