// Versão: 1.0 | Data: 07/08/2026
// Fiscalização do preset "Outbound — Pré-Vendas": convenções estruturais do
// preset engine (prefixo/unicidade dos presetKeys — GC por prefixo; tab de
// todo widget declarada; fontes referenciadas conhecidas) e as FÓRMULAS
// validadas nos catálogos REAIS (agregado via buildAggOperandCatalog p/
// métricas calc + operandos escopados @fonte; por-registro via
// perRecordCalcOperands p/ o campo tier_contas) — um ref digitado errado
// quebra AQUI, não em produção com widget zerado. Também pina as regras de
// jul/2026 das sub-fontes (fonte "Outro" + corte na Data Reunião).
import { describe, expect, it } from "vitest";

import { validateFormulaForContext } from "@/lib/records/formula-validate";
import { perRecordCalcOperands } from "@/lib/records/calc-operands";
import type { SourceDef } from "@/lib/sources";
import {
  buildAggOperandCatalog,
  defsAggCatalogInput,
  type AggCatalogDefRow,
} from "@/lib/widgets/agg-catalog";

import { OUTBOUND_PRESET } from "./outbound";

const P = OUTBOUND_PRESET;

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

// Catálogo mínimo REALISTA: raízes de produção + as subs do próprio preset.
const SOURCES: SourceDef[] = [
  src("leads", "lead"),
  src("meetime_outbound", "meetime_outbound"),
  ...P.subSources!.map((s) =>
    src(s.key, s.parent_key === "leads" ? "lead" : "meetime_outbound", {
      parentKey: s.parent_key,
      period: s.default_period_field,
    })
  ),
];

// Defs reais dos campos custom referenciados pelas fórmulas do preset.
const DEFS: AggCatalogDefRow[] = [
  { field_key: "status", label: "Status", data_type: "texto", applies_to: ["meetime_outbound"] },
  { field_key: "atividades", label: "Atividades", data_type: "numero", applies_to: ["meetime_outbound"] },
  { field_key: "quantidade_de_contas", label: "Quantidade de contas", data_type: "numero", applies_to: ["meetime_outbound"] },
  { field_key: "dias_em_prospeccao", label: "Dias em prospecção", data_type: "numero", applies_to: ["meetime_outbound"] },
];

const aggCatalog = buildAggOperandCatalog(defsAggCatalogInput(DEFS, SOURCES, []));

describe("preset outbound — estrutura", () => {
  it("presetKeys únicos, prefixados e com tab declarada", () => {
    const tabIds = new Set(P.settings!.tabs!.map((t) => t.id));
    const keys = P.widgets.map((w) => w.presetKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const w of P.widgets) {
      expect(w.presetKey.startsWith("outbound.")).toBe(true);
      expect(
        tabIds.has(w.settings?.tab ?? ""),
        `${w.presetKey}: tab "${w.settings?.tab}" não declarada`
      ).toBe(true);
    }
  });

  it("fontes referenciadas por widgets/métricas existem (subs do preset ou bases)", () => {
    const known = new Set([
      "leads",
      "meetime_outbound",
      ...P.subSources!.map((s) => s.key),
    ]);
    for (const w of P.widgets) {
      for (const s of w.sources ?? []) {
        expect(known.has(s), `${w.presetKey}: fonte "${s}"`).toBe(true);
      }
      for (const m of w.metrics) {
        for (const s of m.sources ?? []) {
          expect(known.has(s), `${w.presetKey}: métrica → fonte "${s}"`).toBe(true);
        }
      }
    }
  });

  it("regra jul/2026: subs de reunião gateiam fonte 'Outro' + corte 2026-07-01", () => {
    for (const key of ["ob_rr", "ob_rq"]) {
      const sub = P.subSources!.find((s) => s.key === key)!;
      expect(sub.parent_key).toBe("leads");
      expect(sub.default_period_field).toBe("custom:bitrix_uf_crm_1743441331");
      expect(
        sub.filter.some((f) => f.field === "custom:fonte" && f.value === "Outro")
      ).toBe(true);
      expect(
        sub.filter.some(
          (f) =>
            f.field === "custom:bitrix_uf_crm_1743441331" &&
            f.op === "gte" &&
            f.value === "2026-07-01"
        )
      ).toBe(true);
    }
    const noshow = P.subSources!.find((s) => s.key === "ob_noshow")!;
    expect(noshow.default_period_field).toBe("custom:bitrix_moved_time");
    expect(noshow.filter.some((f) => f.value === "No Show")).toBe(true);
  });

  it("meta: KPI modo meta e goalLine usam a chave rq_outbound", () => {
    const meta = P.widgets.find(
      (w) => w.presetKey === "outbound.funil.kpi_meta_rq"
    )!;
    expect(meta.settings?.mode).toBe("meta");
    expect(meta.settings?.metric).toBe("rq_outbound");
    const evolucao = P.widgets.find(
      (w) => w.presetKey === "outbound.funil.evolucao_mensal"
    )!;
    expect(evolucao.settings?.goalLine?.metric).toBe("rq_outbound");
  });
});

describe("preset outbound — fórmulas", () => {
  it("métricas calc e cards de fórmula validam no catálogo agregado REAL", () => {
    for (const w of P.widgets) {
      for (const m of w.metrics) {
        if (!m.calc || !m.formula) continue;
        const v = validateFormulaForContext(m.formula, {
          kind: "aggregate",
          catalog: aggCatalog,
          sources: SOURCES,
        });
        expect(v.ok, `${w.presetKey}/${m.label}: ${v.ok ? "" : v.error}`).toBe(
          true
        );
      }
      const cardFormula = w.settings?.card?.formula;
      if (cardFormula) {
        const v = validateFormulaForContext(cardFormula, {
          kind: "aggregate",
          catalog: aggCatalog,
          sources: SOURCES,
        });
        expect(v.ok, `${w.presetKey}/card: ${v.ok ? "" : v.error}`).toBe(true);
      }
    }
  });

  it("campo tier_contas valida no catálogo por-registro REAL", () => {
    const tier = P.fields!.find((f) => f.field_key === "tier_contas")!;
    const per = perRecordCalcOperands(
      DEFS.map((d) => ({
        field_key: d.field_key,
        label: d.label,
        data_type: d.data_type,
        applies_to: d.applies_to ?? null,
      })),
      SOURCES
    );
    const v = validateFormulaForContext(tier.formula!, {
      kind: "record",
      catalog: per.allRefs,
    });
    expect(v.ok, v.ok ? "" : v.error).toBe(true);
  });
});
