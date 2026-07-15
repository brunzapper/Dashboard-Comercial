// Versão: 2.1 | Data: 15/07/2026
// v2.1 (15/07/2026): ResolvedCalcMetric.percent — resultado percentual (campo
//   calculado_agg com show_as_percent ou Metric.resultPercent do ad-hoc).
// Métricas calculadas de AGREGADOS: fórmulas cujos operandos são agregações de
// registros (refs agg:sum|avg|count:<campo>), usáveis como métrica normal de
// widget — avaliadas por grupo (linha do RPC), subtotal e Total geral.
//
// Conceito central — "basis": subtotal de uma razão não é a soma da coluna, é a
// fórmula reavaliada sobre os operandos do escopo. Como média não é combinável
// por soma, toda fórmula é reduzida a uma base canônica só de somas/contagens:
//   agg:sum:f   → basis 'sum:f'
//   agg:count:f → basis 'count:f'   (agg:count:* → 'count:*')
//   agg:avg:f   → basis 'sum:f' E 'count:f' (avg = sum/count em qualquer nível)
// Cada linha (grupo) carrega sua basis em WidgetRow.__calcOps; subtotais fundem
// as basis (foldBasis) e reavaliam (evalCalcMoney) — exato em todos os níveis,
// inclusive Total geral.
//
// Moeda (v2.0, 14/07/2026): operandos monetários carregam um MoneyBreakdown
// (soma por moeda + convertido p/ Real pela taxa do período de cada registro)
// no lugar do número cru. Regra: moedas diferentes nunca operam entre si —
//  - modo automático ('inherit'): recorte com UMA moeda → avalia as somas cruas
//    e o resultado preserva essa moeda; misturou → avalia sobre os valores
//    convertidos (.brl) e o resultado é BRL.
//  - modo fixo: tudo já na moeda fixa → cru; senão avalia em BRL e converte o
//    RESULTADO para a moeda fixa pela taxa do período do dashboard (fixedRate,
//    pré-computada no servidor — o client não tem as taxas).
//  - sem moeda: soma crua (número puro, comportamento v1).
// Basis numérica (payload antigo / degradação sem a consulta auxiliar) continua
// funcionando: opera nos números crus como na v1.
//
// Módulo puro/client-safe: importado pelo engine (server), pela página do
// dashboard (RSC) e pelos componentes de tabela (client).
import {
  condAggKey,
  evalCondition,
  evaluateFormula,
  formulaCondAggInfo,
  formulaRefs,
  type AggCondition,
  type Formula,
  type FormulaCmpOp,
} from "@/lib/records/formulas";
import {
  ownCondOperands,
  type CustomCondField,
} from "@/lib/records/cond-operands";
import {
  ownDateOperands,
  TODAY_REF,
  type CustomDateField,
} from "@/lib/records/date-operands";
import { isPercentField, type FieldDefinition } from "@/lib/records/types";
import type { RefOption } from "@/components/campos/formula-builder";
import {
  foldBreakdowns,
  resolveCurrencyCode,
  resolveFieldMoney,
  type MoneyBreakdown,
} from "./currency";
import type { Aggregation, FilterOp, Metric, WidgetFilter } from "./types";

// Sentinela de Metric.field para a métrica calculada ad-hoc (fórmula guardada na
// própria métrica). Nunca é enviado ao RPC.
export const CALC_METRIC_FIELD = "calc:formula";

// agg:<sum|avg|count>:<field>. field pode conter ':' (ex.: custom:forecast); por
// isso o tipo de agregação vem PRIMEIRO e o field é o resto.
export function parseAggRef(ref: string): { agg: Aggregation; field: string } {
  const rest = ref.slice("agg:".length);
  const idx = rest.indexOf(":");
  const agg = (idx === -1 ? rest : rest.slice(0, idx)) as Aggregation;
  const field = idx === -1 ? "*" : rest.slice(idx + 1);
  return { agg, field };
}

