// Versão: 1.1 | Data: 26/07/2026
// Testes do modo lista com fake PostgREST encadeável: o alvo é o TOP-UP de
// mocks das pernas cobertas (invariante 9) — só busca is_mock=true quando a
// config das pernas referencia Data Reunião E a de exibição NÃO (senão
// duplicaria) — e o merge dedupeById.
// v1.1 (26/07/2026): agrupamento de responsáveis (0101) — filtro expande p/ o
// grupo na query PostgREST, com gate (sem filtro → sem consulta extra).
import { describe, expect, it } from "vitest";

import { MOCK_REUNIAO_KEYS } from "@/lib/widgets/mock-reuniao";
import {
  dedupeById,
  recordListIncludesMocks,
  runCoveredLegMockTopUp,
  runRecordList,
} from "@/lib/widgets/record-list";
import type { WidgetConfig } from "@/lib/widgets/types";
import { fakeSupabase, hasStep } from "@/tests/helpers/fake-supabase";
import { AVAILABLE } from "@/tests/helpers/engine-fixtures";

const REUNIAO = `custom:${MOCK_REUNIAO_KEYS[0]}`;

const displayConfig: WidgetConfig = {
  source: "records",
  sources: ["leads"],
  dimensions: [],
  metrics: [],
  filters: [],
  visual_type: "tabela",
  settings: { rowMode: "records", columns: [{ field: "title" }] },
};

// Config do fetch das pernas cobertas (sem rowMode: a regra dos mocks
// inspeciona filtros + dimensões + MÉTRICAS — as das pernas).
const topUpConfig: WidgetConfig = {
  ...displayConfig,
  metrics: [{ field: REUNIAO, agg: "count" }],
  settings: {},
};

const mockRow = {
  id: "m1",
  record_type: "lead",
  is_mock: true,
  related_lead_id: null,
};

describe("recordListIncludesMocks (regra 0052 no modo lista)", () => {
  it("exibição sem Data Reunião → false; pernas com → true", () => {
    expect(recordListIncludesMocks(displayConfig, null, AVAILABLE)).toBe(false);
    expect(recordListIncludesMocks(topUpConfig, null, AVAILABLE)).toBe(true);
  });
});

describe("runCoveredLegMockTopUp", () => {
  it("busca SÓ is_mock=true quando pernas referenciam e exibição não", async () => {
    const { db, queries } = fakeSupabase({
      tables: {
        records: (q) => {
          // fetchAll pagina até lote vazio: 1º range devolve o mock, 2º nada.
          const ranges = q.steps.filter((s) => s.method === "range").length;
          return { data: ranges <= 1 ? [mockRow] : [], error: null };
        },
        record_matches: [],
      },
    });
    const out = await runCoveredLegMockTopUp(
      db,
      displayConfig,
      topUpConfig,
      null,
      AVAILABLE
    );
    expect(out).toEqual([mockRow]);
    const recordsQuery = queries.find((q) => q.table === "records")!;
    expect(hasStep(recordsQuery, "eq", "is_mock", true)).toBe(true);
  });

  it("gate negativo: exibição JÁ referencia Data Reunião → [] sem consultar", async () => {
    const { db, queries } = fakeSupabase({});
    const display: WidgetConfig = {
      ...displayConfig,
      settings: { rowMode: "records", columns: [{ field: REUNIAO }] },
    };
    expect(
      await runCoveredLegMockTopUp(db, display, topUpConfig, null, AVAILABLE)
    ).toEqual([]);
    expect(queries).toHaveLength(0);
  });

  it("pernas sem Data Reunião ou sem fontes → [] sem consultar", async () => {
    const { db, queries } = fakeSupabase({});
    const plain = {
      ...topUpConfig,
      metrics: [{ field: "*", agg: "count" }],
    } as WidgetConfig;
    expect(
      await runCoveredLegMockTopUp(db, displayConfig, plain, null, AVAILABLE)
    ).toEqual([]);
    expect(
      await runCoveredLegMockTopUp(
        db,
        displayConfig,
        { ...topUpConfig, sources: [] },
        null,
        AVAILABLE
      )
    ).toEqual([]);
    expect(queries).toHaveLength(0);
  });
});

describe("dedupeById", () => {
  it("mescla sem duplicar por id (mock pode vir nos dois fetches)", () => {
    const a = [{ id: "1" }, { id: "2" }] as never[];
    const b = [{ id: "2" }, { id: "3" }] as never[];
    expect(dedupeById(a, b).map((r) => (r as { id: string }).id)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(dedupeById(a, [])).toBe(a);
  });
});

describe("agrupamento de responsáveis (0101) no modo lista", () => {
  it("filtro eq no apelido vira `in` no grupo na query PostgREST", async () => {
    const { db, queries } = fakeSupabase({
      tables: {
        responsibles: [
          { id: "r-main", canonical_id: null },
          { id: "r-alias", canonical_id: "r-main" },
        ],
        records: (q) => {
          // fetchAll pagina até lote vazio.
          const ranges = q.steps.filter((s) => s.method === "range").length;
          return { data: ranges <= 1 ? [] : [], error: null };
        },
        record_matches: [],
      },
    });
    await runRecordList(
      db,
      {
        ...displayConfig,
        filters: [{ field: "responsible_id", op: "eq", value: "r-alias" }],
      },
      null,
      AVAILABLE
    );
    const recordsQuery = queries.find((q) => q.table === "records")!;
    expect(
      hasStep(recordsQuery, "in", "responsible_id", ["r-main", "r-alias"])
    ).toBe(true);
  });

  it("gate: sem filtro de responsável, não consulta responsibles", async () => {
    const { db, queries } = fakeSupabase({
      tables: {
        records: () => ({ data: [], error: null }),
        record_matches: [],
      },
    });
    await runRecordList(db, displayConfig, null, AVAILABLE);
    expect(queries.some((q) => q.table === "responsibles")).toBe(false);
  });
});
