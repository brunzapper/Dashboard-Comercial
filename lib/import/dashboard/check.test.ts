// Versão: 1.0 | Data: 17/09/2026
// A checagem compartilhada pelo turno de IA e pela colagem de JSON externo.
//
// O que estes testes protegem: a colagem passa pelas MESMAS injeções
// protetivas do turno ao vivo. A mais importante é a reescrita da `chave` —
// um JSON colado que traga a chave de OUTRO board sobrescreveria o board de
// origem se ela atravessasse. Isso nunca foi testado porque, até 17/09/2026,
// a sequência vivia dentro do núcleo server-only da IA.
import { EMPTY_MANUAL_AXIS_CATALOG } from "@/lib/manual-base/families";
import { describe, expect, it } from "vitest";

import { checkDashboardJson } from "@/lib/import/dashboard/check";
import type { DashboardImportContext } from "@/lib/import/dashboard/types";
import { BUILTIN_GOAL_METRICS } from "@/lib/metas/metrics";
import { BUILTIN_SOURCES } from "@/lib/sources";

const importCtx: DashboardImportContext = {
  sources: BUILTIN_SOURCES,
  defs: [],
  correspondenceKeys: [],
  responsibleNames: [],
  operationNames: [],
  goalMetrics: BUILTIN_GOAL_METRICS,
  manualSeries: [],
  manualAxes: EMPTY_MANUAL_AXIS_CATALOG,
};

const doc = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    formato: "dashboard-import",
    versao: 1,
    chave: "veio_do_json",
    bases: ["deals"],
    dashboard: { name: "Teste", visible_to_roles: [], settings: {} },
    widgets: [
      {
        key: "kpi",
        title: "Total",
        visual_type: "kpi",
        sources: ["deals"],
        dimensions: [],
        metrics: [{ field: "*", agg: "count" }],
        filters: [],
        grid_position: { x: 0, y: 0, w: 4, h: 4 },
      },
    ],
    ...over,
  });

describe("checkDashboardJson", () => {
  it("a chave do JSON é SOBRESCRITA pela canônica do servidor", () => {
    const res = checkDashboardJson(
      doc(),
      { chave: "board_real", existingKeys: new Set() },
      importCtx
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // A chave colada não pode sobreviver: ela endereça o board a sobrescrever.
    expect(res.normalized).not.toContain("veio_do_json");
    expect(JSON.parse(res.normalized).chave).toBe("board_real");
  });

  it("resume novo × atualiza pelas keys que já existem", () => {
    const novo = checkDashboardJson(
      doc(),
      { chave: "board_real", existingKeys: new Set() },
      importCtx
    );
    expect(novo.ok && novo.summary).toEqual(["novo: Total"]);

    const atualiza = checkDashboardJson(
      doc(),
      { chave: "board_real", existingKeys: new Set(["kpi"]) },
      importCtx
    );
    expect(atualiza.ok && atualiza.summary).toEqual(["atualiza: Total"]);
  });

  it("JSON inválido devolve os erros do validador, sem normalizado", () => {
    const res = checkDashboardJson(
      doc({ widgets: [{ key: "x", visual_type: "inexistente" }] }),
      { chave: "board_real", existingKeys: new Set() },
      importCtx
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it("texto que não é JSON não explode — vira erro", () => {
    const res = checkDashboardJson(
      "desculpe, não consegui gerar",
      { chave: "board_real", existingKeys: new Set() },
      importCtx
    );
    expect(res.ok).toBe(false);
  });
});