// Chave de basis: 'sum:<field>' | 'count:<field>' | 'count:*'. Operando
// monetário carrega um MoneyBreakdown (soma por moeda + .brl convertido); os
// demais (contagens, campos numéricos, payload antigo) são números.
export type BasisKey = string;
export type BasisValues = Record<BasisKey, number | null | MoneyBreakdown>;

function isMoneyBreakdown(v: unknown): v is MoneyBreakdown {
  return (
    v != null &&
    typeof v === "object" &&
    "perCurrency" in (v as Record<string, unknown>)
  );
}

// Soma crua (misturando moedas) de um detalhamento; null quando o recorte não
// tem nenhum valor (coerente com o SUM SQL de zero linhas).
function rawTotal(bd: MoneyBreakdown): number | null {
  const codes = Object.keys(bd.perCurrency);
  if (codes.length === 0) return null;
  return codes.reduce((s, c) => s + bd.perCurrency[c], 0);
}

/** O campo de um operando de basis é monetário? (value/mrr ou custom moeda/calc-moeda.) */
export function isMoneyOperandField(
  field: string,
  fieldByKey: Map<string, FieldDefinition>
): boolean {
  if (field === "value" || field === "mrr") return true;
  if (field.startsWith("custom:")) {
    const f = fieldByKey.get(field.slice(7));
    return f ? resolveFieldMoney(f).isMoney : false;
  }
  return false;
}

/** Chaves de basis (somas/contagens canônicas) que a fórmula precisa. Inclui
 * as chaves CONDICIONAIS ("aggif:...") de SOMASE/CONT.SE/MÉDIASE. */
export function basisKeysFor(formula: Formula): BasisKey[] {
  const keys = new Set<BasisKey>();
  for (const ref of formulaRefs(formula)) {
    if (!ref.startsWith("agg:")) continue;
    const { agg, field } = parseAggRef(ref);
    if (agg === "sum") keys.add(`sum:${field}`);
    else if (agg === "count") keys.add(`count:${field}`);
    else if (agg === "avg") {
      keys.add(`sum:${field}`);
      keys.add(`count:${field}`);
    }
  }
  for (const spec of formulaCondAggInfo(formula).specs) keys.add(condAggKey(spec));
  return [...keys];
}

/** Métrica (para o RPC) que computa uma chave de basis. Chave condicional
 * (aggif:) devolve a métrica alvo — mas o chamador PRECISA ramificar por
 * isCondBasisKey e aplicar também os filtros (parseCondBasisKey().conds). */
export function basisMetric(key: BasisKey): Metric {
  const cond = parseCondBasisKey(key);
  if (cond) return cond.metric;
  const idx = key.indexOf(":");
  const agg = key.slice(0, idx) as Aggregation;
  return { field: key.slice(idx + 1), agg };
}

// --- Chaves de basis condicionais (SOMASE/CONT.SE/MÉDIASE) --------------------
// Uma chave "aggif:..." (ver condAggKey em lib/records/formulas.ts) representa
// uma soma/contagem RESTRITA a registros que satisfazem condições fixas. Como a
// condição é constante por chave, o fold aditivo de foldBasis continua exato em
// subtotais/Total geral. A resolução acontece por consulta SQL extra (filtros
// anexados) ou, nos caminhos client-side, filtrando os registros do grupo.

export function isCondBasisKey(key: BasisKey): boolean {
  return key.startsWith("aggif:");
}

export function parseCondBasisKey(
  key: BasisKey
): { metric: Metric; conds: AggCondition[] } | null {
  if (!isCondBasisKey(key)) return null;
  try {
    const [agg, field, conds] = JSON.parse(key.slice("aggif:".length)) as [
      "sum" | "count",
      string,
      [string, FormulaCmpOp, number | string | boolean][],
    ];
    return {
      metric: { field, agg },
      conds: conds.map(([ref, op, value]) => ({ ref, op, value })),
    };
  } catch {
    return null;
  }
}

