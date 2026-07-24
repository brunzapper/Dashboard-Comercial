// Versão: 1.0 | Data: 24/07/2026
// Testes do parser/avaliador de fórmulas (o coração dos campos calculados).
// Invariantes duras: null-safe (operando ausente/div. por zero → null, NUNCA
// 0); truthiness/comparações pt-BR tolerantes a tipos; `data − data` → dias;
// e `condAggKey` SEM escopo byte-idêntica ao formato histórico de 3 elementos
// (as chaves ficam persistidas em basis/contextos — mudar o formato quebraria
// widgets salvos).
import { describe, expect, it } from "vitest";

import {
  buildDateContext,
  computeFormulaFields,
  condAggKey,
  customDateKeysFromRows,
  evalCondition,
  evaluateFormula,
  formulaCondAggInfo,
  formulaComparisonBases,
  formulaDefsFromRows,
  validateFormula,
  type Formula,
  type FormulaFuncName,
  type FormulaToken,
} from "@/lib/records/formulas";

// Helpers de montagem de tokens (o construtor de botões emite este shape).
const f = (...tokens: FormulaToken[]): Formula => ({ tokens });
const ref = (r: string): FormulaToken => ({ kind: "field", ref: r });
const num = (v: number): FormulaToken => ({ kind: "const", value: v });
const str = (v: string): FormulaToken => ({ kind: "str", value: v });
const op = (o: "+" | "-" | "*" | "/"): FormulaToken => ({ kind: "op", op: o });
const cmp = (o: "=" | "<>" | "<" | ">" | "<=" | ">="): FormulaToken => ({
  kind: "cmp",
  op: o,
});
const fn = (name: FormulaFuncName): FormulaToken => ({ kind: "func", name });
const lp: FormulaToken = { kind: "lparen" };
const rp: FormulaToken = { kind: "rparen" };
const sep: FormulaToken = { kind: "argsep" };

describe("aritmética legada", () => {
  it("precedência e parênteses", () => {
    expect(evaluateFormula(f(num(2), op("+"), num(3), op("*"), num(4)), {})).toBe(
      14
    );
    expect(
      evaluateFormula(f(lp, num(2), op("+"), num(3), rp, op("*"), num(4)), {})
    ).toBe(20);
    expect(evaluateFormula(f(op("-"), num(2), op("*"), num(3)), {})).toBe(-6);
  });

  it("divisão por zero e operando ausente → null (nunca 0)", () => {
    expect(evaluateFormula(f(num(10), op("/"), num(0)), {})).toBeNull();
    expect(
      evaluateFormula(f(ref("value"), op("+"), num(1)), { value: null })
    ).toBeNull();
    expect(evaluateFormula(f(ref("value"), op("+"), num(1)), {})).toBeNull();
    expect(
      evaluateFormula(f(ref("value"), op("+"), num(1)), { value: "abc" })
    ).toBeNull();
  });

  it("string numérica opera como número", () => {
    expect(
      evaluateFormula(f(ref("value"), op("*"), num(2)), { value: "10" })
    ).toBe(20);
  });
});

describe("SE / E / OU e truthiness pt-BR", () => {
  it("SE com comparação tolerante (trim + minúsculas)", () => {
    const cond = f(
      fn("SE"),
      lp,
      ref("stage"),
      cmp("="),
      str("ganho"),
      sep,
      num(1),
      sep,
      num(0),
      rp
    );
    expect(evaluateFormula(cond, { stage: " GANHO " })).toBe(1);
    expect(evaluateFormula(cond, { stage: "perdido" })).toBe(0);
  });

  it("SE sem 3º argumento e condição falsa → null", () => {
    expect(
      evaluateFormula(f(fn("SE"), lp, num(0), sep, num(1), rp), {})
    ).toBeNull();
  });

  it("null é falso; 'SIM'/'VERDADEIRO' verdadeiros; '0' falso", () => {
    const se = (v: unknown) =>
      evaluateFormula(f(fn("SE"), lp, ref("x"), sep, num(1), sep, num(2), rp), {
        x: v,
      });
    expect(se(null)).toBe(2);
    expect(se("SIM")).toBe(1);
    expect(se("VERDADEIRO")).toBe(1);
    expect(se("NÃO")).toBe(2);
    expect(se("0")).toBe(2);
    expect(se("7")).toBe(1);
  });

  it("E exige todos; OU basta um", () => {
    expect(
      evaluateFormula(
        f(fn("E"), lp, num(1), sep, str("SIM"), rp),
        {}
      )
    ).toBe(true);
    expect(
      evaluateFormula(f(fn("E"), lp, num(1), sep, num(0), rp), {})
    ).toBe(false);
    expect(
      evaluateFormula(f(fn("OU"), lp, num(0), sep, str("x"), rp), {})
    ).toBe(false);
    expect(
      evaluateFormula(f(fn("OU"), lp, num(0), sep, num(3), rp), {})
    ).toBe(true);
  });
});

