// Versão: 1.1 | Data: 31/07/2026
// v1.1 (31/07/2026): v3 do preset — 5 abas (nova "atribuicao"); pina a tabela
//   de ATRIBUIÇÃO (records-mode sobre reunioes_qualificadas com a coluna
//   custom:sdr_reuniao editable) e a Visão geral de REMUNERAÇÃO (KPIs sobre a
//   base espelho + tabela de conferência records-mode SEM coluna editável).
// Fiscalização do preset "Remuneração Variável": os planos declarados passam
// pelo MESMO parse fail-closed do runtime (parseCompPlanConfig — com
// presetKey/memberOperationIds injetados exatamente como o
// ensurePresetCompPlans faz) e as fórmulas dos fatores validam no catálogo
// agregado REAL (defsAggCatalogInput + buildAggOperandCatalog +
// validateFormulaForContext — nunca listas paralelas): um ref digitado errado
// no preset quebra AQUI, não em produção com realizado zerado. Também pina as
// convenções estruturais do preset engine: prefixo/unicidade dos presetKeys
// de widget (GC por prefixo), pais de operação declarados antes dos filhos
// (resolve sequencial) e chaves de métrica no formato do registry.
import { describe, expect, it } from "vitest";

import { parseCompPlanConfig } from "@/lib/comp/model";
import { validateFormulaForContext } from "@/lib/records/formula-validate";
import type { SourceDef } from "@/lib/sources";
import {
  buildAggOperandCatalog,
  defsAggCatalogInput,
  type AggCatalogDefRow,
} from "@/lib/widgets/agg-catalog";

import { REMUNERACAO_VARIAVEL_PRESET } from "./remuneracao-variavel";

const P = REMUNERACAO_VARIAVEL_PRESET;

const src = (
  key: string,
  recordType: string,
  opts: { parentKey?: string; period?: string } = {}
): SourceDef => ({
  key,
  recordType,
  label: key,
  shortLabel: key,
  defaultPeriodField: opts.period ?? "source_created_at",
  builtin: false,
  manualEntry: false,
  ...(opts.parentKey ? { parentKey: opts.parentKey } : {}),
});

// Catálogo mínimo REALISTA: raízes builtin + as subs que o próprio preset
// declara (mesmas keys/record_types de produção).
const SOURCES: SourceDef[] = [
  src("leads", "lead"),
  src("deals", "negocio", { period: "closed_at" }),
  src("estudo", "venda_site"),
  src("vendas_assinadas", "negocio", {
    parentKey: "deals",
    period: "custom:data_assinatura",
  }),
  src("vendas_site", "venda_site", { parentKey: "estudo" }),
  src("reunioes_qualificadas", "lead", {
    parentKey: "leads",
    period: "custom:bitrix_uf_crm_1743441331",
  }),
];

// Defs dos campos que as fórmulas referenciam (chaves reais de produção).
const DEFS: AggCatalogDefRow[] = [
  {
    field_key: "mrr_contrato",
    label: "MRR do contrato",
    data_type: "calculado",
    applies_to: ["negocio"],
  },
  {
    field_key: "implementacao",
    label: "Implementação",
    data_type: "moeda",
    applies_to: ["negocio"],
  },
  {
    field_key: "adicional_ao_mrr",
    label: "Adicional ao MRR",
    data_type: "moeda",
    applies_to: ["negocio"],
  },
  {
    field_key: "sdr_reuniao",
    label: "SDR da Reunião",
    data_type: "selecao",
    applies_to: ["lead"],
  },
];

const catalog = buildAggOperandCatalog(defsAggCatalogInput(DEFS, SOURCES, []));