// Ordenação com literal de TEXTO (uso real: datas ISO — lexicográfico =
// cronológico): comparação de texto plain do RPC.
const TEXT_ORDER_OPS: Record<FormulaCmpOp, FilterOp> = {
  "=": "eq_ci",
  "<>": "neq_ci",
  "<": "lt",
  ">": "gt",
  "<=": "lte",
  ">=": "gte",
};

// Literal NUMÉRICO: comparação numérica com cast seguro no RPC (0050).
const NUM_OPS: Record<FormulaCmpOp, FilterOp> = {
  "=": "eq_num",
  "<>": "neq_num",
  "<": "lt_num",
  ">": "gt_num",
  "<=": "lte_num",
  ">=": "gte_num",
};

/** Condições → filtros do RPC (anexados aos filtros do widget), com a MESMA
 * semântica do SE() via operadores normalizados da migração 0050: literal
 * numérico → *_num (comparação numérica, cast seguro); texto/booleano em
 * `=`/`<>` → eq_ci/neq_ci (trim + minúsculas + booleanos canonizados + null ≡
 * ''; booleano serializado "true"/"false"). Ordenação com literal de texto
 * (datas ISO) segue a comparação de texto plain. */
export function condFilters(conds: AggCondition[]): WidgetFilter[] {
  return conds.map((c) => {
    if (typeof c.value === "number") {
      return { field: c.ref, op: NUM_OPS[c.op], value: c.value };
    }
    return {
      field: c.ref,
      op: TEXT_ORDER_OPS[c.op],
      value: typeof c.value === "boolean" ? String(c.value) : c.value,
    };
  });
}

/**
 * Predicado client-side das condições — usado nos caminhos que agregam
 * registros em JS (Agrupar período, tabela de registros). Delegado ao
 * evalCondition do avaliador: semântica IDÊNTICA ao SE() por construção
 * (normalização de texto, booleanos, null ≡ '', números como número). O RPC
 * espelha via os operadores normalizados (0050).
 */
export function recordMatchesConds(
  raw: (ref: string) => unknown,
  conds: AggCondition[]
): boolean {
  return conds.every((c) => evalCondition(raw(c.ref), c.op, c.value));
}

/**
 * Funde basis de várias linhas (subtotal/Total geral): detalhamentos monetários
 * fundem por foldBreakdowns; números somam ignorando null; chave sem nenhum
 * valor → null (operando ausente). Mistura número/detalhamento na mesma chave
 * (payload antigo + novo): o detalhamento prevalece.
 */
export function foldBasis(
  list: (BasisValues | undefined)[]
): BasisValues {
  const out: BasisValues = {};
  for (const basis of list) {
    if (!basis) continue;
    for (const [k, v] of Object.entries(basis)) {
      if (isMoneyBreakdown(v)) {
        const prev = out[k];
        out[k] = foldBreakdowns([isMoneyBreakdown(prev) ? prev : undefined, v]);
        continue;
      }
      if (typeof v !== "number" || !Number.isFinite(v)) {
        if (!(k in out)) out[k] = null;
        continue;
      }
      const prev = out[k];
      if (isMoneyBreakdown(prev)) continue; // detalhamento prevalece
      out[k] = (typeof prev === "number" ? prev : 0) + v;
    }
  }
  return out;
}

// Como formatar/converter o resultado de uma métrica calculada de agregados.
export type CalcCurrencyMode = "none" | "auto" | "fixed";

export interface CalcMoneyMeta {
  mode: CalcCurrencyMode;
  code?: string | null; // moeda fixa (mode 'fixed')
  // R$ por 1 unidade de `code` (taxa do período do dashboard), pré-computada no
  // servidor — converte o RESULTADO BRL→fixa quando os operandos misturaram
  // moedas. null/ausente = sem taxa (o resultado misto permanece em BRL).
  fixedRate?: number | null;
  allowNegative?: boolean;
}

