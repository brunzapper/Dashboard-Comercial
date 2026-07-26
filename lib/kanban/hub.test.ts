// Versão: 1.0 | Data: 26/07/2026
// Kanbans de widget na seção Kanbans do hub: mapeamento/ordenação e a defesa
// em profundidade sobre as linhas da query (tudo puro, sem banco).
import { describe, expect, it } from "vitest";

import {
  mapWidgetKanbanRows,
  widgetKanbanHref,
  type WidgetKanbanHubRow,
} from "./hub";

const DASH = {
  id: "d1",
  name: "Comercial",
  kind: "dashboard",
  status: "active",
};

function row(over: Partial<WidgetKanbanHubRow> = {}): WidgetKanbanHubRow {
  return {
    id: "w1",
    title: "Funil",
    dashboard_id: "d1",
    settings: { kanban: { mode: "registros" } },
    dashboards: DASH,
    ...over,
  };
}

describe("widgetKanbanHref", () => {
  it("aponta a página cheia do widget", () => {
    expect(widgetKanbanHref("abc")).toBe("/kanbans/w/abc");
  });
});

describe("mapWidgetKanbanRows", () => {
  it("mapeia linha válida com href e nomes do pai", () => {
    expect(mapWidgetKanbanRows([row()])).toEqual([
      {
        widgetId: "w1",
        label: "Funil",
        dashboardId: "d1",
        dashboardName: "Comercial",
        href: "/kanbans/w/w1",
      },
    ]);
  });

  it("descarta pai ausente, não-dashboard, não-ativo e widget sem config", () => {
    expect(
      mapWidgetKanbanRows([
        row({ dashboards: null }),
        row({ dashboards: { ...DASH, kind: "kanban" } }),
        row({ dashboards: { ...DASH, status: "archived" } }),
        row({ dashboards: { ...DASH, status: "trashed" } }),
        row({ settings: null }),
        row({ settings: {} }),
      ])
    ).toEqual([]);
  });

  it("título vazio/branco ganha fallback", () => {
    const out = mapWidgetKanbanRows([
      row({ title: null }),
      row({ id: "w2", title: "   " }),
    ]);
    expect(out.map((i) => i.label)).toEqual([
      "Kanban (sem título)",
      "Kanban (sem título)",
    ]);
  });

  it("ordena por dashboard e depois por título (pt-BR)", () => {
    const out = mapWidgetKanbanRows([
      row({
        id: "w3",
        title: "Zeta",
        dashboards: { ...DASH, id: "d2", name: "Ágil" },
      }),
      row({ id: "w2", title: "Beta" }),
      row({ id: "w1", title: "Alfa" }),
    ]);
    expect(out.map((i) => [i.dashboardName, i.label])).toEqual([
      ["Ágil", "Zeta"],
      ["Comercial", "Alfa"],
      ["Comercial", "Beta"],
    ]);
  });
});
