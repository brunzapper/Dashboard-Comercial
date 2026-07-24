// Versão: 1.0 | Data: 24/07/2026
// Testes do resolver de período efetivo por widget (compartilhado entre a
// page e as actions deferidas — uma única implementação). Precedência da
// barra: URL > preferência salva > config do dashboard > default. Widgets de
// filtro de período sobrescrevem seus alvos (periodSourceByWidget "filter").
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Correspondence } from "@/lib/correspondences";
import { createPeriodResolver } from "@/lib/widgets/period-resolve";
import type { AvailableField } from "@/lib/widgets/fields";
import type { DashboardSettings, Widget } from "@/lib/widgets/types";

const AVAILABLE: AvailableField[] = [
  { field: "closed_at", label: "Fechamento", isNumeric: false, isDate: true },
  {
    field: "source_created_at",
    label: "Criação",
    isNumeric: false,
    isDate: true,
  },
  { field: "custom:data", label: "Data X", isNumeric: false, isDate: true },
  {
    field: "unified:data_venda",
    label: "Data da venda",
    isNumeric: false,
    isDate: true,
    unified: true,
    unifiedMembers: { negocio: "closed_at" },
  },
  { field: "pipeline", label: "Pipeline", isNumeric: false, isDate: false },
];

const CORRS: Correspondence[] = [
  {
    id: "1",
    key: "data_venda",
    label: "Data da venda",
    data_type: "data",
    members: [
      { record_type: "negocio", source_key: "deals", field_ref: "closed_at" },
    ],
  },
];

function resolver(input: {
  sp?: Record<string, string | string[] | undefined>;
  dashSettings?: DashboardSettings;
  prefSettings?: Parameters<typeof createPeriodResolver>[0]["prefSettings"];
}) {
  return createPeriodResolver({
    sp: input.sp ?? {},
    available: AVAILABLE,
    correspondences: CORRS,
    dashSettings: input.dashSettings ?? ({} as DashboardSettings),
    prefSettings: input.prefSettings ?? {},
  });
}

