// Versão: 1.1 | Data: 10/08/2026
// Testes de resolveWidgetViewScope (assembly única do recorte de visualização
// — invariante 12): filtros rápidos persistidos em dashboard_table_cells,
// exceção do vendedor no responsible_id e filtro rápido de período assumindo o
// campo do período geral. O módulo importa getActiveOrgId (via next/headers) —
// mockamos SÓ esse módulo (vi.mock) sem dividir o widget-scope.
// v1.1 (10/08/2026): takeover do período rápido no MESMO campo agora ASSUME o
// período (period = seleção do filtro rápido, sem bounds pré-sintetizados) —
// a comparação segue funcionando; PERIOD_ALL anula; cruzamento inalterado.
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
  resolver: { resolveFieldBySource: () => ({}) },
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
  it("filtro rápido de opções vira filtro in; período rápido no MESMO campo VIRA o período do widget", async () => {
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

    // Takeover: o filtro rápido ASSUME o período (o engine aplica os bounds
    // por perna; comparação/closedWeek/metas seguem funcionando).
    expect(out.period).toEqual({
      field: "closed_at",
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(out.filters).toContainEqual({
      field: "pipeline",
      op: "in",
      value: ["Vendas"],
    });
    // SEM bounds pré-sintetizados (seria dupla aplicação de @period).
    expect(out.filters.some((f) => f.op === "gte" || f.op === "lte")).toBe(
      false
    );
  });

  it("período rápido em 'todo o período' (PERIOD_ALL) anula o período, sem bounds", async () => {
    const { db } = fakeSupabase({
      tables: qfCells([{ col_key: "c2", value: { kind: "period", preset: "all" } }]),
    });
    const w = widget({ quickFilters: [{ id: "c2", field: "closed_at" }] });
    const out = await resolveWidgetViewScope(db, session(["view_all_records"]), {
      ...baseArgs(w),
      period: { field: "closed_at", from: "2026-01-01", to: "2026-12-31" },
    });

    expect(out.period).toBeNull();
    expect(out.filters).toEqual([]);
  });

  it("cruzamento (campo ≠ período efetivo): período preservado + bounds pré-sintetizados", async () => {
    const { db } = fakeSupabase({
      tables: qfCells([
        {
          col_key: "c2",
          value: { kind: "period", preset: "", de: "2026-07-01", ate: "2026-07-31" },
        },
      ]),
    });
    const w = widget({ quickFilters: [{ id: "c2", field: "opened_at" }] });
    const barPeriod = { field: "closed_at", from: "2026-01-01", to: "2026-12-31" };
    const out = await resolveWidgetViewScope(db, session(["view_all_records"]), {
      ...baseArgs(w),
      available: [
        ...AVAILABLE,
        { field: "opened_at", label: "Criação", isNumeric: false, isDate: true },
      ],
      period: barPeriod,
    });

    // O período geral segue regendo o widget; o campo diferente convive como
    // filtro pré-sintetizado (ancorado — coluna do núcleo).
    expect(out.period).toEqual(barPeriod);
    expect(out.filters).toContainEqual({
      field: "opened_at",
      op: "gte",
      value: "2026-07-01T00:00:00-03:00",
    });
    expect(out.filters).toContainEqual({
      field: "opened_at",
      op: "lte",
      value: "2026-07-31T23:59:59-03:00",
    });
  });

  it("exceção do vendedor: seleção que exclui os responsáveis dele vira os dele", async () => {
    // Ids UUID-shaped (31/07/2026): valor não-UUID em responsible_id agora é
    // NOME (resolveFkFilterNames) — em produção ids são sempre UUID.
    const MEU = "11111111-1111-4111-8111-111111111111";
    const OUTRO = "22222222-2222-4222-8222-222222222222";
    const { db } = fakeSupabase({
      tables: {
        ...qfCells([
          { col_key: "c1", value: { kind: "options", values: [OUTRO] } },
        ]),
        responsibles: [{ id: MEU }],
      },
    });
    const w = widget({ quickFilters: [{ id: "c1", field: "responsible_id" }] });
    const out = await resolveWidgetViewScope(db, session([]), baseArgs(w));
    expect(out.filters).toContainEqual({
      field: "responsible_id",
      op: "in",
      value: [MEU],
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
});
