// Versão: 1.2 | Data: 30/07/2026
// v1.2: refWidgets (mescla multi-referência do "Criar a partir de") — origem
//   de copy_of SEM entrar no merge por key nem no bottomByTab; fallback de
//   empilhamento na PRIMEIRA aba do JSON para cópia de ref sem aba própria.
// Testes da normalização do JSON bruto da IA — o ponto central da segurança de
// identidade da conversa: a `chave` NUNCA é confiada à IA (uma chave copiada
// da referência sobrescreveria o board de ORIGEM no "Criar a partir de").
// Também cobre as injeções do modo Editar cuja ausência seria destrutiva
// (visible_to_roles ausente = des-compartilhar; tabs ausente = widgets sem aba).
// v1.1: merge por widget (baseWidgets) + cópia por referência (`copy_of`).
import { describe, expect, it } from "vitest";

import { normalizeImportRaw } from "@/lib/import/dashboard/rewrite";
import type { ImportWidgetSpec } from "@/lib/import/dashboard/types";

const OPTS = { chave: "canonica-123" };

describe("normalizeImportRaw", () => {
  it("JSON inválido ou não-objeto → devolve o raw INALTERADO", () => {
    expect(normalizeImportRaw("{{{lixo", OPTS)).toBe("{{{lixo");
    expect(normalizeImportRaw("[1,2]", OPTS)).toBe("[1,2]");
    expect(normalizeImportRaw('"texto"', OPTS)).toBe('"texto"');
  });

  it("a chave da IA é SEMPRE sobrescrita pela canônica", () => {
    const out = JSON.parse(
      normalizeImportRaw(JSON.stringify({ chave: "roubada", dashboard: {} }), OPTS)
    );
    expect(out.chave).toBe("canonica-123");
    // Mesmo quando a IA omite a chave.
    expect(JSON.parse(normalizeImportRaw("{}", OPTS)).chave).toBe(
      "canonica-123"
    );
  });

  it("aceita envelope em code fence (```json ... ```)", () => {
    const raw = "```json\n" + JSON.stringify({ chave: "x" }) + "\n```";
    expect(JSON.parse(normalizeImportRaw(raw, OPTS)).chave).toBe("canonica-123");
  });

  it("visible_to_roles: injeta SÓ quando ausente e há currentRoles", () => {
    const roles = ["vendas"];
    const inject = JSON.parse(
      normalizeImportRaw(JSON.stringify({ dashboard: { name: "X" } }), {
        ...OPTS,
        currentRoles: roles,
      })
    );
    expect(inject.dashboard.visible_to_roles).toEqual(roles);
    const keep = JSON.parse(
      normalizeImportRaw(
        JSON.stringify({ dashboard: { visible_to_roles: [] } }),
        { ...OPTS, currentRoles: roles }
      )
    );
    // Presente (mesmo vazio = des-compartilhar EXPLÍCITO) → intocado.
    expect(keep.dashboard.visible_to_roles).toEqual([]);
  });

  it("settings.tabs: injeta quando ausente/vazio, cria settings se preciso", () => {
    const tabs = [{ id: "t1", name: "Aba 1" }];
    const semSettings = JSON.parse(
      normalizeImportRaw(JSON.stringify({ dashboard: {} }), {
        ...OPTS,
        currentTabs: tabs,
      })
    );
    expect(semSettings.dashboard.settings.tabs).toEqual(tabs);
    const vazia = JSON.parse(
      normalizeImportRaw(
        JSON.stringify({ dashboard: { settings: { tabs: [] } } }),
        { ...OPTS, currentTabs: tabs }
      )
    );
    expect(vazia.dashboard.settings.tabs).toEqual(tabs);
    const existente = JSON.parse(
      normalizeImportRaw(
        JSON.stringify({
          dashboard: { settings: { tabs: [{ id: "t9", name: "Da IA" }] } },
        }),
        { ...OPTS, currentTabs: tabs }
      )
    );
    expect(existente.dashboard.settings.tabs).toEqual([
      { id: "t9", name: "Da IA" },
    ]);
  });

  it("avoidName: colisão (com trim) ganha sufixo ' (cópia)'", () => {
    const colide = JSON.parse(
      normalizeImportRaw(
        JSON.stringify({ dashboard: { name: " Comercial " } }),
        { ...OPTS, avoidName: "Comercial" }
      )
    );
    expect(colide.dashboard.name).toBe("Comercial (cópia)");
    const diferente = JSON.parse(
      normalizeImportRaw(JSON.stringify({ dashboard: { name: "Outro" } }), {
        ...OPTS,
        avoidName: "Comercial",
      })
    );
    expect(diferente.dashboard.name).toBe("Outro");
  });
});

