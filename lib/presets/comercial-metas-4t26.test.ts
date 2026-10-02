// Versão: 1.3 | Data: 02/10/2026
// v1.3 (02/10/2026): esqueleto de slide (headline em toda aba-slide, capa sem
//   esqueleto) e o slide Destaque (recorte, destaque e anotação coerentes).
// v1.2 (02/10/2026): estilo Editorial + palco, abas de trabalho fora dos
//   slides (árvore e lançamentos), nenhum placeholder visível em slide e a
//   Base manual fora da apresentação.
// v1.1 (01/10/2026): os slides ocupam a tela (grade fina, sem sobreposição,
//   sem sobra) e o período é fixo (meses nas tabelas e na Tree, barra off).
// O preset de metas 4T26 é DADO — este teste confere que os números batem com
// a aritmética da apresentação e que toda referência (indicador, galho, nó
// pai, aba) existe. Um número digitado errado aqui vira meta errada na org.
import { describe, expect, it } from "vitest";

import { combineChildren } from "@/lib/indicators/model";
import { validateIndicatorShape } from "@/lib/indicators/validate";
import { parseNodePayload } from "@/lib/tree/payload";
import { sanitizeGoalTableSettings } from "@/lib/widgets/goal-table";
import {
  METAS_4T26_GOALS,
  METAS_4T26_INDICATORS,
  METAS_4T26_MONTH_KEYS,
  METAS_4T26_NODES,
  METAS_4T26_PRESET,
  METAS_4T26_SELLERS,
} from "./comercial-metas-4t26";
import { PRESETS } from "./definitions";

const target = (indicator: string, month: number, responsibleName?: string) =>
  METAS_4T26_GOALS.find(
    (g) =>
      g.indicator === indicator &&
      g.month === month &&
      (g.responsibleName ?? null) === (responsibleName ?? null)
  )?.target ?? NaN;

const MONTHS = [10, 11, 12];

describe("aritmética da apresentação", () => {
  it("MRR novo oficial = inbound + outbound", () => {
    for (const m of MONTHS) {
      expect(target("mrr_novo", m)).toBe(target("mrr_novo_inbound", m) + target("mrr_novo_outbound", m));
    }
  });
  it("outbound: vendas × ticket = MRR (2 × 1.800 = 3.600…)", () => {
    for (const m of MONTHS) {
      expect(target("vendas_outbound", m) * target("ticket_outbound", m)).toBe(target("mrr_novo_outbound", m));
    }
  });
  it("inbound: o projetado (vendas × ticket) cobre a meta sem arredondamento", () => {
    for (const m of MONTHS) {
      const projected = combineChildren("×", [
        { value: target("vendas_inbound", m), unit: "quantidade" },
        { value: target("ticket_inbound", m), unit: "moeda" },
      ])!;
      expect(projected).toBeGreaterThanOrEqual(target("mrr_novo_inbound", m));
    }
  });
  it("investimento = equipe + comissões + softwares + consultorias", () => {
    for (const m of MONTHS) {
      const sum =
        target("invest_equipe", m) +
        target("invest_comissoes", m) +
        target("invest_softwares", m) +
        target("invest_consultorias", m);
      expect(sum).toBe(target("investimento_comercial", m));
    }
  });
  it("CAC ≈ (marketing + investimento) ÷ clientes", () => {
    for (const m of MONTHS) {
      const cac =
        (target("marketing", m) + target("investimento_comercial", m)) / target("clientes_novos", m);
      expect(Math.abs(cac - target("cac", m))).toBeLessThan(1);
    }
  });
  it("clientes = inbound + outbound", () => {
    for (const m of MONTHS) {
      expect(target("clientes_novos", m)).toBe(target("clientes_inbound", m) + target("clientes_outbound", m));
    }
  });
  it("compromissos individuais somam 35/40/45 mil (acima do oficial)", () => {
    const sums = MONTHS.map((m) =>
      Object.keys(METAS_4T26_SELLERS).reduce((acc, name) => acc + target("mrr_novo", m, name), 0)
    );
    expect(sums).toEqual([35000, 40000, 45000]);
  });
});

