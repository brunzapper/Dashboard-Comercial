// Versão: 1.0 | Data: 31/07/2026
// Guarda dos filtros de relação POR NOME no validador de import (31/07/2026):
// responsible_id/operation_id aceitam o nome exato do cadastro (o engine
// resolve nome→id→grupo canônico em runtime — resolveFkFilterNames); nome
// inexistente é ERRO amigável (senão viraria resultado vazio silencioso);
// UUID legado passa. Recorte de SUB-BASE compara a coluna crua — nome lá é
// erro dedicado. Puro (sem banco): contexto sintético sobre BUILTIN_SOURCES.
import { describe, expect, it } from "vitest";

import { BUILTIN_GOAL_METRICS } from "@/lib/metas/metrics";
import { BUILTIN_SOURCES } from "@/lib/sources";
import type { DashboardImportContext } from "./types";
import { validateDashboardImport } from "./validate";

const RESP_UUID = "11111111-1111-4111-8111-111111111111";

const ctx: DashboardImportContext = {
  sources: BUILTIN_SOURCES,
  defs: [],
  correspondenceKeys: [],
  responsibleNames: ["Maria Silva", "João Souza"],
  operationNames: ["Comercial", "Parcerias"],
  goalMetrics: BUILTIN_GOAL_METRICS,
};

function docWith(over: {
  filters?: unknown[];
  subSources?: unknown[];
}): string {
  return JSON.stringify({
    formato: "dashboard-import",
    versao: 1,
    chave: "teste_fk",
    bases: ["deals"],
    dashboard: { name: "Teste", visible_to_roles: [], settings: {} },
    subSources: over.subSources ?? [],
    widgets: [
      {
        key: "kpi",
        title: "KPI",
        visual_type: "kpi",
        sources: ["deals"],
        dimensions: [],
        metrics: [{ field: "*", agg: "count" }],
        filters: over.filters ?? [],
        grid_position: { x: 0, y: 0, w: 4, h: 4 },
      },
    ],
  });
}

describe("filtros de widget sobre relações — nomes validados", () => {
  it("nome cadastrado passa (case-insensitive)", () => {
    const res = validateDashboardImport(
      docWith({
        filters: [
          { field: "responsible_id", op: "eq", value: "maria silva" },
          { field: "operation_id", op: "eq", value: "Comercial" },
        ],
      }),
      ctx
    );
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("nome desconhecido é erro amigável", () => {
    const res = validateDashboardImport(
      docWith({
        filters: [{ field: "responsible_id", op: "eq", value: "Fulano" }],
      }),
      ctx
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toContain(
      'não encontrei o responsável "Fulano"'
    );
  });

  it("operação desconhecida é erro amigável", () => {
    const res = validateDashboardImport(
      docWith({
        filters: [{ field: "operation_id", op: "eq", value: "Inexistente" }],
      }),
      ctx
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toContain(
      'não encontrei a operação "Inexistente"'
    );
  });

  it("array de `in` valida POR ELEMENTO (só o desconhecido erra)", () => {
    const res = validateDashboardImport(
      docWith({
        filters: [
          {
            field: "responsible_id",
            op: "in",
            value: ["Maria Silva", "Desconhecida"],
          },
        ],
      }),
      ctx
    );
    expect(res.ok).toBe(false);
    const joined = res.errors.join("\n");
    expect(joined).toContain('não encontrei o responsável "Desconhecida"');
    expect(joined).not.toContain("Maria Silva");
  });

  it("UUID legado passa sem consulta a nomes", () => {
    const res = validateDashboardImport(
      docWith({
        filters: [{ field: "responsible_id", op: "eq", value: RESP_UUID }],
      }),
      { ...ctx, responsibleNames: [] }
    );
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("campo que não é relação segue livre (nenhuma validação de nome)", () => {
    const res = validateDashboardImport(
      docWith({
        filters: [{ field: "stage", op: "eq", value: "Qualquer Etapa" }],
      }),
      ctx
    );
    expect(res.errors).toEqual([]);
  });
});

describe("recorte de sub-base — relação exige UUID", () => {
  const sub = (value: unknown) => ({
    key: "meus_deals",
    parent_key: "deals",
    label: "Meus deals",
    default_period_field: "closed_at",
    filter: [{ field: "responsible_id", op: "eq", value }],
  });

  it("nome em campo de relação é erro dedicado", () => {
    const res = validateDashboardImport(
      docWith({ subSources: [sub("Maria Silva")] }),
      ctx
    );
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toContain(
      "o recorte de Sub-base compara o id interno (UUID)"
    );
  });

  it("UUID em campo de relação passa", () => {
    const res = validateDashboardImport(
      docWith({ subSources: [sub(RESP_UUID)] }),
      ctx
    );
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });
});

describe("Semana Fechada (dimensions[].closedWeek)", () => {
  function docWithDim(dim: Record<string, unknown>): string {
    return JSON.stringify({
      formato: "dashboard-import",
      versao: 1,
      chave: "teste_cw",
      bases: ["deals"],
      dashboard: { name: "Teste", visible_to_roles: [], settings: {} },
      widgets: [
        {
          key: "w1",
          title: "Semanal",
          visual_type: "barra",
          sources: ["deals"],
          dimensions: [dim],
          metrics: [{ field: "*", agg: "count" }],
          filters: [],
          grid_position: { x: 0, y: 0, w: 6, h: 8 },
        },
      ],
    });
  }

  it("closedWeek válido em transform de semana faz round-trip", () => {
    const res = validateDashboardImport(
      docWithDim({
        field: "closed_at",
        transform: "week_month",
        closedWeek: "seg_dom",
      }),
      ctx
    );
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.preset?.widgets[0].dimensions?.[0]).toMatchObject({
      field: "closed_at",
      transform: "week_month",
      closedWeek: "seg_dom",
    });
  });

  it("closedWeek com transform não-semanal é removido com aviso", () => {
    const res = validateDashboardImport(
      docWithDim({
        field: "closed_at",
        transform: "month_year",
        closedWeek: "sab_sex",
      }),
      ctx
    );
    expect(res.ok).toBe(true);
    expect(res.warnings.join("\n")).toContain('"closedWeek" removido');
    expect(res.preset?.widgets[0].dimensions?.[0].closedWeek).toBeUndefined();
  });

  it("valor fora do enum é descartado em silêncio", () => {
    const res = validateDashboardImport(
      docWithDim({
        field: "closed_at",
        transform: "week_year",
        closedWeek: "dom_seg",
      }),
      ctx
    );
    expect(res.ok).toBe(true);
    expect(res.preset?.widgets[0].dimensions?.[0].closedWeek).toBeUndefined();
  });
});
