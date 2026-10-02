// Versão: 1.0 | Data: 02/10/2026
// Seção `mapas` (nós da Tree) do contrato dashboard-import — export, delta por
// nó (linhas do cartão por kind), validação/plano e o caso que motivou tudo:
// "desmarque Realizado em todas as Linhas do cartão".
import { describe, expect, it } from "vitest";

import {
  exportTreeMaps,
  mergeIndicatorRows,
  mergeMapDeltas,
  treeMapKeysOf,
  treeMapSummary,
  validateTreeMaps,
  type TreeMapRow,
} from "./tree-maps";
import { sanitizeTreeSettings } from "./tree-settings";
import { checkDashboardJson } from "./check";
import type { DashboardImportContext, ImportWidgetSpec } from "./types";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";

const rows: TreeMapRow[] = [
  {
    id: U1,
    scope_id: "metas",
    kind: "indicator",
    parent_ref: "-",
    label: "MRR novo",
    body: null,
    status: null,
    is_goal: false,
    due_date: null,
    payload: { indicator: "mrr", childrenOp: "×" },
    preset_key: "mrr_total",
  },
  {
    id: U2,
    scope_id: "metas",
    kind: "indicator",
    parent_ref: `note:${U1}`,
    label: "MRR inbound",
    body: null,
    status: null,
    is_goal: false,
    due_date: null,
    payload: { indicator: "mrr_inbound" },
    preset_key: null,
  },
  {
    id: U3,
    scope_id: "metas",
    kind: "note",
    parent_ref: `note:${U2}`,
    label: "Etapa 1",
    body: "fazer",
    status: "pendente",
    is_goal: false,
    due_date: null,
    payload: null,
    preset_key: null,
  },
];

describe("exportTreeMaps", () => {
  it("keys determinísticas, pai por key, linhas EFETIVAS no indicador", () => {
    const ex = exportTreeMaps(rows, ["metas"]);
    const nodes = ex.mapas[0].nodes;
    expect(nodes.map((n) => n.key)).toEqual(["mrr_total", "n_22222222", "n_33333333"]);
    expect(nodes[1].parentKey).toBe("mrr_total");
    const rowsOut = (nodes[0].payload as { rows: { kind: string; hidden?: boolean }[] }).rows;
    expect(rowsOut.map((r) => r.kind)).toEqual([
      "composicao",
      "meta",
      "realizado",
      "projetado",
      "atingimento",
    ]);
    expect(nodes[2]).toMatchObject({ kind: "note", status: "pendente", body: "fazer" });
    expect(ex.nodeIdByKey.get("metas|n_22222222")).toBe(U2);
  });

  it("treeMapKeysOf só pega Tree no modo livre com mapa", () => {
    expect(
      treeMapKeysOf([
        { visual_type: "tree", settings: { tree: { source: "livre", mapKey: "metas" } } },
        { visual_type: "tree", settings: { tree: { source: "registro" } } },
        { visual_type: "barra", settings: { tree: { source: "livre", mapKey: "x" } } },
      ])
    ).toEqual(["metas"]);
  });
});

describe("delta por nó", () => {
  it("rows mesclam por kind (lista parcial só altera as citadas)", () => {
    const base = [{ kind: "meta" }, { kind: "realizado" }, { kind: "projetado" }];
    expect(mergeIndicatorRows(base, [{ kind: "realizado", hidden: true }])).toEqual([
      { kind: "meta" },
      { kind: "realizado", hidden: true },
      { kind: "projetado" },
    ]);
  });

  it("lista com todos os kinds define a ordem", () => {
    const base = [{ kind: "meta" }, { kind: "realizado" }];
    expect(mergeIndicatorRows(base, [{ kind: "realizado" }, { kind: "meta", label: "Alvo" }])).toEqual([
      { kind: "realizado" },
      { kind: "meta", label: "Alvo" },
    ]);
  });
});