describe("preset remuneracao_variavel — planos", () => {
  it("todo plano passa pelo parse fail-closed com a MESMA injeção do apply", () => {
    expect(P.compPlans!.length).toBe(5);
    for (const decl of P.compPlans!) {
      const parsed = parseCompPlanConfig({
        ...decl.config,
        v: 1,
        presetKey: decl.presetKey,
        // O apply injeta os ids resolvidos das operações — mesmo shape.
        ...(decl.memberOperationNames?.length
          ? {
              memberOperationIds: decl.memberOperationNames.map(
                (_, i) => `00000000-0000-4000-a000-00000000000${i}`
              ),
            }
          : {}),
      });
      expect(parsed, `plano ${decl.presetKey} não parseia`).not.toBeNull();
      expect(parsed!.presetKey).toBe(decl.presetKey);
      // Padrão da casa: todo plano de fábrica apura sobre o mês anterior.
      expect(parsed!.apuracao).toBe("mes_anterior");
      // Presença de operações ⇒ lista explícita SEMPRE (fail-closed do model).
      expect(parsed!.memberOperationIds?.length).toBe(
        decl.memberOperationNames?.length ?? 0
      );
      expect((parsed!.commissions?.length ?? 0) > 0).toBe(true);
    }
  });

  it("fórmulas dos fatores validam no catálogo agregado REAL (refs pinados)", () => {
    for (const decl of P.compPlans!) {
      for (const factor of decl.config.factors) {
        const v = validateFormulaForContext(factor.formula, {
          kind: "aggregate",
          catalog,
          sources: SOURCES,
        });
        expect(
          v.ok,
          `fórmula de ${decl.presetKey}/${factor.id}: ${v.ok ? "" : v.error}`
        ).toBe(true);
      }
    }
  });

  it("regras do pedido pinadas: faixas dos AEs, 20% dos SDRs, prêmios por reunião/meta", () => {
    const byKey = new Map(P.compPlans!.map((p) => [p.presetKey, p]));
    // AEs: 30/40/50 por atingimento; metas 35k BRL e 10k USD.
    const closer = byKey.get("rv_ae_closer")!;
    expect(closer.config.commissions![0].tiers).toEqual([
      { fromPct: 0, ratePct: 30 },
      { fromPct: 75, ratePct: 40 },
      { fromPct: 100, ratePct: 50 },
    ]);
    expect(closer.config.factors[0].defaultTarget).toBe(35000);
    const fc = byKey.get("rv_ae_full_cycle")!;
    expect(fc.config.factors[0].defaultTarget).toBe(10000);
    expect(fc.config.factors[0].targetCurrency).toBe("USD");
    // SDR Inbound: 20% por realizado + R$/reunião por volume (lookup).
    const inb = byKey.get("rv_sdr_inbound_fc")!;
    const perc = inb.config.commissions!.find((c) => c.id === "perc_valor")!;
    expect(perc.tierBy).toBe("realized");
    expect(perc.tiers).toEqual([{ fromPct: 0, ratePct: 20 }]);
    const premio = inb.config.commissions!.find((c) => c.id === "premio_reuniao")!;
    expect(premio.kind).toBe("per_unit");
    expect(premio.tiers).toEqual([
      { fromPct: 0, amount: 10 },
      { fromPct: 26, amount: 12.5 },
      { fromPct: 50, amount: 15 },
      { fromPct: 60, amount: 17.5 },
    ]);
    // SDR Outbound: prêmio fixo por atingimento; metas 10 e 20.
    const outFc = byKey.get("rv_sdr_outbound_fc")!;
    const meta = outFc.config.commissions!.find((c) => c.id === "premio_meta")!;
    expect(meta.kind).toBe("flat");
    expect(meta.tiers).toEqual([
      { fromPct: 50, amount: 500 },
      { fromPct: 75, amount: 750 },
      { fromPct: 100, amount: 1000 },
      { fromPct: 120, amount: 1500 },
    ]);
    expect(
      outFc.config.factors.find((f) => f.id === "reunioes")!.defaultTarget
    ).toBe(10);
    const simples = byKey.get("rv_sdr_outbound_simples")!;
    expect(simples.config.factors[0].defaultTarget).toBe(20);
    // Crédito do SDR: reuniões pelo campo novo do lead; valor pelo campo do deal.
    expect(
      outFc.config.factors.find((f) => f.id === "reunioes")!.memberField
    ).toBe("custom:sdr_reuniao");
    expect(
      outFc.config.factors.find((f) => f.id === "valor")!.memberField
    ).toBe("custom:sdr_responsavel");
  });

  it("chaves de métrica no formato do registry e únicas entre os planos", () => {
    const keys = P.compPlans!.flatMap((p) =>
      p.config.factors.map((f) => f.metricKey)
    );
    for (const k of keys) expect(k).toMatch(/^[a-z0-9_]{1,40}$/);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("preset remuneracao_variavel — estrutura", () => {
  it("presetKeys de widget: prefixados com a chave do dashboard e únicos (GC por prefixo)", () => {
    const keys = P.widgets.map((w) => w.presetKey);
    for (const k of keys) expect(k.startsWith(`${P.presetKey}.`)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("operações: pais declarados antes dos filhos (resolve sequencial do apply)", () => {
    const seen = new Set<string>();
    for (const op of P.operations!) {
      if (op.parentName) {
        expect(seen.has(op.parentName), `pai de "${op.name}" fora de ordem`).toBe(
          true
        );
      }
      seen.add(op.name);
    }
  });

  it("v3: 5 abas, vínculos pinados por nome, filtros por nome e aba Remuneração no espelho", () => {
    expect(P.settings!.tabs!.map((t) => t.id)).toEqual([
      "visao",
      "aes",
      "sdr",
      "atribuicao",
      "remuneracao",
    ]);
    expect(P.ensureCompMirror).toBe(true);
    // Vínculos declarados (grafias EXATAS da base viva) — 1 pessoa por sub-op.
    const linksByOp = new Map(
      P.operations!.map((o) => [o.name, o.responsibleNames ?? []])
    );
    expect(linksByOp.get("AE Closer")).toEqual(["Gabriella Salles"]);
    expect(linksByOp.get("AE Full Cycle")).toEqual(["Daniela Drielsma"]);
    expect(linksByOp.get("SDR Inbound Full Cycle")).toEqual([
      "Paulo Vitor Santos",
    ]);
    expect(linksByOp.get("SDR Outbound Full Cycle")).toEqual([
      "Marcus Barcelos",
    ]);
    expect(linksByOp.get("SDR Outbound Simples")).toEqual(["Marcos Hernandes"]);
    // Raízes sem vínculo direto (as pessoas ficam nas sub-operações).
    expect(linksByOp.get("AEs")).toEqual([]);
    expect(linksByOp.get("SDR/BDR")).toEqual([]);
    // Cards por pessoa filtram responsible_id pelo NOME PURO (o engine
    // resolve nome→id→grupo em runtime) — todo nome usado num filtro precisa
    // estar DECLARADO nos vínculos (nome fora do conjunto seria typo).
    const declaredNames = new Set(
      P.operations!.flatMap((o) => o.responsibleNames ?? [])
    );
    const respFilterValues = P.widgets.flatMap((w) =>
      w.filters
        .filter((f) => f.field === "responsible_id")
        .map((f) => f.value)
        .filter((v): v is string => typeof v === "string")
    );
    expect(respFilterValues.length).toBeGreaterThan(0);
    for (const v of respFilterValues) {
      expect(v.startsWith("@")).toBe(false); // sentinela morreu — nome puro
      expect(declaredNames.has(v)).toBe(true);
    }
    // Cards por SDR filtram o campo do dropdown vivo pelos MESMOS nomes.
    const sdrCardValues = P.widgets
      .flatMap((w) => w.filters)
      .filter((f) => f.field === "custom:sdr_reuniao" && f.op === "eq")
      .map((f) => f.value as string);
    for (const v of sdrCardValues) expect(declaredNames.has(v)).toBe(true);
    // Aba Remuneração: todos os widgets sobre a base espelho (key literal).
    const remWidgets = P.widgets.filter(
      (w) => w.settings?.tab === "remuneracao"
    );
    expect(remWidgets.length).toBeGreaterThanOrEqual(4);
    for (const w of remWidgets) expect(w.sources).toEqual(["remuneracao"]);
  });

  it("v3: aba Atribuição com tabela records-mode e coluna sdr_reuniao EDITÁVEL", () => {
    const tabela = P.widgets.find(
      (w) => w.presetKey === "remuneracao_variavel.atrib.tabela"
    )!;
    expect(tabela.settings?.tab).toBe("atribuicao");
    expect(tabela.sources).toEqual(["reunioes_qualificadas"]);
    expect(tabela.settings?.rowMode).toBe("records");
    const col = tabela.settings?.columns?.find(
      (c) => c.field === "custom:sdr_reuniao"
    );
    expect(col?.editable).toBe(true);
    // KPIs de pendência: sem SDR (is_null) e atribuídas (not_null) — o par
    // que dá visibilidade à fila de atribuição.
    const semSdr = P.widgets.find(
      (w) => w.presetKey === "remuneracao_variavel.atrib.kpi_sem_sdr"
    )!;
    expect(semSdr.filters).toContainEqual({
      field: "custom:sdr_reuniao",
      op: "is_null",
    });
  });

  it("v3: Visão geral = remuneração (KPIs no espelho; conferência records-mode SEM edição)", () => {
    const visaoKpis = P.widgets.filter(
      (w) => w.settings?.tab === "visao" && w.visual_type === "kpi"
    );
    expect(visaoKpis.length).toBeGreaterThanOrEqual(4);
    for (const w of visaoKpis) expect(w.sources).toEqual(["remuneracao"]);
    const conferencia = P.widgets.find(
      (w) => w.presetKey === "remuneracao_variavel.visao.folha_conferencia"
    )!;
    expect(conferencia.sources).toEqual(["remuneracao"]);
    expect(conferencia.settings?.rowMode).toBe("records");
    // Conferência ≠ edição: nenhuma coluna do espelho é editável inline.
    for (const c of conferencia.settings?.columns ?? []) {
      expect(c.editable ?? false).toBe(false);
    }
    // "Por operação" determinístico: agrupa pelo PLANO gravado no espelho.
    const porPlano = P.widgets.find(
      (w) => w.presetKey === "remuneracao_variavel.visao.por_plano"
    )!;
    expect(porPlano.dimensions[0]?.field).toBe("custom:rem_plano");
  });

  it("campo do dropdown vivo declarado com options_source e sub de reuniões com a Data Reunião", () => {
    const sdr = P.fields!.find((f) => f.field_key === "sdr_reuniao")!;
    expect(sdr.options_source).toBe("responsibles");
    expect(sdr.data_type).toBe("selecao");
    expect(sdr.applies_to).toEqual(["lead"]);
    const sub = P.subSources!.find((s) => s.key === "reunioes_qualificadas")!;
    expect(sub.default_period_field).toBe("custom:bitrix_uf_crm_1743441331");
    expect(sub.filter).toContainEqual({
      field: "stage",
      op: "eq",
      value: "Lead Qualificado",
    });
  });
});