/**
 * Avalia a fórmula sobre uma basis com moeda: monta ctx ref→número (avg =
 * sum/count; count 0 ⇒ null, nunca divisão por zero) e delega ao avaliador
 * compartilhado. Operando monetário (MoneyBreakdown):
 *  - recorte com UMA moeda (ou já na moeda fixa) → soma crua; resultado nessa moeda;
 *  - moedas misturadas → usa o convertido (.brl); resultado em BRL (modo fixo
 *    converte o resultado BRL→fixa via meta.fixedRate).
 * Retorna também a moeda do resultado (null = número puro).
 */
export function evalCalcMoney(
  formula: Formula,
  basis: BasisValues,
  meta: CalcMoneyMeta
): { value: number | null; currency: string | null } {
  // Moedas presentes nos operandos monetários do recorte.
  const codes = new Set<string>();
  for (const key of basisKeysFor(formula)) {
    const v = basis[key];
    if (isMoneyBreakdown(v)) {
      for (const c of Object.keys(v.perCurrency)) codes.add(c);
    }
  }
  const fixed = meta.mode === "fixed" ? resolveCurrencyCode(meta.code) : null;
  // Representação dos operandos monetários: crua (uma moeda só — preservada) ou
  // convertida p/ Real (misturou; moedas diferentes nunca operam entre si).
  // Modo 'none' (número puro) mantém a soma crua da v1.
  const useRaw =
    meta.mode === "none" ||
    codes.size === 0 ||
    (codes.size === 1 && (!fixed || codes.has(fixed)));
  const operand = (
    v: number | null | MoneyBreakdown | undefined
  ): number | null => {
    if (v == null) return null;
    if (isMoneyBreakdown(v)) return useRaw ? rawTotal(v) : v.brl;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const ctx: Record<string, number | null> = {};
  for (const ref of formulaRefs(formula)) {
    if (!ref.startsWith("agg:")) {
      ctx[ref] = null; // ref desconhecida (ex.: table:* legada) → operando ausente
      continue;
    }
    const { agg, field } = parseAggRef(ref);
    if (agg === "sum") ctx[ref] = operand(basis[`sum:${field}`]);
    else if (agg === "count") ctx[ref] = operand(basis[`count:${field}`]);
    else {
      const sum = operand(basis[`sum:${field}`]);
      const count = operand(basis[`count:${field}`]);
      ctx[ref] = sum != null && count != null && count > 0 ? sum / count : null;
    }
  }
  // Agregações condicionais: o avaliador lê ctx[chave] diretamente (a chave
  // canônica é recomputada do AST em evalNode). Chave sem valor → null.
  for (const spec of formulaCondAggInfo(formula).specs) {
    const key = condAggKey(spec);
    ctx[key] = operand(basis[key]);
  }
  const raw = evaluateFormula(formula, ctx);
  let value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  let currency: string | null = null;
  if (meta.mode === "fixed" && fixed) {
    if (useRaw || value == null) {
      currency = fixed;
    } else {
      const rate = fixed === "BRL" ? 1 : meta.fixedRate;
      if (rate != null && Number.isFinite(rate) && rate > 0) {
        value = value / rate;
        currency = fixed;
      } else {
        currency = "BRL"; // sem taxa p/ a moeda fixa: mantém o Real
      }
    }
  } else if (meta.mode === "auto") {
    currency = codes.size === 1 ? [...codes][0] : codes.size > 1 ? "BRL" : null;
  }
  if (value != null && value < 0 && meta.allowNegative === false) value = 0;
  return { value, currency };
}

/** A métrica é calculada de agregados? (ad-hoc ou campo 'calculado_agg'.) */
export function isCalcMetric(
  m: Metric,
  fieldByKey: Map<string, FieldDefinition>
): boolean {
  if (m.calc || m.field === CALC_METRIC_FIELD || m.formula) return true;
  if (!m.field.startsWith("custom:")) return false;
  return fieldByKey.get(m.field.slice(7))?.data_type === "calculado_agg";
}

export interface ResolvedCalcMetric {
  formula: Formula | null; // null = campo deletado/sem fórmula → avalia p/ "—"
  // 'auto' preserva a moeda dos operandos (misturou → BRL); 'fixed' converte
  // para `code`; 'none' = número puro.
  mode: CalcCurrencyMode;
  code: string | null; // moeda fixa (mode 'fixed')
  allowNegative: boolean;
  // Exibição percentual (15/07/2026): resultado exibe ×100 + "%" (só quando o
  // resultado é número puro — nunca junto de moeda). Aplicado na formatação,
  // depois da avaliação; evalCalcMoney não muda.
  percent: boolean;
}

/** Resolve fórmula/moeda da métrica calculada (ad-hoc ou reutilizável). */
export function resolveCalcMetric(
  m: Metric,
  fieldByKey: Map<string, FieldDefinition>
): ResolvedCalcMetric {
  if (m.formula && m.formula.tokens.length > 0) {
    // Ad-hoc: `resultCurrency` passa a ser conversão REAL para a moeda (antes
    // era só rótulo de exibição) — consistente com o modo fixo dos campos.
    return {
      formula: m.formula,
      mode: m.resultCurrency ? "fixed" : "none",
      code: m.resultCurrency ? resolveCurrencyCode(m.resultCurrency) : null,
      allowNegative: true,
      percent: Boolean(m.resultPercent) && !m.resultCurrency,
    };
  }
  const def = m.field.startsWith("custom:")
    ? fieldByKey.get(m.field.slice(7))
    : undefined;
  if (
    !def ||
    def.data_type !== "calculado_agg" ||
    !def.formula ||
    def.formula.tokens.length === 0
  ) {
    return {
      formula: null,
      mode: "none",
      code: null,
      allowNegative: true,
      percent: false,
    };
  }
  return {
    formula: def.formula,
    mode:
      def.currency_mode === "fixed"
        ? "fixed"
        : def.currency_mode === "inherit"
          ? "auto"
          : "none",
    code:
      def.currency_mode === "fixed"
        ? resolveCurrencyCode(def.currency_code)
        : null,
    allowNegative: def.allow_negative !== false,
    percent: isPercentField(def),
  };
}

/**
 * Catálogo de operandos de agregação (FormulaBuilder/FormulaTextEditor):
 * contagem de registros + Σ/Média de cada campo numérico + Contagem de cada
 * campo "contável" (registros com o campo preenchido — inclui datas). A contagem
 * por campo (`agg:count:<campo>`) vira `count(custom_fields ->> 'key')` no RPC,
 * que só conta não-nulos — habilita razões como reunião→venda
 * (Contagem(Data da assinatura) ÷ Contagem(Data Reunião)). Compartilhado entre o
 * construtor de widgets e a página /campos.
 */
export function aggOperandRefs(
  numericFields: { field: string; label: string }[],
  countableFields: { field: string; label: string }[] = []
): RefOption[] {
  return [
    { ref: "agg:count:*", label: "Contagem de registros", group: "Registros" },
    ...countableFields.map((f) => ({
      ref: `agg:count:${f.field}`,
      label: `Contagem de ${f.label}`,
      group: "Registros",
    })),
    ...numericFields.flatMap((f) => [
      { ref: `agg:sum:${f.field}`, label: `Σ ${f.label}`, group: "Registros" },
      {
        ref: `agg:avg:${f.field}`,
        label: `Média ${f.label}`,
        group: "Registros",
      },
    ]),
  ];
}

// Grupos dos operandos extras de SOMASE/CONT.SE/MÉDIASE no catálogo agregado —
// usados para derivar os conjuntos de validação (validateCondAggRefs) do mesmo
// catálogo que o editor mostra, sem lista paralela.
export const COND_AGG_TARGET_GROUP = "Campos (SOMASE/MÉDIASE)";
export const COND_AGG_COND_GROUP = "Condições (SOMASE/CONT.SE)";

/**
 * Operandos extras que fórmulas AGREGADAS ganham com SOMASE/CONT.SE/MÉDIASE:
 * campos numéricos CRUS (alvo do 1º argumento — diferente dos agg:*, que já
 * chegam agregados; também valem como coluna de condição, ex.:
 * CONT.SE([Valor] > 1000)) e colunas de condição (texto/seleção/booleano +
 * datas do próprio registro; a condição sempre compara com um literal, ex.:
 * [Etapa] = "Ganho"). Fora do catálogo na v1: refs match:/unified: e "Data
 * atual" (today não é coluna no banco — o filtro SQL não o conhece).
 * Compartilhado entre os editores e a validação do servidor.
 */
export function condAggOperandRefs(
  rawNumericFields: { field: string; label: string }[],
  customCondFields: CustomCondField[],
  customDateFields: CustomDateField[]
): RefOption[] {
  return [
    ...rawNumericFields.map((f) => ({
      ref: f.field,
      label: f.label,
      group: COND_AGG_TARGET_GROUP,
    })),
    ...ownCondOperands(customCondFields).map((o) => ({
      ref: o.ref,
      label: o.label,
      group: COND_AGG_COND_GROUP,
    })),
    ...ownDateOperands(customDateFields)
      .filter((o) => o.ref !== TODAY_REF)
      .map((o) => ({
        ref: o.ref,
        label: o.label,
        group: COND_AGG_COND_GROUP,
      })),
  ];
}

/**
 * Validação de COLOCAÇÃO dos refs numa fórmula agregada (roda após
 * validateFormula, que já garantiu estrutura e refs conhecidas): campo cru só
 * dentro de SOMASE/CONT.SE/MÉDIASE (fora deles o operando precisa ser
 * agregado), alvo numérico e condição sobre coluna de condição. Recebe o mesmo
 * catálogo dos editores; os conjuntos saem dos grupos de condAggOperandRefs.
 */
export function validateCondAggRefs(
  formula: Formula,
  catalog: RefOption[]
): { ok: boolean; error?: string } {
  const targets = new Set<string>();
  const conds = new Set<string>();
  for (const o of catalog) {
    // Campos numéricos (grupo alvo) também valem como coluna de CONDIÇÃO
    // (ex.: CONT.SE([Valor] > 1000)) — o SE() permite comparação numérica e a
    // 0050 dá os operadores *_num no RPC.
    if (o.group === COND_AGG_TARGET_GROUP) {
      targets.add(o.ref);
      conds.add(o.ref);
    } else if (o.group === COND_AGG_COND_GROUP) conds.add(o.ref);
  }
  const labelOf = (ref: string) =>
    catalog.find((o) => o.ref === ref)?.label ?? ref;
  const info = formulaCondAggInfo(formula);
  for (const ref of info.plainRefs) {
    if (!ref.startsWith("agg:")) {
      return {
        ok: false,
        error: `[${labelOf(ref)}] só pode aparecer dentro de SOMASE/CONT.SE/MÉDIASE — fora deles, use os operandos agregados (Σ, Média, Contagem).`,
      };
    }
  }
  for (const ref of info.targetRefs) {
    if (!targets.has(ref)) {
      return {
        ok: false,
        error: `O 1º argumento de SOMASE/MÉDIASE deve ser um campo numérico: [${labelOf(ref)}].`,
      };
    }
  }
  for (const ref of info.condRefs) {
    if (!conds.has(ref)) {
      return {
        ok: false,
        error: `[${labelOf(ref)}] não pode ser usado em condição de SOMASE/CONT.SE (use colunas de texto/seleção/booleano, datas ou números).`,
      };
    }
  }
  return { ok: true };
}
