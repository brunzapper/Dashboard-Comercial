// Versão: 1.0 | Data: 01/10/2026
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
    // A aba de trabalho fica fora dos slides.
    expect(METAS_4T26_PRESET.settings?.presentation?.hiddenTabs).toEqual(["arvore"]);
  });
});