// Estado atual exportado (base do merge/cópia). w_funil na aba t1 (fundo em
// y=12); w_card na aba t2 (fundo em y=4).
const BASE_WIDGETS = [
  {
    key: "w_funil",
    title: "Funil de vendas",
    visual_type: "funnel",
    sources: ["negocios"],
    dimensions: [{ field: "etapa" }],
    metrics: [{ field: "id", agg: "count" }],
    filters: [{ field: "pipeline", op: "eq", value: "Vendas" }],
    settings: { tab: "t1", cor: "azul" },
    grid_position: { x: 3, y: 4, w: 6, h: 8 },
  },
  {
    key: "w_card",
    title: "Card",
    visual_type: "kpi",
    metrics: [{ field: "id", agg: "count" }],
    settings: { tab: "t2" },
    grid_position: { x: 0, y: 0, w: 3, h: 4 },
  },
] as unknown as ImportWidgetSpec[];

function normalizeWidgets(widgets: unknown[], baseWidgets = BASE_WIDGETS) {
  return JSON.parse(
    normalizeImportRaw(JSON.stringify({ widgets }), {
      ...OPTS,
      baseWidgets,
    })
  ).widgets as Record<string, unknown>[];
}

describe("normalizeImportRaw — merge por widget (baseWidgets)", () => {
  it("key existente: delta mescla sobre a base (settings por chave; resto preservado)", () => {
    const [w] = normalizeWidgets([
      { key: "w_funil", title: "Novo título", settings: { cor: "verde" } },
    ]);
    expect(w.title).toBe("Novo título");
    expect(w.visual_type).toBe("funnel");
    expect(w.filters).toEqual([
      { field: "pipeline", op: "eq", value: "Vendas" },
    ]);
    expect(w.settings).toEqual({ tab: "t1", cor: "verde" });
  });

  it("arrays do delta substituem; null limpa", () => {
    const [w] = normalizeWidgets([
      { key: "w_funil", filters: [], settings: { cor: null } },
    ]);
    expect(w.filters).toEqual([]);
    expect((w.settings as Record<string, unknown>).cor).toBeNull();
  });

  it("key nova sem copy_of passa intacta", () => {
    const [w] = normalizeWidgets([
      { key: "w_novo", title: "Novo", visual_type: "kpi" },
    ]);
    expect(w).toEqual({ key: "w_novo", title: "Novo", visual_type: "kpi" });
  });
});

describe("normalizeImportRaw — copy_of (cópia por referência)", () => {
  it("copia a definição inteira da origem, aplica o delta e remove o marcador", () => {
    const [w] = normalizeWidgets([
      { key: "w_funil_2", copy_of: "w_funil", title: "Funil (SDR)" },
    ]);
    expect(w.key).toBe("w_funil_2");
    expect(w.title).toBe("Funil (SDR)");
    expect(w.visual_type).toBe("funnel");
    expect(w.metrics).toEqual([{ field: "id", agg: "count" }]);
    expect(w.settings).toEqual({ tab: "t1", cor: "azul" });
    expect("copy_of" in w).toBe(false);
  });

  it("sem grid_position no delta: posiciona abaixo do fundo da ABA da cópia", () => {
    const [a, b] = normalizeWidgets([
      { key: "w_funil_2", copy_of: "w_funil", title: "A" },
      { key: "w_funil_3", copy_of: "w_funil", title: "B" },
    ]);
    // Fundo da t1 = 4+8; cópias empilham a partir daí, sem sobrepor a origem.
    expect(a.grid_position).toEqual({ x: 3, y: 12, w: 6, h: 8 });
    expect(b.grid_position).toEqual({ x: 3, y: 20, w: 6, h: 8 });
  });

  it("grid_position do delta vence; aba trocada empilha no fundo da aba nova", () => {
    const [comGrid] = normalizeWidgets([
      {
        key: "w_funil_2",
        copy_of: "w_funil",
        grid_position: { x: 9, y: 0, w: 3, h: 4 },
      },
    ]);
    expect(comGrid.grid_position).toEqual({ x: 9, y: 0, w: 3, h: 4 });
    const [outraAba] = normalizeWidgets([
      { key: "w_funil_2", copy_of: "w_funil", settings: { tab: "t2" } },
    ]);
    expect(outraAba.grid_position).toEqual({ x: 3, y: 4, w: 6, h: 8 });
  });

  it("copy_of em key JÁ existente é ignorado (merge normal sobre a própria key)", () => {
    const [w] = normalizeWidgets([
      { key: "w_card", copy_of: "w_funil", title: "Card 2" },
    ]);
    expect(w.visual_type).toBe("kpi");
    expect(w.title).toBe("Card 2");
    expect("copy_of" in w).toBe(false);
  });

  it("origem desconhecida ou sem baseWidgets: só remove o marcador", () => {
    const [semOrigem] = normalizeWidgets([
      { key: "w_x", copy_of: "w_nao_existe", title: "X" },
    ]);
    expect(semOrigem).toEqual({ key: "w_x", title: "X" });
    const semBase = JSON.parse(
      normalizeImportRaw(
        JSON.stringify({ widgets: [{ key: "w_x", copy_of: "w_funil" }] }),
        OPTS
      )
    ).widgets as Record<string, unknown>[];
    expect(semBase[0]).toEqual({ key: "w_x" });
  });
});

