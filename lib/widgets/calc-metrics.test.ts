// Versão: 1.0 | Data: 24/07/2026
// Testes das métricas calculadas de agregados. Invariantes: o operando com
// escopo de fonte (`agg:…@<fonte>`) é ABAIXADO para a chave `aggif:` (com o 4º
// elemento `scope`) — e, quando NÃO abaixável (min/max, sub inexpressável), o
// ref degrada para operando AUSENTE, nunca para a basis SEM escopo; basis é
// fold aditivo exato (avg = sum/count em qualquer nível); moedas diferentes
// nunca operam entre si.
import { describe, expect, it } from "vitest";

import { condAggKey, type Formula, type FormulaToken } from "@/lib/records/formulas";
import { BUILTIN_SOURCES, type SourceDef } from "@/lib/sources";
import {
  basisKeysFor,
  condFilters,
  evalCalcMoney,
  foldBasis,
  lowerSourceScopedOperands,
  parseAggRef,
  parseCondBasisKey,
  recordMatchesConds,
  resolveCalcMetric,
  siblingScopedBasisKeys,
  sourceScopeConds,
  validateCondAggRefs,
  zeroSiblingScopedOperands,
  zeroSiblingScopesInFields,
  type BasisValues,
} from "@/lib/widgets/calc-metrics";
import type { MoneyBreakdown } from "@/lib/widgets/currency";
import type { Metric } from "@/lib/widgets/types";

const ref = (r: string): FormulaToken => ({ kind: "field", ref: r });
const f = (...tokens: FormulaToken[]): Formula => ({ tokens });

