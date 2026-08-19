// Versão: 1.1 | Data: 19/08/2026
// Testes do resolver de período efetivo por widget (compartilhado entre a
// page e as actions deferidas — uma única implementação). Precedência da
// barra: URL > preferência salva > config do dashboard > default. Widgets de
// filtro de período sobrescrevem seus alvos (periodSourceByWidget "filter").
// v1.1: overrides POR ABA (periodBar.byTab) e a nova semântica da barra
// OCULTA — fixa o padrão do bucket, ignorando URL e preferência.
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

describe("periodBar.byTab — padrão/campo/visibilidade por aba", () => {
  const tabs = [
    { id: "t1", name: "Aba 1" },
    { id: "t2", name: "Aba 2" },
  ];
  const withBar = (bar: Record<string, unknown>) =>
    ({ periodBar: { scope: "tab", ...bar }, tabs }) as DashboardSettings;

  it("aba sem override herda o padrão e o campo globais", () => {
    const r = resolver({
      dashSettings: withBar({
        defaultPreset: "este_mes",
        field: "custom:data",
        byTab: { t2: { defaultPreset: "este_ano" } },
      }),
    });
    expect(r.resolvePeriodForBucket("t1")).toMatchObject({
      field: "custom:data",
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(r.resolvePeriodForBucket("t2")).toMatchObject({
      field: "custom:data",
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("sub-chave ausente no override herda a global (não zera)", () => {
    const r = resolver({
      dashSettings: withBar({
        defaultPreset: "este_mes",
        field: "custom:data",
        byTab: { t2: { field: "source_created_at" } },
      }),
    });
    // t2 troca só o campo; o preset segue o global.
    expect(r.resolvePeriodForBucket("t2")).toMatchObject({
      field: "source_created_at",
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("escopo GLOBAL ignora byTab por completo", () => {
    const r = resolver({
      dashSettings: {
        periodBar: {
          scope: "global",
          defaultPreset: "este_mes",
          byTab: { t1: { defaultPreset: "este_ano" } },
        },
        tabs,
      } as DashboardSettings,
    });
    expect(r.resolvePeriodForBucket("")).toMatchObject({
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("URL e preferência da aba ainda vencem o padrão dela (barra visível)", () => {
    const r = resolver({
      sp: { periodo__t1: "hoje" },
      dashSettings: withBar({
        byTab: {
          t1: { defaultPreset: "este_mes" },
          t2: { defaultPreset: "este_mes" },
        },
      }),
      prefSettings: { lastPeriodByTab: { t2: { periodo: "este_ano" } } },
    });
    expect(r.resolvePeriodForBucket("t1")).toMatchObject({ from: "2026-07-15" });
    expect(r.resolvePeriodForBucket("t2")).toMatchObject({
      from: "2026-01-01",
    });
  });

  it("barra oculta em UMA aba: fixa o padrão dela e não afeta a outra", () => {
    const r = resolver({
      sp: { periodo__t1: "hoje", periodo__t2: "hoje" },
      dashSettings: withBar({
        defaultPreset: "este_mes",
        byTab: { t2: { enabled: false, defaultPreset: "este_ano" } },
      }),
      prefSettings: { lastPeriodByTab: { t2: { periodo: "mes_passado" } } },
    });
    const out = r.computeWidgetPeriods(
      [widget("w1", { tab: "t1" }), widget("w2", { tab: "t2" })],
      []
    );
    // t1 segue com a barra: a URL vence.
    expect(out.periodByWidget.w1).toMatchObject({ from: "2026-07-15" });
    // t2 está oculta: padrão da aba, ignorando URL e preferência.
    expect(out.periodByWidget.w2).toMatchObject({
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("effectiveBar expõe a config resolvida do bucket", () => {
    const r = resolver({
      dashSettings: withBar({
        defaultPreset: "este_mes",
        field: "closed_at",
        byTab: { t2: { enabled: false, defaultPreset: "este_ano" } },
      }),
    });
    expect(r.effectiveBar("t1")).toMatchObject({
      defaultPreset: "este_mes",
      field: "closed_at",
    });
    expect(r.effectiveBar("t2")).toMatchObject({
      enabled: false,
      defaultPreset: "este_ano",
      field: "closed_at",
    });
  });
});

describe("computeWidgetPeriods", () => {
  const dataWidgets = [widget("w1"), widget("w2")];

  it("barra oculta SEM padrão → período null para todos", () => {
    const r = resolver({
      sp: { periodo: "hoje" },
      dashSettings: { periodBar: { enabled: false } } as DashboardSettings,
    });
    const out = r.computeWidgetPeriods(dataWidgets, []);
    expect(out.periodByWidget).toEqual({ w1: null, w2: null });
  });

  it("barra oculta COM padrão → fixa o padrão, ignorando URL e preferência", () => {
    const r = resolver({
      sp: { periodo: "hoje", campo: "custom:data" },
      dashSettings: {
        periodBar: { enabled: false, defaultPreset: "este_mes" },
      } as DashboardSettings,
      prefSettings: { lastPeriod: { periodo: "ano_passado" } },
    });
    const out = r.computeWidgetPeriods(dataWidgets, []);
    expect(out.periodByWidget.w1).toMatchObject({
      field: "closed_at",
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(out.periodByWidget.w2).toMatchObject({ from: "2026-07-01" });
    // Segue sendo a barra que rege (o espelho do filtro rápido depende disso).
    expect(out.periodSourceByWidget.w1).toBe("bar");
  });

  it('barra oculta com defaultPreset "all" → todo o período', () => {
    const r = resolver({
      sp: { periodo: "hoje" },
      dashSettings: {
        periodBar: { enabled: false, defaultPreset: "all" },
      } as DashboardSettings,
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

  it("excludedTargets é dinâmico: atinge todos menos os excluídos (widget novo entra)", () => {
    const r = resolver({ sp: { periodo: "este_mes", pf_f1: "hoje" } });
    const fw = widget("f1", { field: "closed_at", excludedTargets: ["w2"] });
    // w3 "nasceu" depois do save do filtro e mesmo assim é atingido.
    const out = r.computeWidgetPeriods([...dataWidgets, widget("w3")], [fw]);
    expect(out.periodSourceByWidget).toEqual({
      w1: "filter",
      w2: "bar",
      w3: "filter",
    });
  });

  it("excludedTargets presente vence a whitelist legada `targets`", () => {
    const r = resolver({ sp: { periodo: "este_mes", pf_f1: "hoje" } });
    const fw = widget("f1", {
      field: "closed_at",
      targets: ["w1"],
      excludedTargets: [],
    });
    const out = r.computeWidgetPeriods(dataWidgets, [fw]);
    expect(out.periodSourceByWidget).toEqual({ w1: "filter", w2: "filter" });
  });

  it("id excluído inexistente é inofensivo", () => {
    const r = resolver({ sp: { pf_f1: "hoje" } });
    const fw = widget("f1", { field: "closed_at", excludedTargets: ["morto"] });
    const out = r.computeWidgetPeriods(dataWidgets, [fw]);
    expect(out.periodSourceByWidget).toEqual({ w1: "filter", w2: "filter" });
  });
});