describe("comparações", () => {
  it("número × string numérica; null ≡ ''", () => {
    expect(
      evaluateFormula(f(ref("a"), cmp("="), num(10)), { a: "10" })
    ).toBe(true);
    expect(
      evaluateFormula(f(ref("a"), cmp("="), ref("b")), { a: "", b: null })
    ).toBe(true);
  });

  it("comparação encadeada é erro de parse (avalia null; valida com mensagem)", () => {
    const chained = f(num(1), cmp("<"), num(2), cmp("<"), num(3));
    expect(evaluateFormula(chained, {})).toBeNull();
    const v = validateFormula(chained, new Set());
    expect(v.ok).toBe(false);
    expect(v.error).toContain("Comparações encadeadas");
  });

  it("validateFormula acusa ref fora do catálogo", () => {
    const v = validateFormula(f(ref("nope")), new Set(["value"]));
    expect(v).toEqual({ ok: false, error: "Coluna inválida na fórmula: nope" });
    expect(validateFormula(f(ref("value")), new Set(["value"])).ok).toBe(true);
  });
});

describe("datas (dateCtx)", () => {
  const D = 86_400_000;
  const dateCtx = { closed_at: 10 * D, "custom:inicio": 3 * D };

  it("data − data → dias inteiros; data + número → null", () => {
    expect(
      evaluateFormula(
        f(ref("closed_at"), op("-"), ref("custom:inicio")),
        {},
        dateCtx
      )
    ).toBe(7);
    expect(
      evaluateFormula(f(ref("closed_at"), op("+"), num(1)), {}, dateCtx)
    ).toBeNull();
  });

  it("datas comparam cronologicamente; resultado 'cru' de data → null", () => {
    expect(
      evaluateFormula(
        f(ref("closed_at"), cmp(">"), ref("custom:inicio")),
        {},
        dateCtx
      )
    ).toBe(true);
    expect(evaluateFormula(f(ref("closed_at")), {}, dateCtx)).toBeNull();
  });

  it("buildDateContext monta refs de núcleo + custom + today", () => {
    const ctx = buildDateContext(
      { closed_at: "2026-07-17T12:30:00-03:00" },
      { inicio: "2026-07-10" },
      ["inicio"]
    );
    expect(ctx.closed_at).toBe(Date.parse("2026-07-17T12:30:00-03:00"));
    expect(ctx["custom:inicio"]).toBe(Date.parse("2026-07-10"));
    expect(ctx.opened_at).toBeNull();
    expect(typeof ctx.today).toBe("number");
  });
});

describe("funções puras (v2.2)", () => {
  it("agregadoras ignoram não-números; MÉDIA sem números → null", () => {
    expect(
      evaluateFormula(f(fn("SOMA"), lp, num(1), sep, str("x"), sep, num(2), rp), {})
    ).toBe(3);
    expect(evaluateFormula(f(fn("MÉDIA"), lp, str("x"), rp), {})).toBeNull();
    expect(
      evaluateFormula(f(fn("MÍN"), lp, num(3), sep, num(1), sep, num(2), rp), {})
    ).toBe(1);
    expect(
      evaluateFormula(f(fn("CONT.NÚM"), lp, str("a"), sep, num(1), sep, num(2), rp), {})
    ).toBe(2);
    expect(
      evaluateFormula(
        f(fn("CONT.VALORES"), lp, str("a"), sep, str(""), sep, num(1), rp),
        {}
      )
    ).toBe(2);
  });

  it("ARRED/ABS/CONCATENAR", () => {
    expect(
      evaluateFormula(f(fn("ARRED"), lp, num(3.14159), sep, num(2), rp), {})
    ).toBe(3.14);
    expect(evaluateFormula(f(fn("ABS"), lp, op("-"), num(5), rp), {})).toBe(5);
    expect(
      evaluateFormula(
        f(fn("CONCATENAR"), lp, str("a"), sep, ref("x"), sep, { kind: "bool", value: true }, rp),
        {}
      )
    ).toBe("aVERDADEIRO");
  });

  it("aridade é validada (ABS com 2 args)", () => {
    const bad = f(fn("ABS"), lp, num(1), sep, num(2), rp);
    expect(validateFormula(bad, new Set()).ok).toBe(false);
    expect(evaluateFormula(bad, {})).toBeNull();
  });
});