describe("validateTreeMaps — o pedido que motivou a seção", () => {
  const ex = exportTreeMaps(rows, ["metas"]);
  const ctx = { existing: ex.mapas, allowedMapKeys: new Set(["metas"]) };

  it('"desmarcar Realizado" em todos os indicadores vira update de payload', () => {
    const delta = [
      {
        mapKey: "metas",
        nodes: ["mrr_total", "n_22222222"].map((key) => ({
          key,
          payload: { rows: [{ kind: "realizado", hidden: true }] },
        })),
      },
    ];
    const merged = mergeMapDeltas(ex.mapas, delta);
    const v = validateTreeMaps(merged, ctx);
    expect(v.errors).toEqual([]);
    expect(v.plan[0].updates.map((u) => u.key)).toEqual(["mrr_total", "n_22222222"]);
    const p = v.plan[0].updates[0].changes.payload as { rows: { kind: string; hidden?: boolean }[] };
    expect(p.rows.find((r) => r.kind === "realizado")?.hidden).toBe(true);
    expect(p.rows.find((r) => r.kind === "meta")?.hidden).toBeUndefined();
    expect(treeMapSummary(v.plan)).toEqual(["atualiza nó: MRR novo", "atualiza nó: MRR inbound"]);
  });

  it("nó reenviado sem mudança não é update", () => {
    const v = validateTreeMaps(mergeMapDeltas(ex.mapas, [{ mapKey: "metas", nodes: [{ key: "mrr_total" }] }]), ctx);
    expect(v.plan[0].updates).toEqual([]);
    expect(v.plan[0].unchanged).toEqual(["MRR novo"]);
  });

  it("cria nós novos com pais antes dos filhos", () => {
    const v = validateTreeMaps(
      [
        {
          mapKey: "metas",
          nodes: [
            { key: "filho", kind: "note", label: "Filho", parentKey: "pai" },
            { key: "pai", kind: "plan", label: "Plano", parentKey: "mrr_total", payload: { factors: [{ title: "O quê", text: "x" }] } },
          ],
        },
      ],
      ctx
    );
    expect(v.errors).toEqual([]);
    expect(v.plan[0].creates.map((c) => c.key)).toEqual(["pai", "filho"]);
  });

  it("recusa mapa alheio, payload inválido, troca de kind e pai inexistente", () => {
    const v = validateTreeMaps(
      [
        { mapKey: "outro", nodes: [] },
        {
          mapKey: "metas",
          nodes: [
            { key: "novo_ind", kind: "indicator", label: "X", payload: {} },
            { key: "mrr_total", kind: "plan", label: "MRR novo" },
            { key: "solto", kind: "note", label: "S", parentKey: "nao_existe" },
          ],
        },
      ],
      ctx
    );
    expect(v.errors.join(" ")).toContain('"mapKey"');
    expect(v.errors.join(" ")).toContain('"payload" inválido');
    expect(v.errors.join(" ")).toContain("trocar o tipo");
    expect(v.errors.join(" ")).toContain('"parentKey" "nao_existe"');
  });
});

describe("sanitizeTreeSettings", () => {
  it("chave inventada (linhas do cartão no widget) vira aviso + descarte", () => {
    const warnings: string[] = [];
    const out = sanitizeTreeSettings(
      { source: "livre", layout: "livre", mapKey: "metas", rows: [{ kind: "realizado", hidden: true }], showRealized: false },
      { where: "widgets[0]", warnings }
    );
    expect(out).toEqual({ source: "livre", layout: "livre", mapKey: "metas" });
    expect(warnings.join(" ")).toContain('settings.tree.rows');
    expect(warnings.join(" ")).toContain("mapas[].nodes[].payload");
  });

  it("mantém o que é do widget", () => {
    const out = sanitizeTreeSettings(
      {
        source: "livre",
        layout: "livre",
        view: "root",
        rootDirection: "v",
        months: ["2026-11", "2026-10"],
        canvas: { pattern: "linhas", bg: "#ffffff" },
        presentation: { kindBadge: true },
      },
      { where: "w", warnings: [] }
    );
    expect(out).toMatchObject({
      view: "root",
      rootDirection: "v",
      months: ["2026-10", "2026-11"],
      canvas: { pattern: "linhas", bg: "#ffffff" },
      presentation: { kindBadge: true },
    });
  });
});

describe("checkDashboardJson — prévia honesta", () => {
  const importCtx: DashboardImportContext = {
    sources: [
      {
        key: "deals",
        label: "Negócios",
        shortLabel: "Negócios",
        recordType: "deal",
        defaultPeriodField: "closed_at",
      } as unknown as DashboardImportContext["sources"][number],
    ],
    defs: [],
    correspondenceKeys: [],
    responsibleNames: [],
    operationNames: [],
    goalMetrics: [],
    manualSeries: [],
    manualAxes: { families: [], members: [], declarations: [] } as unknown as DashboardImportContext["manualAxes"],
  };
  const base: ImportWidgetSpec = {
    key: "arvore",
    title: "Árvore",
    visual_type: "tree",
    dimensions: [],
    metrics: [],
    filters: [],
    settings: { tree: { source: "livre", layout: "livre", mapKey: "metas" } },
    grid_position: { x: 0, y: 0, w: 6, h: 8 },
  };
  const ex = exportTreeMaps(rows, ["metas"]);
  const ctx = {
    chave: "board_x",
    baseWidgets: [base],
    existingKeys: new Set(["arvore"]),
    baseMaps: ex.mapas,
    boardMapKeys: ["metas"],
  };
  const envelope = (extra: Record<string, unknown>) =>
    JSON.stringify({
      formato: "dashboard-import",
      versao: 1,
      chave: "x",
      bases: ["deals"],
      dashboard: { name: "D" },
      ...extra,
    });

  it("widget reenviado sem mudança sai como 'sem mudança' + aviso", () => {
    const r = checkDashboardJson(envelope({ widgets: [{ key: "arvore" }] }), ctx, importCtx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary).toEqual(["sem mudança: Árvore"]);
    expect(r.changedCount).toBe(0);
    expect(r.warnings.join(" ")).toContain("não altera nada");
  });

  it("só `mapas` (sem widgets) é uma resposta válida e aparece no resumo", () => {
    const r = checkDashboardJson(
      envelope({
        widgets: [],
        mapas: [{ mapKey: "metas", nodes: [{ key: "mrr_total", payload: { rows: [{ kind: "realizado", hidden: true }] } }] }],
      }),
      ctx,
      importCtx
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary).toEqual(["atualiza nó: MRR novo"]);
    expect(r.changedCount).toBe(1);
    expect(r.treeMaps[0].updates).toHaveLength(1);
  });
});