// Referências ADICIONAIS (mescla): keys já prefixadas pelo helper de fusão,
// settings.tab removida (aba de outro board), grid da origem preservado.
const REF_WIDGETS = [
  {
    key: "r2_w_pizza",
    title: "Pizza de fontes",
    visual_type: "pie",
    sources: ["leads"],
    dimensions: [{ field: "custom:fonte" }],
    metrics: [{ field: "id", agg: "count" }],
    settings: { cor: "roxo" },
    grid_position: { x: 6, y: 40, w: 6, h: 8 },
  },
  // Colisão proposital com a key de um widget da BASE (cinto-e-suspensório:
  // o helper de fusão já evita isso via dedup).
  {
    key: "w_funil",
    title: "Funil da extra",
    visual_type: "bar",
    grid_position: { x: 0, y: 0, w: 4, h: 4 },
  },
] as unknown as ImportWidgetSpec[];

function normalizeMerge(
  json: Record<string, unknown>,
  extra?: Partial<Parameters<typeof normalizeImportRaw>[1]>
) {
  return JSON.parse(
    normalizeImportRaw(JSON.stringify(json), {
      ...OPTS,
      baseWidgets: BASE_WIDGETS,
      refWidgets: REF_WIDGETS,
      ...extra,
    })
  ) as { widgets: Record<string, unknown>[] };
}

describe("normalizeImportRaw — refWidgets (mescla multi-referência)", () => {
  it("copy_of resolve de refWidgets: cópia inteira + delta + marcador removido", () => {
    const { widgets } = normalizeMerge({
      widgets: [{ key: "w_novo", copy_of: "r2_w_pizza", title: "Pizza (SDR)" }],
    });
    const [w] = widgets;
    expect(w.key).toBe("w_novo");
    expect(w.title).toBe("Pizza (SDR)");
    expect(w.visual_type).toBe("pie");
    expect(w.metrics).toEqual([{ field: "id", agg: "count" }]);
    expect("copy_of" in w).toBe(false);
  });

  it("key igual à de um ref NÃO sofre merge — passa intacta (refs ficam fora do merge por key)", () => {
    const { widgets } = normalizeMerge({
      widgets: [{ key: "r2_w_pizza", title: "Reemitida" }],
    });
    expect(widgets[0]).toEqual({ key: "r2_w_pizza", title: "Reemitida" });
  });

  it("bottomByTab ignora refWidgets: cópia com aba da base empilha no fundo REAL da aba", () => {
    const { widgets } = normalizeMerge({
      widgets: [
        { key: "w_novo", copy_of: "r2_w_pizza", settings: { tab: "t1" } },
      ],
    });
    // Fundo da t1 vem só da BASE (4+8=12) — nunca do y=40 do board da extra.
    expect(widgets[0].grid_position).toEqual({ x: 6, y: 12, w: 6, h: 8 });
  });

  it("cópia de ref SEM aba: fallback para a PRIMEIRA aba do JSON; cópias sucessivas empilham", () => {
    const tabs = [{ id: "t1", name: "Aba 1" }, { id: "t2", name: "Aba 2" }];
    const { widgets } = normalizeMerge(
      {
        dashboard: {},
        widgets: [
          { key: "w_a", copy_of: "r2_w_pizza" },
          { key: "w_b", copy_of: "r2_w_pizza" },
        ],
      },
      { currentTabs: tabs }
    );
    // Empilha abaixo do conteúdo da t1 (fundo 12) — onde o validador vai
    // colocar widget sem aba — e a segunda cópia abaixo da primeira.
    expect(widgets[0].grid_position).toEqual({ x: 6, y: 12, w: 6, h: 8 });
    expect(widgets[1].grid_position).toEqual({ x: 6, y: 20, w: 6, h: 8 });
  });

  it("sem abas no JSON, cópia de ref sem aba usa a aba única (comportamento anterior)", () => {
    const { widgets } = normalizeMerge({
      widgets: [{ key: "w_a", copy_of: "r2_w_pizza" }],
    });
    // Sem dashboard.settings.tabs: fundo da "__single__" = 0.
    expect(widgets[0].grid_position).toEqual({ x: 6, y: 0, w: 6, h: 8 });
  });

  it("colisão de key entre base e ref no copy_of: a BASE vence", () => {
    const { widgets } = normalizeMerge({
      widgets: [{ key: "w_novo", copy_of: "w_funil", title: "Cópia" }],
    });
    // Vem da base (funnel), não da extra (bar).
    expect(widgets[0].visual_type).toBe("funnel");
  });

  it("cópia de origem BASE não usa o fallback de aba (comportamento intocado)", () => {
    const tabs = [{ id: "t9", name: "Primeira" }];
    const { widgets } = normalizeMerge(
      {
        dashboard: {},
        widgets: [{ key: "w_novo", copy_of: "w_funil" }],
      },
      { currentTabs: tabs }
    );
    // Origem da base carrega settings.tab ("t1") — empilha no fundo da t1,
    // exatamente como antes da mescla existir.
    expect(widgets[0].grid_position).toEqual({ x: 3, y: 12, w: 6, h: 8 });
  });
});