describe("integridade das referências", () => {
  const keys = new Set(METAS_4T26_INDICATORS.map((i) => i.key));

  it("registrado em PRESETS", () => {
    expect(PRESETS.some((p) => p.presetKey === METAS_4T26_PRESET.presetKey)).toBe(true);
  });

  it("todo indicador passa pela régua estrutural", () => {
    for (const ind of METAS_4T26_INDICATORS) {
      const v = validateIndicatorShape({
        ...ind,
        rollup: ind.rollup ?? "soma",
        direction: ind.direction ?? "maior_melhor",
        tolerancePct: ind.tolerancePct ?? 5,
        realized: ind.realized ? { v: 1, ...ind.realized, filters: ind.realized.filters ?? [] } : null,
      });
      expect(v.ok, `${ind.key}: ${v.ok ? "" : v.message}`).toBe(true);
    }
  });

  it("toda meta cita um indicador do catálogo", () => {
    for (const g of METAS_4T26_GOALS) expect(keys.has(g.indicator), g.indicator).toBe(true);
  });

  it("nós do mapa: pais antes dos filhos, payload válido, indicador existente", () => {
    const seen = new Set<string>();
    for (const n of METAS_4T26_NODES) {
      if (n.parentKey) expect(seen.has(n.parentKey), `${n.key} → ${n.parentKey}`).toBe(true);
      expect(seen.has(n.key), `chave duplicada ${n.key}`).toBe(false);
      seen.add(n.key);
      if (n.kind !== "note") {
        const p = parseNodePayload(n.kind, n.payload) as Record<string, unknown> | null;
        expect(p, n.key).not.toBeNull();
        if (n.kind === "indicator") expect(keys.has(p!.indicator as string), n.key).toBe(true);
        if (n.kind === "plan")
          for (const k of (p!.indicators as string[]) ?? []) expect(keys.has(k), `${n.key}:${k}`).toBe(true);
      }
    }
  });

  it("widgets: abas existem, galhos existem e tabelas citam indicadores do catálogo", () => {
    const tabIds = new Set((METAS_4T26_PRESET.settings?.tabs ?? []).map((t) => t.id));
    const nodeKeys = new Set(METAS_4T26_NODES.map((n) => n.key));
    for (const w of METAS_4T26_PRESET.widgets) {
      expect(tabIds.has(w.settings?.tab ?? ""), w.presetKey).toBe(true);
      const rootRef = w.settings?.tree?.rootRef;
      if (rootRef) expect(nodeKeys.has(rootRef.replace(/^preset:/, "")), rootRef).toBe(true);
      if (w.settings?.goalTable) {
        const warnings: string[] = [];
        sanitizeGoalTableSettings(w.settings.goalTable, { knownKeys: keys, where: w.presetKey, warnings });
        expect(warnings, w.presetKey).toEqual([]);
      }
    }
    // As abas de trabalho ficam fora dos slides.
    expect(METAS_4T26_PRESET.settings?.presentation?.hiddenTabs).toEqual(["arvore", "lancamentos"]);
  });

  it("v1.3: esqueleto de slide — toda aba-slide (menos a capa) tem headline", () => {
    const st = METAS_4T26_PRESET.settings;
    expect(st?.slide?.showNumber).toBe(true);
    const hidden = new Set(st?.presentation?.hiddenTabs ?? []);
    const slides = (st?.tabs ?? []).filter((t) => !hidden.has(t.id));
    for (const t of slides) {
      if (t.frame === false || t.id === "fontes") continue;
      expect(t.headline?.trim(), t.id).toBeTruthy();
    }
    expect(slides.find((t) => t.id === "capa")?.frame).toBe(false);
  });

  it("v1.3: slide Destaque — dados do recorte Inbound, destaque e anotação coerentes", () => {
    const ws = METAS_4T26_PRESET.widgets.filter((w) => w.settings?.tab === "destaque");
    const bar = ws.find((w) => w.visual_type === "barra")!;
    expect(bar.sources).toEqual(["vendas_assinadas", "vendas_site"]);
    const ap = bar.settings?.appearance;
    // A anotação aponta para uma categoria destacada (o mês que o slide defende).
    expect(ap?.highlight?.categories).toContain(ap?.annotations?.[0]?.x);
    const kpi = ws.find((w) => w.visual_type === "kpi")!;
    expect(kpi.metrics[0]?.field).toBe("unified:mrr_venda");
    expect(kpi.settings?.appearance?.kpiCompact).toBe(true);
  });

  it("v1.2: estilo de apresentação e nenhum texto de trabalho vazando no slide", () => {
    const st = METAS_4T26_PRESET.settings;
    expect(st?.style?.key).toBe("editorial");
    expect(st?.presentation?.fit).toBe("palco");
    // Placeholder só como comentário de AUTOR (( … )) — linha solta "(Cole…)"
    // apareceria no slide.
    for (const w of METAS_4T26_PRESET.widgets) {
      const text = w.settings?.note?.text ?? "";
      for (const line of text.split("\n")) {
        if (/cole aqui/i.test(line)) expect(line.trim()).toMatch(/^\(\(.*\)\)$/);
      }
    }
    // Interface de trabalho nunca num slide.
    const hidden = new Set(st?.presentation?.hiddenTabs ?? []);
    for (const w of METAS_4T26_PRESET.widgets.filter((x) => x.visual_type === "base_manual")) {
      expect(hidden.has(w.settings?.tab ?? "") || w.settings?.hideInPresentation === true, w.presetKey).toBe(true);
    }
  });
});

