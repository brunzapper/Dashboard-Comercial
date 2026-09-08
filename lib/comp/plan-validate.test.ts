// Versão: 1.0 | Data: 08/09/2026
// Guarda de `validateCompPlanSave`, extraído de savePlan em 08/09/2026. O
// valor destes testes é justamente o que a extração habilita: as checagens que
// antes só existiam dentro da action agora são exercitáveis SEM banco (fake
// client fail-closed) — e são as mesmas que a prévia do assistente de IA de
// remuneração vai usar, em vez de uma régua paralela (invariante 25).
import { describe, expect, it } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Formula, FormulaToken } from "@/lib/records/formulas";
import { fakeSupabase } from "@/tests/helpers/fake-supabase";
import type { CompPlanConfig } from "@/lib/comp/model";

import {
  AUTO_METRIC_KEY,
  MAX_ABS_VALUE,
  MAX_TIER_ATTAINMENT_PCT,
  MAX_TIER_RATE_PCT,
  MAX_WEIGHT_PCT,
  cleanCompNumber,
  validateCompPlanSave,
} from "./plan-validate";

const f = (...tokens: FormulaToken[]): Formula => ({ tokens });
const ref = (r: string): FormulaToken => ({ kind: "field", ref: r });
const aggFormula = f(ref("agg:sum:value"));

function makeConfig(over: Partial<CompPlanConfig> = {}): CompPlanConfig {
  return {
    v: 1,
    factors: [
      {
        id: "f_a",
        label: "Vendas",
        weightPct: 60,
        metricKey: "comp_vendas",
        money: true,
        formula: aggFormula,
        sources: [],
      },
    ],
    ...over,
  };
}

/** Client fake: catálogo mínimo que o validador consulta. */
function db(over: Record<string, unknown[]> = {}): SupabaseClient {
  return fakeSupabase({
    tables: {
      data_sources: over.data_sources ?? [],
      sub_sources: over.sub_sources ?? [],
      field_correspondences: over.field_correspondences ?? [],
      field_correspondence_members: over.field_correspondence_members ?? [],
      field_definitions: over.field_definitions ?? [],
      sync_config: over.sync_config ?? [],
      operations: over.operations ?? [],
      currencies: over.currencies ?? [],
      responsibles: over.responsibles ?? [],
    },
  }).db;
}

async function run(config: CompPlanConfig, name = "Plano", client = db()) {
  return validateCompPlanSave(client, "org-1", { name, config });
}

describe("constantes exportadas", () => {
  it("os bounds saem do módulo (o SPEC da IA vai derivá-los)", () => {
    expect(MAX_ABS_VALUE).toBe(1e12);
    expect(MAX_WEIGHT_PCT).toBe(1000);
    expect(MAX_TIER_ATTAINMENT_PCT).toBe(100000);
    expect(MAX_TIER_RATE_PCT).toBe(1000);
    expect(AUTO_METRIC_KEY).toBe("__auto__");
  });

  it("cleanCompNumber rejeita não-número e estouro", () => {
    expect(cleanCompNumber(10)).toBe(10);
    expect(cleanCompNumber("10")).toBeNull();
    expect(cleanCompNumber(Number.NaN)).toBeNull();
    expect(cleanCompNumber(MAX_ABS_VALUE)).toBeNull();
  });
});

