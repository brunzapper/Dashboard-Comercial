// Versão: 1.0 | Data: 24/07/2026
// Testes da validação de fórmula POR CONTEXTO — fonte única das regras e
// mensagens compartilhadas entre editores (ao vivo) e servidor (submit).
// Warnings de escopo NÃO bloqueiam o save: apontam operandos @fonte que
// degradariam para "—" em runtime.
import { describe, expect, it } from "vitest";

import {
  AGG_IN_RECORD_MSG,
  COND_AGG_IN_RECORD_MSG,
  validateFormulaForContext,
} from "@/lib/records/formula-validate";
import type { Formula, FormulaToken } from "@/lib/records/formulas";
import { BUILTIN_SOURCES, type SourceDef } from "@/lib/sources";

const ref = (r: string): FormulaToken => ({ kind: "field", ref: r });
const f = (...tokens: FormulaToken[]): Formula => ({ tokens });

const SOURCES: SourceDef[] = [
  ...BUILTIN_SOURCES,
  {
    key: "leads_ilike",
    recordType: "lead",
    label: "Leads / ilike",
    shortLabel: "Ilike",
    defaultPeriodField: "source_created_at",
    builtin: false,
    manualEntry: false,
    parentKey: "leads",
    filter: [{ field: "title", op: "ilike", value: "%x%" }],
  },
];

describe("contexto 'record'", () => {
  const catalog = [{ ref: "value", label: "Valor" }];

  it("SOMASE/CONT.SE → mensagem dedicada exata", () => {
    const out = validateFormulaForContext(
      f({ kind: "func", name: "SOMASE" }, { kind: "lparen" }, ref("value"), {
        kind: "argsep",
      }, ref("value"), { kind: "cmp", op: ">" }, { kind: "const", value: 0 }, {
        kind: "rparen",
      }),
      { kind: "record", catalog }
    );
    expect(out).toEqual({
      ok: false,
      error: COND_AGG_IN_RECORD_MSG,
      warnings: [],
    });
  });

  it("operando agregado (agg:) → mensagem dedicada exata", () => {
    const out = validateFormulaForContext(f(ref("agg:sum:value")), {
      kind: "record",
      catalog,
    });
    expect(out).toEqual({ ok: false, error: AGG_IN_RECORD_MSG, warnings: [] });
  });

  it("ref fora do catálogo → erro; fórmula ok → { ok, warnings: [] }", () => {
    expect(
      validateFormulaForContext(f(ref("nope")), { kind: "record", catalog })
    ).toEqual({
      ok: false,
      error: "Coluna inválida na fórmula: nope",
      warnings: [],
    });
    expect(
      validateFormulaForContext(
        f(ref("value"), { kind: "op", op: "*" }, { kind: "const", value: 2 }),
        { kind: "record", catalog }
      )
    ).toEqual({ ok: true, warnings: [] });
  });
});

describe("contexto 'aggregate'", () => {
  const catalog = [
    { ref: "agg:sum:value", label: "Σ Valor", group: "Registros" },
    { ref: "agg:min:value@deals", label: "Mín Valor · Deals", group: "Registros · Deals" },
    { ref: "agg:sum:value@leads_ilike", label: "Σ Valor · Ilike", group: "Registros · Ilike" },
    { ref: "value", label: "Valor", group: "Campos (SOMASE/MÉDIASE)" },
  ];

  it("erro de colocação do validateCondAggRefs é propagado", () => {
    const out = validateFormulaForContext(f(ref("value")), {
      kind: "aggregate",
      catalog,
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("só pode aparecer dentro de SOMASE/CONT.SE/MÉDIASE");
  });

  it("warning de escopo: Mín/Máx @fonte não abaixável", () => {
    const out = validateFormulaForContext(f(ref("agg:min:value@deals")), {
      kind: "aggregate",
      catalog,
      sources: SOURCES,
    });
    expect(out.ok).toBe(true);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain("Mín/Máx não têm forma com escopo");
  });

  it("warning de escopo: sub-base com filtro inexpressável (ilike)", () => {
    const out = validateFormulaForContext(
      f(ref("agg:sum:value@leads_ilike")),
      { kind: "aggregate", catalog, sources: SOURCES }
    );
    expect(out.ok).toBe(true);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain("não é expressável");
  });

  it("sem ctx.sources não há warnings de escopo; fórmula limpa passa limpa", () => {
    expect(
      validateFormulaForContext(f(ref("agg:min:value@deals")), {
        kind: "aggregate",
        catalog,
      }).warnings
    ).toEqual([]);
    expect(
      validateFormulaForContext(f(ref("agg:sum:value")), {
        kind: "aggregate",
        catalog,
        sources: SOURCES,
      })
    ).toEqual({ ok: true, warnings: [] });
  });
});