describe("slides ocupam a tela e já vêm no período certo (v1.1)", () => {
  const slides = (METAS_4T26_PRESET.settings?.tabs ?? []).filter(
    (t) => !(METAS_4T26_PRESET.settings?.presentation?.hiddenTabs ?? []).includes(t.id)
  );

  it("grade fina, linha quadrada e barra de período desligada", () => {
    expect(METAS_4T26_PRESET.settings?.canvas).toEqual({ gridVersion: 2 });
    expect(METAS_4T26_PRESET.settings?.periodBar?.enabled).toBe(false);
    // v1.4: barra oculta APLICA o padrão — tem de ser "todo o período", senão
    // vira AND com os recortes fixos dos widgets (o Destaque ficava vazio).
    expect(METAS_4T26_PRESET.settings?.periodBar?.defaultPreset).toBe("all");
  });

  it("v1.4: vendedores com a grafia exata dos responsáveis cadastrados", () => {
    // Mesma grafia do preset Remuneração Variável (base viva).
    const live = new Set([
      "Gabriella Salles",
      "Daniela Drielsma",
      "Paulo Vitor Santos",
      "Marcus Barcelos",
      "Marcos Hernandes",
    ]);
    for (const name of Object.keys(METAS_4T26_SELLERS)) expect(live.has(name)).toBe(true);
  });

  it("cada slide cobre a largura toda, sem sobreposição", () => {
    for (const tab of slides) {
      const ws = METAS_4T26_PRESET.widgets.filter((w) => w.settings?.tab === tab.id);
      expect(ws.length, tab.id).toBeGreaterThan(0);
      for (const w of ws) expect(w.grid_position.x + w.grid_position.w, w.presetKey).toBeLessThanOrEqual(120);
      // largura coberta (com o vão de 1 célula entre colunas)
      const right = Math.max(...ws.map((w) => w.grid_position.x + w.grid_position.w));
      expect(right, tab.id).toBe(120);
      // v1.3: o slide ocupa a altura inteira — antes "mesma altura em todos
      // os quadros", o que proibia empilhar (KPI sobre a nota, no Destaque).
      const bottom = Math.max(...ws.map((w) => w.grid_position.y + w.grid_position.h));
      expect(bottom, tab.id).toBe(64);
      for (let i = 0; i < ws.length; i++)
        for (let j = i + 1; j < ws.length; j++) {
          const a = ws[i].grid_position;
          const b = ws[j].grid_position;
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap, `${ws[i].presetKey} × ${ws[j].presetKey}`).toBe(false);
        }
    }
  });

  it("tabelas e árvores com os meses fixos de out–dez/2026", () => {
    expect(METAS_4T26_MONTH_KEYS).toEqual(["2026-10", "2026-11", "2026-12"]);
    for (const w of METAS_4T26_PRESET.widgets) {
      if (w.visual_type === "metas") expect(w.settings?.goalTable?.months, w.presetKey).toEqual(METAS_4T26_MONTH_KEYS);
      if (w.visual_type === "tree") expect(w.settings?.tree?.months, w.presetKey).toEqual(METAS_4T26_MONTH_KEYS);
    }
  });
});