describe("checagens que o parse fail-closed NÃO faz", () => {
  it("exige nome", async () => {
    const res = await run(makeConfig(), "   ");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain("nome do plano");
  });

  it("recusa config que não passa no parse", async () => {
    const res = await validateCompPlanSave(db(), "org-1", {
      name: "Plano",
      config: { v: 99 },
    });
    expect(res.ok).toBe(false);
  });

  it("exige ao menos um fator", async () => {
    const res = await run(makeConfig({ factors: [] }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain("ao menos um fator");
  });

  it("recusa rótulos de fator duplicados (o editor referencia por rótulo)", async () => {
    const cfg = makeConfig();
    cfg.factors.push({ ...cfg.factors[0], id: "f_b", label: "vendas" });
    const res = await run(cfg);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain("mesmo nome");
  });

  it("recusa peso fora do bound", async () => {
    const cfg = makeConfig();
    cfg.factors[0].weightPct = MAX_WEIGHT_PCT + 1;
    const res = await run(cfg);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain("Peso inválido");
  });

  it("recusa fonte desconhecida no fator", async () => {
    const cfg = makeConfig();
    cfg.factors[0].sources = ["fantasma"];
    const res = await run(cfg);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain("Fonte desconhecida");
  });

  it("recusa operação vinculada que não existe (RLS recorta a org)", async () => {
    const cfg = makeConfig({ memberOperationIds: ["op-sumida"] });
    const res = await run(cfg, "Plano", db({ operations: [] }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain("não encontrada");
  });

  it("recusa moeda de alvo não habilitada", async () => {
    const cfg = makeConfig();
    cfg.factors[0].targetCurrency = "USD";
    const res = await run(cfg, "Plano", db({ currencies: [] }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain("não está habilitada");
  });

  it("proíbe Operação nas condições do recorte (coluna derivada)", async () => {
    const cfg = makeConfig();
    cfg.factors[0].filters = [{ field: "operation_id", op: "eq", value: "x" }];
    const res = await run(cfg);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain("Operação não é filtrável aqui");
  });

  it("recusa alvo padrão fora do bound", async () => {
    const cfg = makeConfig();
    cfg.factors[0].defaultTarget = MAX_ABS_VALUE;
    const res = await run(cfg);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain("Alvo padrão inválido");
  });

  it("nomeia o FATOR na mensagem (é o que o laço de IA precisa corrigir)", async () => {
    const cfg = makeConfig();
    cfg.factors[0].label = "Reuniões realizadas";
    cfg.factors[0].sources = ["fantasma"];
    const res = await run(cfg);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain("Reuniões realizadas");
  });
});

describe("bounds das faixas de comissão", () => {
  // A 1ª faixa acompanha o `kind` do bloco: o parse exige `amount` em TODAS
  // as faixas de um bloco flat/per_unit (e `ratePct` em todas as de um pct) —
  // misturar derruba a config antes de chegar ao bound que se quer testar.
  function withTier(tier: Record<string, number>, over: { kind?: string } = {}) {
    const base =
      (over.kind ?? "pct") === "pct"
        ? { fromPct: 0, ratePct: 1 }
        : { fromPct: 0, amount: 1 };
    return makeConfig({
      commissions: [
        {
          id: "c1",
          triggerFactorId: "f_a",
          basisKind: "base",
          tiers: [base, tier],
          ...over,
        },
      ],
    } as Partial<CompPlanConfig>);
  }

  it("recusa limiar acima do teto de atingimento", async () => {
    const res = await run(
      withTier({ fromPct: MAX_TIER_ATTAINMENT_PCT + 1, ratePct: 1 })
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain("limiar acima do limite");
  });

  it("recusa percentual acima do teto em bloco pct", async () => {
    const res = await run(withTier({ fromPct: 10, ratePct: MAX_TIER_RATE_PCT + 1 }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain("percentual acima do limite");
  });

  it("recusa valor acima do teto em bloco flat", async () => {
    const res = await run(
      withTier({ fromPct: 10, amount: MAX_ABS_VALUE }, { kind: "flat" })
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain("valor acima do limite");
  });
});

describe("chave de métrica automática", () => {
  it("resolve o sentinela a partir do rótulo", async () => {
    const cfg = makeConfig();
    cfg.factors[0].label = "Reuniões Realizadas";
    cfg.factors[0].metricKey = AUTO_METRIC_KEY;
    const res = await run(cfg);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.factors[0].metricKey).toMatch(/^comp_/);
    expect(res.config.factors[0].metricKey).not.toBe(AUTO_METRIC_KEY);
  });

  it("desambigua entre fatores do próprio plano", async () => {
    const cfg = makeConfig();
    cfg.factors[0].metricKey = AUTO_METRIC_KEY;
    cfg.factors.push({
      ...cfg.factors[0],
      id: "f_b",
      label: "Vendas ",
      metricKey: AUTO_METRIC_KEY,
    });
    // Rótulos distintos só pelo espaço: as chaves geradas colidiriam.
    cfg.factors[1].label = "Vendas!";
    const res = await run(cfg);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const keys = res.config.factors.map((x) => x.metricKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("devolve os metricDefs com o rótulo 'Plano — Fator'", async () => {
    const res = await run(makeConfig(), "Comercial");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.metricDefs).toEqual([
      { key: "comp_vendas", label: "Comercial — Vendas", money: true },
    ]);
  });
});

describe("fórmula livre do total", () => {
  it("recusa SOMASE (as variáveis já são totais)", async () => {
    const cfg = makeConfig({
      totalFormula: f(
        { kind: "func", name: "SOMASE" } as FormulaToken,
        ref("comp:base")
      ),
    });
    const res = await run(cfg);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain("SOMASE");
  });
});

describe("caminho feliz", () => {
  it("devolve nome normalizado e a config parseada", async () => {
    const res = await run(makeConfig(), "  Plano Comercial  ");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.name).toBe("Plano Comercial");
    expect(res.config.factors).toHaveLength(1);
  });
});