describe("agregações condicionais (chaves de basis)", () => {
  const COND: FormulaToken[] = [ref("stage"), cmp("="), str("ganho")];

  it("condAggKey SEM escopo é byte-idêntica ao formato histórico (3 elementos)", () => {
    const key = condAggKey({
      agg: "sum",
      field: "value",
      conds: [{ ref: "stage", op: "=", value: "ganho" }],
    });
    expect(key).toBe('aggif:["sum","value",[["stage","=","ganho"]]]');
  });

  it("com escopo entra o 4º elemento; valor ausente vira null", () => {
    expect(
      condAggKey({
        agg: "count",
        field: "*",
        conds: [{ ref: "custom:etapa", op: "not_null" }],
        scope: "leads_lite",
      })
    ).toBe('aggif:["count","*",[["custom:etapa","not_null",null]],"leads_lite"]');
  });

  it("formulaCondAggInfo separa alvo/condições de plainRefs", () => {
    const formula = f(
      ref("mrr"),
      op("+"),
      fn("SOMASE"),
      lp,
      ref("value"),
      sep,
      ...COND,
      rp
    );
    const info = formulaCondAggInfo(formula);
    expect(info.specs).toEqual([
      {
        agg: "sum",
        field: "value",
        conds: [{ ref: "stage", op: "=", value: "ganho" }],
      },
    ]);
    expect(info.targetRefs).toEqual(["value"]);
    expect(info.condRefs).toEqual(["stage"]);
    expect(info.plainRefs).toEqual(["mrr"]);
  });

  it("MÉDIASE gera specs de soma E contagem; avalia soma÷contagem do contexto", () => {
    const formula = f(fn("MÉDIASE"), lp, ref("value"), sep, ...COND, rp);
    const info = formulaCondAggInfo(formula);
    expect(info.specs.map((s) => s.agg)).toEqual(["sum", "count"]);
    const ctx = {
      [condAggKey(info.specs[0])]: 90,
      [condAggKey(info.specs[1])]: 3,
    };
    expect(evaluateFormula(formula, ctx)).toBe(30);
    // Contagem 0 → null (não divide).
    expect(
      evaluateFormula(formula, { ...ctx, [condAggKey(info.specs[1])]: 0 })
    ).toBeNull();
  });

  it("fórmula inválida → inventário vazio", () => {
    const info = formulaCondAggInfo(f(fn("SOMASE"), lp, num(1), rp));
    expect(info).toEqual({
      specs: [],
      targetRefs: [],
      condRefs: [],
      plainRefs: [],
    });
  });
});

describe("evalCondition (espelho dos ops *_num da 0050)", () => {
  it("igualdade tolerante: número×string, trim+minúsculas, null ≡ ''", () => {
    expect(evalCondition("10", "=", 10)).toBe(true);
    expect(evalCondition(" GANHO ", "=", "ganho")).toBe(true);
    expect(evalCondition("", "<>", "x")).toBe(true);
    expect(evalCondition(null, "=", "")).toBe(true);
  });

  it("ordenação com literal NUMÉRICO não usa fallback textual", () => {
    // Divergência documentada do SE: "abc" > 10 seria true por localeCompare.
    expect(evalCondition("abc", ">", 10)).toBe(false);
    expect(evalCondition("15", ">", 10)).toBe(true);
    expect(evalCondition("abd", ">", "abc")).toBe(true);
  });
});