const widget = (id: string, settings?: Record<string, unknown>) =>
  ({ id, settings }) as unknown as Widget;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("resolvePeriodForBucket — precedência", () => {
  const dashSettings = {
    periodBar: { defaultPreset: "ultimos_7" },
  } as DashboardSettings;
  const prefSettings = { lastPeriod: { periodo: "hoje" } };

  it("URL vence preferência salva e config", () => {
    const r = resolver({ sp: { periodo: "este_mes" }, dashSettings, prefSettings });
    expect(r.resolvePeriodForBucket("")).toMatchObject({
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("URL vazia → preferência salva; sem preferência → defaultPreset", () => {
    const r1 = resolver({ dashSettings, prefSettings });
    expect(r1.resolvePeriodForBucket("")).toMatchObject({
      from: "2026-07-15",
      to: "2026-07-15",
    });
    const r2 = resolver({ dashSettings });
    expect(r2.resolvePeriodForBucket("")).toMatchObject({
      from: "2026-07-09",
      to: "2026-07-15",
    });
  });

  it("campo da URL só é aceito se for campo de data válido", () => {
    const ok = resolver({ sp: { periodo: "hoje", campo: "custom:data" } });
    expect(ok.resolvePeriodForBucket("")?.field).toBe("custom:data");
    // Campo inexistente/não-data/match: → cai no default (closed_at).
    for (const campo of ["inexistente", "pipeline", "match:deals:closed_at"]) {
      const r = resolver({ sp: { periodo: "hoje", campo } });
      expect(r.resolvePeriodForBucket("")?.field).toBe("closed_at");
    }
  });

  it("sem campo do usuário, anexa fieldBySource (defaults + config válida)", () => {
    const r = resolver({
      sp: { periodo: "hoje" },
      dashSettings: {
        periodBar: {
          fieldBySource: { estudo: "custom:data", deals: "pipeline" },
        },
      } as DashboardSettings,
    });
    const p = r.resolvePeriodForBucket("");
    // estudo: override válido aplicado; deals: "pipeline" não é data → default.
    expect(p?.fieldBySource).toMatchObject({
      leads: "source_created_at",
      deals: "closed_at",
      estudo: "custom:data",
    });
  });

  it("campo unificado escolhido na URL desdobra por fonte via correspondência", () => {
    const r = resolver({
      sp: { periodo: "hoje", campo: "unified:data_venda" },
    });
    const p = r.resolvePeriodForBucket("");
    expect(p?.field).toBe("unified:data_venda");
    // deals tem membro (closed_at); leads/estudo sem membro → default deles.
    expect(p?.fieldBySource).toMatchObject({
      deals: "closed_at",
      leads: "source_created_at",
      estudo: "source_created_at",
    });
  });
});

describe("escopo por aba", () => {
  const dashSettings = {
    periodBar: { scope: "tab" },
    tabs: [
      { id: "t1", name: "Aba 1" },
      { id: "t2", name: "Aba 2" },
    ],
  } as DashboardSettings;

  it("lê chaves namespaceadas e preferência por aba", () => {
    const r = resolver({
      sp: { periodo__t1: "hoje" },
      dashSettings,
      prefSettings: { lastPeriodByTab: { t2: { periodo: "este_mes" } } },
    });
    expect(r.resolvePeriodForBucket("t1")).toMatchObject({
      from: "2026-07-15",
    });
    expect(r.resolvePeriodForBucket("t2")).toMatchObject({
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("widgetBucket mapeia widget → aba efetiva (aba inválida → primeira)", () => {
    const r = resolver({ dashSettings });
    expect(r.widgetBucket(widget("w1", { tab: "t2" }))).toBe("t2");
    expect(r.widgetBucket(widget("w2", { tab: "tX" }))).toBe("t1");
    expect(r.widgetBucket(widget("w3"))).toBe("t1");
  });
});

describe("computeWidgetPeriods", () => {
  const dataWidgets = [widget("w1"), widget("w2")];

  it("barra desabilitada → período null para todos", () => {
    const r = resolver({
      sp: { periodo: "hoje" },
      dashSettings: { periodBar: { enabled: false } } as DashboardSettings,
    });
    const out = r.computeWidgetPeriods(dataWidgets, []);
    expect(out.periodByWidget).toEqual({ w1: null, w2: null });
  });

  it("widget de filtro sobrescreve SÓ os alvos e marca origem 'filter'", () => {
    const r = resolver({
      sp: { periodo: "este_mes", pf_f1: "hoje" },
    });
    const fw = widget("f1", { field: "custom:data", targets: ["w1"] });
    const out = r.computeWidgetPeriods(dataWidgets, [fw]);
    expect(out.periodByWidget.w1).toMatchObject({
      field: "custom:data",
      from: "2026-07-15",
    });
    expect(out.periodSourceByWidget.w1).toBe("filter");
    expect(out.periodByWidget.w2).toMatchObject({ from: "2026-07-01" });
    expect(out.periodSourceByWidget.w2).toBe("bar");
  });

  it("filtro sem alvos aplica a todos os widgets de dados", () => {
    const r = resolver({ sp: { pf_f1: "hoje" } });
    const fw = widget("f1", { field: "closed_at" });
    const out = r.computeWidgetPeriods(dataWidgets, [fw]);
    expect(out.periodSourceByWidget).toEqual({ w1: "filter", w2: "filter" });
  });

  it("filtro sem seleção e sem defaultPreset → alvo fica sem período", () => {
    const r = resolver({ sp: { periodo: "este_mes" } });
    const fw = widget("f1", { field: "closed_at", targets: ["w1"] });
    const out = r.computeWidgetPeriods(dataWidgets, [fw]);
    expect(out.periodByWidget.w1).toBeNull();
    expect(out.periodSourceByWidget.w1).toBe("filter");
  });
});