const CATALOG: SourceDef[] = [
  ...BUILTIN_SOURCES,
  {
    key: "leads_lite",
    recordType: "lead",
    label: "Leads / Clientes Lite",
    shortLabel: "Lite",
    defaultPeriodField: "custom:data_lite",
    builtin: false,
    manualEntry: false,
    parentKey: "leads",
    filter: [{ field: "pipeline", op: "eq", value: "Lite" }],
  },
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

const bd = (
  perCurrency: Record<string, number>,
  brl: number
): MoneyBreakdown => ({
  perCurrency,
  brl,
  usd: 0,
  count: Object.keys(perCurrency).length,
});

describe("parseAggRef", () => {
  it("field pode conter ':' e o escopo é o ÚLTIMO '@'", () => {
    expect(parseAggRef("agg:sum:custom:forecast")).toEqual({
      agg: "sum",
      field: "custom:forecast",
    });
    expect(parseAggRef("agg:sum:value@estudo")).toEqual({
      agg: "sum",
      field: "value",
      source: "estudo",
    });
    expect(parseAggRef("agg:count:custom:a@b@leads_lite")).toEqual({
      agg: "count",
      field: "custom:a@b",
      source: "leads_lite",
    });
  });

  it("agg:count sem campo → '*'; '@' final vazio → sem escopo", () => {
    expect(parseAggRef("agg:count")).toEqual({ agg: "count", field: "*" });
    expect(parseAggRef("agg:sum:value@")).toEqual({ agg: "sum", field: "value" });
  });
});

describe("sourceScopeConds", () => {
  it("raiz → só record_type; sub → record_type + predicado", () => {
    expect(sourceScopeConds("deals", CATALOG)).toEqual([
      { ref: "record_type", op: "=", value: "negocio" },
    ]);
    expect(sourceScopeConds("leads_lite", CATALOG)).toEqual([
      { ref: "record_type", op: "=", value: "lead" },
      { ref: "pipeline", op: "=", value: "Lite" },
    ]);
  });

  it("predicado inexpressável (ilike / in vazio) → null", () => {
    expect(sourceScopeConds("leads_ilike", CATALOG)).toBeNull();
    const inVazio: SourceDef[] = [
      ...CATALOG.filter((s) => s.key !== "leads_lite"),
      {
        ...CATALOG.find((s) => s.key === "leads_lite")!,
        filter: [{ field: "pipeline", op: "in", value: [] }],
      },
    ];
    expect(sourceScopeConds("leads_lite", inVazio)).toBeNull();
  });

  it("in com lista e is_null/not_null são expressáveis", () => {
    const subs: SourceDef[] = [
      ...BUILTIN_SOURCES,
      {
        key: "s",
        recordType: "lead",
        label: "S",
        shortLabel: "S",
        defaultPeriodField: "source_created_at",
        builtin: false,
        manualEntry: false,
        parentKey: "leads",
        filter: [
          { field: "pipeline", op: "in", value: ["A", "B"] },
          { field: "custom:etapa", op: "not_null" },
        ],
      },
    ];
    expect(sourceScopeConds("s", subs)).toEqual([
      { ref: "record_type", op: "=", value: "lead" },
      { ref: "pipeline", op: "in", value: ["A", "B"] },
      { ref: "custom:etapa", op: "not_null" },
    ]);
  });
});

describe("lowerSourceScopedOperands", () => {
  it("fórmula sem operando escopado volta o MESMO objeto (fast path)", () => {
    const plain = f(ref("agg:sum:value"));
    expect(lowerSourceScopedOperands(plain, CATALOG)).toBe(plain);
  });

  it("sum@sub vira token aggif: com scope na chave", () => {
    const out = lowerSourceScopedOperands(
      f(ref("agg:sum:value@leads_lite")),
      CATALOG
    );
    expect(out.tokens).toEqual([
      {
        kind: "field",
        ref: condAggKey({
          agg: "sum",
          field: "value",
          conds: sourceScopeConds("leads_lite", CATALOG)!,
          scope: "leads_lite",
        }),
      },
    ]);
  });

  it("avg@fonte vira ( sum / count ) com parênteses", () => {
    const out = lowerSourceScopedOperands(f(ref("agg:avg:mrr@deals")), CATALOG);
    expect(out.tokens.map((t) => t.kind)).toEqual([
      "lparen",
      "field",
      "op",
      "field",
      "rparen",
    ]);
    const conds = sourceScopeConds("deals", CATALOG)!;
    expect(out.tokens[1]).toEqual({
      kind: "field",
      ref: condAggKey({ agg: "sum", field: "mrr", conds, scope: "deals" }),
    });
    expect(out.tokens[3]).toEqual({
      kind: "field",
      ref: condAggKey({ agg: "count", field: "mrr", conds, scope: "deals" }),
    });
  });

  it("min/max ou sub inexpressável mantém o token intacto", () => {
    const minRef = f(ref("agg:min:value@deals"));
    expect(lowerSourceScopedOperands(minRef, CATALOG).tokens).toEqual(
      minRef.tokens
    );
    const ilike = f(ref("agg:sum:value@leads_ilike"));
    expect(lowerSourceScopedOperands(ilike, CATALOG).tokens).toEqual(
      ilike.tokens
    );
  });
});

describe("basisKeysFor", () => {
  it("avg pede sum E count; aggif: entra como chave literal", () => {
    const key = condAggKey({
      agg: "sum",
      field: "value",
      conds: [{ ref: "stage", op: "=", value: "ganho" }],
    });
    expect(basisKeysFor(f(ref("agg:avg:value"), { kind: "op", op: "+" }, ref(key)))).toEqual([
      "sum:value",
      "count:value",
      key,
    ]);
  });

  it("ref escopado NÃO abaixado não gera NENHUMA chave (nunca a sem escopo)", () => {
    expect(basisKeysFor(f(ref("agg:sum:value@leads_ilike")))).toEqual([]);
    expect(basisKeysFor(f(ref("agg:min:value@deals")))).toEqual([]);
  });
});

describe("parseCondBasisKey / condFilters (round-trip)", () => {
  it("round-trip com condAggKey, incl. scope e is_null sem value", () => {
    const spec = {
      agg: "count" as const,
      field: "*",
      conds: [
        { ref: "custom:etapa", op: "is_null" as const },
        { ref: "pipeline", op: "in" as const, value: ["A", "B"] },
      ],
      scope: "leads_lite",
    };
    const parsed = parseCondBasisKey(condAggKey(spec));
    expect(parsed).toEqual({
      metric: { field: "*", agg: "count" },
      conds: spec.conds,
      scope: "leads_lite",
    });
    expect(parseCondBasisKey("sum:value")).toBeNull();
    expect(parseCondBasisKey("aggif:lixo")).toBeNull();
  });

  it("condFilters: literal numérico → *_num; booleano → eq_ci 'true'", () => {
    expect(
      condFilters([
        { ref: "value", op: ">", value: 1000 },
        { ref: "custom:ok", op: "=", value: true },
        { ref: "stage", op: "<>", value: "ganho" },
        { ref: "custom:d", op: ">=", value: "2026-01-01" },
        { ref: "pipeline", op: "in", value: ["A"] },
        { ref: "custom:x", op: "is_null" },
      ])
    ).toEqual([
      { field: "value", op: "gt_num", value: 1000 },
      { field: "custom:ok", op: "eq_ci", value: "true" },
      { field: "stage", op: "neq_ci", value: "ganho" },
      { field: "custom:d", op: "gte", value: "2026-01-01" },
      { field: "pipeline", op: "in", value: ["A"] },
      { field: "custom:x", op: "is_null" },
    ]);
  });

  it("recordMatchesConds: in exige igualdade textual e null nunca casa", () => {
    const rec: Record<string, unknown> = { pipeline: "A", stage: " GANHO " };
    const raw = (r: string) => rec[r];
    expect(
      recordMatchesConds(raw, [
        { ref: "pipeline", op: "in", value: ["A", "B"] },
        { ref: "stage", op: "=", value: "ganho" },
      ])
    ).toBe(true);
    expect(
      recordMatchesConds(raw, [{ ref: "faltando", op: "in", value: ["A"] }])
    ).toBe(false);
    expect(recordMatchesConds(raw, [{ ref: "faltando", op: "is_null" }])).toBe(
      true
    );
  });
});

describe("foldBasis", () => {
  it("soma ignorando null; chave só com null → null", () => {
    expect(
      foldBasis([
        { "sum:value": 10, "count:*": 2, "sum:mrr": null },
        undefined,
        { "sum:value": 5, "sum:mrr": null },
      ])
    ).toEqual({ "sum:value": 15, "count:*": 2, "sum:mrr": null });
  });

  it("MoneyBreakdown funde por moeda e prevalece sobre número", () => {
    const out = foldBasis([
      { "sum:value": bd({ BRL: 10 }, 10) },
      { "sum:value": 99 }, // payload antigo na mesma chave: ignorado
      { "sum:value": bd({ USD: 2 }, 12) },
    ]);
    const v = out["sum:value"] as MoneyBreakdown;
    expect(v.perCurrency).toEqual({ BRL: 10, USD: 2 });
    expect(v.brl).toBe(22);
  });
});

describe("evalCalcMoney", () => {
  const razao = f(
    ref("agg:sum:value"),
    { kind: "op", op: "/" },
    ref("agg:count:*")
  );

  it("uma moeda só → soma crua e moeda preservada (modo auto)", () => {
    const basis: BasisValues = {
      "sum:value": bd({ USD: 100 }, 550),
      "count:*": 4,
    };
    expect(evalCalcMoney(razao, basis, { mode: "auto" })).toEqual({
      value: 25,
      currency: "USD",
    });
  });

  it("moedas misturadas → avalia no convertido (.brl) e sai BRL", () => {
    const basis: BasisValues = {
      "sum:value": bd({ USD: 100, BRL: 50 }, 600),
      "count:*": 4,
    };
    expect(evalCalcMoney(razao, basis, { mode: "auto" })).toEqual({
      value: 150,
      currency: "BRL",
    });
  });

  it("modo fixed converte o resultado misto pela fixedRate", () => {
    const basis: BasisValues = {
      "sum:value": bd({ USD: 100, BRL: 50 }, 600),
      "count:*": 1,
    };
    expect(
      evalCalcMoney(razao, basis, { mode: "fixed", code: "USD", fixedRate: 5 })
    ).toEqual({ value: 120, currency: "USD" });
    // Sem taxa: mantém BRL.
    expect(
      evalCalcMoney(razao, basis, { mode: "fixed", code: "USD" })
    ).toEqual({ value: 600, currency: "BRL" });
  });

  it("avg com count 0 → null (nunca divisão por zero)", () => {
    expect(
      evalCalcMoney(f(ref("agg:avg:value")), { "sum:value": 10, "count:value": 0 }, { mode: "none" })
    ).toEqual({ value: null, currency: null });
  });

  it("allowNegative=false grampeia em 0; escopo não abaixado → null", () => {
    expect(
      evalCalcMoney(
        f(ref("agg:sum:value"), { kind: "op", op: "-" }, { kind: "const", value: 20 }),
        { "sum:value": 10 },
        { mode: "none", allowNegative: false }
      ).value
    ).toBe(0);
    expect(
      evalCalcMoney(
        f(ref("agg:sum:value@leads_ilike")),
        { "sum:value": 10 },
        { mode: "none" }
      ).value
    ).toBeNull();
  });
});

describe("resolveCalcMetric / validateCondAggRefs", () => {
  it("def ausente ou sem fórmula → formula null (avalia p/ '—')", () => {
    const m = { field: "custom:sumido", agg: "sum" } as Metric;
    expect(resolveCalcMetric(m, new Map()).formula).toBeNull();
  });

  it("ad-hoc: expande e abaixa o escopo nos mesmos choke points", () => {
    const m = {
      field: "calc:formula",
      agg: "sum",
      formula: f(ref("agg:sum:value@leads_lite")),
    } as unknown as Metric;
    const r = resolveCalcMetric(m, new Map(), CATALOG);
    expect(r.formula?.tokens[0]).toEqual({
      kind: "field",
      ref: condAggKey({
        agg: "sum",
        field: "value",
        conds: sourceScopeConds("leads_lite", CATALOG)!,
        scope: "leads_lite",
      }),
    });
    expect(r.mode).toBe("none");
  });

  it("validateCondAggRefs: today → mensagem dedicada; ref cru fora → erro", () => {
    const catalog = [
      { ref: "value", label: "Valor", group: "Campos (SOMASE/MÉDIASE)" },
      { ref: "stage", label: "Etapa", group: "Condições (SOMASE/CONT.SE)" },
      { ref: "custom:tot", label: "Total", group: "Calculados (totais)" },
    ];
    expect(
      validateCondAggRefs(f(ref("today")), catalog).error
    ).toContain('"Data atual" não funciona em fórmulas agregadas');
    expect(
      validateCondAggRefs(f(ref("value")), catalog).error
    ).toContain("só pode aparecer dentro de SOMASE/CONT.SE/MÉDIASE");
    // Ref aninhado (grupo Calculados) e agg:/aggif: fora → ok.
    expect(validateCondAggRefs(f(ref("custom:tot")), catalog).ok).toBe(true);
    expect(validateCondAggRefs(f(ref("agg:sum:value")), catalog).ok).toBe(true);
  });
});

describe("zeroing de operandos de fonte-irmã (pernas de sub-base)", () => {
  // Catálogo com DUAS subs da mesma pai (dispara o multi-perna no engine).
  const CATALOG_SUBS: SourceDef[] = [
    ...CATALOG,
    {
      key: "leads_sql",
      recordType: "lead",
      label: "Leads / SQLs",
      shortLabel: "SQLs",
      defaultPeriodField: "custom:data_sql",
      builtin: false,
      manualEntry: false,
      parentKey: "leads",
      filter: [{ field: "stage", op: "eq", value: "SQL" }],
    },
  ];
  const siblings = new Set(["leads_sql"]);

  it("sum/count de irmã vira literal 0; própria fonte e refs bare ficam", () => {
    const out = zeroSiblingScopedOperands(
      f(
        ref("agg:count:*@leads_lite"),
        { kind: "op", op: "+" },
        ref("agg:count:*@leads_sql"),
        { kind: "op", op: "+" },
        ref("agg:count:*")
      ),
      siblings
    );
    expect(out.tokens).toEqual([
      { kind: "field", ref: "agg:count:*@leads_lite" },
      { kind: "op", op: "+" },
      { kind: "const", value: 0 },
      { kind: "op", op: "+" },
      { kind: "field", ref: "agg:count:*" },
    ]);
  });

  it("avg de irmã vira (0/0) → null (nunca 0 falso); min/max ficam", () => {
    const out = zeroSiblingScopedOperands(
      f(
        ref("agg:avg:value@leads_sql"),
        { kind: "op", op: "+" },
        ref("agg:min:value@leads_sql")
      ),
      siblings
    );
    expect(out.tokens).toEqual([
      { kind: "lparen" },
      { kind: "const", value: 0 },
      { kind: "op", op: "/" },
      { kind: "const", value: 0 },
      { kind: "rparen" },
      { kind: "op", op: "+" },
      { kind: "field", ref: "agg:min:value@leads_sql" },
    ]);
    // Avaliação: (0/0) cai na guarda de divisão por zero → null.
    expect(evalCalcMoney(out, {}, { mode: "none" }).value).toBeNull();
  });

  it("chave aggif: JÁ abaixada com scope de irmã também zera", () => {
    const key = condAggKey({
      agg: "count",
      field: "*",
      conds: [{ ref: "record_type", op: "=", value: "lead" }],
      scope: "leads_sql",
    });
    expect(zeroSiblingScopedOperands(f(ref(key)), siblings).tokens).toEqual([
      { kind: "const", value: 0 },
    ]);
  });

  it("fast path: sem token afetado devolve o MESMO objeto", () => {
    const orig = f(ref("agg:count:*@leads_lite"), ref("agg:count:*"));
    expect(zeroSiblingScopedOperands(orig, siblings)).toBe(orig);
  });

  it("zeroSiblingScopesInFields: só defs 'calculado_agg' afetadas clonam", () => {
    const defs = [
      {
        field_key: "tot",
        data_type: "calculado_agg",
        formula: f(ref("agg:count:*@leads_sql")),
      },
      { field_key: "txt", data_type: "texto" },
    ] as unknown as Parameters<typeof zeroSiblingScopesInFields>[0];
    const out = zeroSiblingScopesInFields(defs, siblings);
    expect(out).not.toBe(defs);
    expect(out[0].formula?.tokens).toEqual([{ kind: "const", value: 0 }]);
    expect(out[1]).toBe(defs[1]);
    const clean = [defs[1]];
    expect(zeroSiblingScopesInFields(clean, siblings)).toBe(clean);
  });

  it("siblingScopedBasisKeys: só as chaves aggif do escopo de irmã", () => {
    const rc = resolveCalcMetric(
      {
        field: "calc:formula",
        agg: "sum",
        calc: true,
        formula: f(
          ref("agg:count:*@leads_lite"),
          { kind: "op", op: "+" },
          ref("agg:count:*@leads_sql")
        ),
      } as Metric,
      new Map(),
      CATALOG_SUBS
    );
    const keys = siblingScopedBasisKeys(rc.formula!, siblings);
    expect(keys).toHaveLength(1);
    expect(keys[0].startsWith("aggif:")).toBe(true);
    expect(keys[0]).toContain("leads_sql");
  });
});