describe("comparação de período (ANTERIOR/VARPCT/VARABS)", () => {
  const mrr = f(fn("VARPCT"), lp, ref("custom:mrr"), rp);

  it("lê o contexto alternativo da base; VARPCT sai ×100; base 0 → null", () => {
    const cmpCtxs = { anterior: { "custom:mrr": 80 } };
    expect(evaluateFormula(mrr, { "custom:mrr": 100 }, undefined, cmpCtxs)).toBe(
      25
    );
    expect(
      evaluateFormula(
        mrr,
        { "custom:mrr": 100 },
        undefined,
        { anterior: { "custom:mrr": 0 } }
      )
    ).toBeNull();
    // Sem contexto de comparação (campo por registro) → null.
    expect(evaluateFormula(mrr, { "custom:mrr": 100 })).toBeNull();
  });

  it("ANTERIOR/VARABS e a base explícita 'ano'", () => {
    const anterior = f(fn("ANTERIOR"), lp, ref("x"), sep, str("ano"), rp);
    expect(
      evaluateFormula(anterior, { x: 5 }, undefined, { ano: { x: 3 } })
    ).toBe(3);
    const varabs = f(fn("VARABS"), lp, ref("x"), rp);
    expect(
      evaluateFormula(varabs, { x: 5 }, undefined, { anterior: { x: 3 } })
    ).toBe(2);
  });

  it("formulaComparisonBases: default 'anterior', explícito 'ano', inválida []", () => {
    expect(formulaComparisonBases(f(fn("VARPCT"), lp, ref("x"), rp))).toEqual([
      "anterior",
    ]);
    expect(
      formulaComparisonBases(f(fn("ANTERIOR"), lp, ref("x"), sep, str("ano"), rp))
    ).toEqual(["ano"]);
    expect(formulaComparisonBases(f(fn("VARPCT"), lp))).toEqual([]);
  });
});

describe("computeFormulaFields", () => {
  it("aninhamento avalia em ordem topológica (independe da ordem dos defs)", () => {
    const defs = [
      // b depende de a — passado ANTES de a de propósito.
      { field_key: "b", formula: f(ref("custom:a"), op("+"), num(1)) },
      { field_key: "a", formula: f(ref("value"), op("*"), num(2)) },
    ];
    const out = computeFormulaFields({ value: 10 }, {}, defs);
    expect(out).toEqual({ a: 20, b: 21 });
  });

  it("ciclo residual materializa null (nunca loop)", () => {
    const defs = [
      { field_key: "a", formula: f(ref("custom:b"), op("+"), num(1)) },
      { field_key: "b", formula: f(ref("custom:a"), op("+"), num(1)) },
    ];
    expect(computeFormulaFields({}, {}, defs)).toEqual({ a: null, b: null });
  });

  it("allow_negative=false grampeia em 0; null permanece null", () => {
    const defs = [
      {
        field_key: "c",
        formula: f(ref("value"), op("-"), num(20)),
        allow_negative: false,
      },
      { field_key: "d", formula: f(ref("mrr"), op("+"), num(1)), allow_negative: false },
    ];
    expect(computeFormulaFields({ value: 10 }, {}, defs)).toEqual({
      c: 0,
      d: null,
    });
  });

  it("ref match: não resolvido PULA o def e seus dependentes", () => {
    const defs = [
      {
        field_key: "casado",
        formula: f(ref("match:deals:value"), op("*"), num(2)),
      },
      { field_key: "dep", formula: f(ref("custom:casado"), op("+"), num(1)) },
      { field_key: "livre", formula: f(num(7)) },
    ];
    const out = computeFormulaFields({ value: 1 }, {}, defs);
    expect(out).toEqual({ livre: 7 });
  });
});

describe("builders *FromRows (linhas core fora; NULL fica)", () => {
  const rows = [
    { field_key: "closed_at", data_type: "data", source_system: "core" },
    { field_key: "inicio", data_type: "data", source_system: null },
    { field_key: "uf_data", data_type: "data", source_system: "bitrix" },
    {
      field_key: "calc",
      data_type: "calculado",
      formula: f(num(1)),
      source_system: null,
    },
    { field_key: "calc_core", data_type: "calculado", source_system: "core" },
    { field_key: "sem_formula", data_type: "calculado", source_system: null },
  ];

  it("customDateKeysFromRows / formulaDefsFromRows", () => {
    expect(customDateKeysFromRows(rows)).toEqual(["inicio", "uf_data"]);
    const defs = formulaDefsFromRows(rows);
    expect(defs.map((d) => d.field_key)).toEqual(["calc"]);
    expect(defs[0].allow_negative).toBe(true);
  });
});
