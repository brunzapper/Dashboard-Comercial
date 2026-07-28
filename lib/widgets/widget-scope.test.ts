// Versão: 1.0 | Data: 24/07/2026
// Testes de resolveWidgetViewScope (assembly única do recorte de visualização
// — invariante 12): filtros rápidos persistidos em dashboard_table_cells,
// exceção do vendedor no responsible_id e filtro rápido de período assumindo o
// campo do período geral. O módulo importa getActiveOrgId (via next/headers) —
// mockamos SÓ esse módulo (vi.mock) sem dividir o widget-scope.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/org", () => ({
  getActiveOrgId: async () => null,
}));

import type { SessionInfo } from "@/lib/auth/session";
import { BUILTIN_SOURCES } from "@/lib/sources";
import { resolveWidgetViewScope } from "@/lib/widgets/widget-scope";
import type { Widget } from "@/lib/widgets/types";
import { fakeSupabase } from "@/tests/helpers/fake-supabase";
import { AVAILABLE } from "@/tests/helpers/engine-fixtures";

const session = (permissions: string[]): SessionInfo =>
  ({ user: { id: "u1" }, roles: [], permissions }) as unknown as SessionInfo;

const widget = (settings: Record<string, unknown>): Widget =>
  ({
    id: "w1",
    dashboard_id: "d1",
    title: null,
    visual_type: "tabela",
    source: "records",
    sources: ["deals"],
    dimensions: [],
    metrics: [],
    filters: [],
    settings,
    grid_position: {},
    sort_order: 0,
  }) as unknown as Widget;

const baseArgs = (w: Widget) => ({
  widget: w,
  widgets: [w],
  available: AVAILABLE,
  allFields: [],
  sources: BUILTIN_SOURCES,
  prefSettings: {},
  sp: {},
  resolver: {
    resolveFieldBySource: () => ({}),
    // Mesma regra de effectiveWidgetTab: settings.tab válido, senão a 1ª.
    widgetTab: (x: Widget) => (x.settings?.tab === "t2" ? "t2" : "t1"),
  },
  period: null as never,
});

// Handler de dashboard_table_cells que responde SÓ à linha __qf__ do widget.
const qfCells = (cells: { col_key: string; value: unknown }[]) => ({
  dashboard_table_cells: (q: { steps: { method: string; args: unknown[] }[] }) => {
    const isQf = q.steps.some(
      (s) =>
        s.method === "eq" && s.args[0] === "row_key" && s.args[1] === "__qf__"
    );
    return { data: isQf ? cells : [], error: null };
  },
});

describe("resolveWidgetViewScope", () => {
  it("filtro rápido de opções vira filtro in; período rápido no MESMO campo anula o período geral", async () => {
    const { db } = fakeSupabase({
      tables: qfCells([
        { col_key: "c1", value: { kind: "options", values: ["Vendas"] } },
        {
          col_key: "c2",
          value: { kind: "period", preset: "", de: "2026-07-01", ate: "2026-07-31" },
        },
      ]),
    });
    const w = widget({
      quickFilters: [
        { id: "c1", field: "pipeline" },
        { id: "c2", field: "closed_at" },
      ],
    });
    const out = await resolveWidgetViewScope(db, session(["view_all_records"]), {
      ...baseArgs(w),
      period: { field: "closed_at", from: "2026-01-01", to: "2026-12-31" },
    });

    // O período geral (mesmo campo) foi assumido pelo filtro rápido.
    expect(out.period).toBeNull();
    expect(out.filters).toContainEqual({
      field: "pipeline",
      op: "in",
      value: ["Vendas"],
    });
    // Bounds do filtro rápido de período, ancorados (coluna do núcleo).
    expect(out.filters).toContainEqual({
      field: "closed_at",
      op: "gte",
      value: "2026-07-01T00:00:00-03:00",
    });
    expect(out.filters).toContainEqual({
      field: "closed_at",
      op: "lte",
      value: "2026-07-31T23:59:59-03:00",
    });
  });

  it("exceção do vendedor: seleção que exclui os responsáveis dele vira os dele", async () => {
    const { db } = fakeSupabase({
      tables: {
        ...qfCells([
          { col_key: "c1", value: { kind: "options", values: ["outro-resp"] } },
        ]),
        responsibles: [{ id: "meu-resp" }],
      },
    });
    const w = widget({ quickFilters: [{ id: "c1", field: "responsible_id" }] });
    const out = await resolveWidgetViewScope(db, session([]), baseArgs(w));
    expect(out.filters).toContainEqual({
      field: "responsible_id",
      op: "in",
      value: ["meu-resp"],
    });
  });

  it("sem filtros rápidos: nada consultado, período preservado, settings efetivos", async () => {
    const { db, queries } = fakeSupabase({});
    const w = widget({});
    const period = { field: "closed_at", from: "2026-07-01", to: "2026-07-31" };
    const out = await resolveWidgetViewScope(db, session([]), {
      ...baseArgs(w),
      period,
    });
    expect(out.filters).toEqual([]);
    expect(out.period).toBe(period);
    expect(queries).toHaveLength(0);
  });

  it("filtro_campo com excludedTabs poupa widget de aba desmarcada (e atinge as demais)", async () => {
    const { db } = fakeSupabase({});
    const ffState = encodeURIComponent(
      JSON.stringify({
        q: "",
        filters: [{ field: "pipeline", op: "eq", value: "Enterprise" }],
      })
    );
    const fw = (excludedTabs?: string[]): Widget =>
      ({
        id: "ff1",
        dashboard_id: "d1",
        visual_type: "filtro_campo",
        sources: [],
        settings: { fields: [{ field: "pipeline" }], excludedTabs },
      }) as unknown as Widget;
    const run = (w: Widget, filter: Widget) =>
      resolveWidgetViewScope(db, session([]), {
        ...baseArgs(w),
        widgets: [w, filter],
        sp: { ff_ff1: ffState },
      });

    // Widget na aba desmarcada (t2) não reage ao filtro.
    const out1 = await run(widget({ tab: "t2" }), fw(["t2"]));
    expect(out1.filters).toEqual([]);
    // Widget de outra aba segue atingido.
    const out2 = await run(widget({ tab: "t1" }), fw(["t2"]));
    expect(out2.filters).toContainEqual({
      field: "pipeline",
      op: "eq",
      value: "Enterprise",
    });
    // Chave ausente = comportamento atual (todas as abas).
    const out3 = await run(widget({ tab: "t2" }), fw(undefined));
    expect(out3.filters).toContainEqual({
      field: "pipeline",
      op: "eq",
      value: "Enterprise",
    });
  });
});
