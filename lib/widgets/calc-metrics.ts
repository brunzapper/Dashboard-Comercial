// Versão: 1.0 | Data: 14/07/2026
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
// as basis por soma (foldBasis) e reavaliam (evalCalcFromBasis) — exato em todos
// os níveis, inclusive Total geral.
//
// Moeda: a definição pode fixar uma moeda de EXIBIÇÃO (formatação apenas). Sem
// conversão multi-moeda na v1 — os operandos somam os valores crus do banco,
// misturando as moedas do recorte (mesmo comportamento do RPC sem __money).
//
// Módulo puro/client-safe: importado pelo engine (server), pela página do
// dashboard (RSC) e pelos componentes de tabela (client).
import {
  evaluateFormula,
  formulaRefs,
  type Formula,
} from "@/lib/records/formulas";
import type { FieldDefinition } from "@/lib/records/types";
import type { RefOption } from "@/components/campos/formula-builder";
import { resolveCurrencyCode } from "./currency";
import type { Aggregation, Metric } from "./types";

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

// Chave de basis: 'sum:<field>' | 'count:<field>' | 'count:*'.
export type BasisKey = string;
export type BasisValues = Record<BasisKey, number | null>;

/** Chaves de basis (somas/contagens canônicas) que a fórmula precisa. */
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
  return [...keys];
}

/** Métrica (para o RPC) que computa uma chave de basis. */
export function basisMetric(key: BasisKey): Metric {
  const idx = key.indexOf(":");
  const agg = key.slice(0, idx) as Aggregation;
  return { field: key.slice(idx + 1), agg };
}

/**
 * Funde basis de várias linhas (subtotal/Total geral): soma por chave ignorando
 * null; chave sem nenhum valor numérico → null (operando ausente).
 */
export function foldBasis(
  list: (BasisValues | undefined)[]
): BasisValues {
  const out: BasisValues = {};
  for (const basis of list) {
    if (!basis) continue;
    for (const [k, v] of Object.entries(basis)) {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        if (!(k in out)) out[k] = null;
        continue;
      }
      out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

/**
 * Avalia a fórmula sobre uma basis: monta ctx ref→número (avg = sum/count;
 * count 0 ⇒ null, nunca divisão por zero) e delega ao avaliador compartilhado.
 * Resultado não numérico/não finito ⇒ null (exibido como "—").
 */
export function evalCalcFromBasis(
  formula: Formula,
  basis: BasisValues,
  allowNegative: boolean = true
): number | null {
  const ctx: Record<string, number | null> = {};
  for (const ref of formulaRefs(formula)) {
    if (!ref.startsWith("agg:")) {
      ctx[ref] = null; // ref desconhecida (ex.: table:* legada) → operando ausente
      continue;
    }
    const { agg, field } = parseAggRef(ref);
    if (agg === "sum") ctx[ref] = basis[`sum:${field}`] ?? null;
    else if (agg === "count") ctx[ref] = basis[`count:${field}`] ?? null;
    else {
      const sum = basis[`sum:${field}`];
      const count = basis[`count:${field}`];
      ctx[ref] =
        typeof sum === "number" && typeof count === "number" && count > 0
          ? sum / count
          : null;
    }
  }
  const v = evaluateFormula(formula, ctx);
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return !allowNegative && v < 0 ? 0 : v;
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
  currency: string | null; // moeda FIXA de exibição; null = número puro
  allowNegative: boolean;
}

/** Resolve fórmula/formatação da métrica calculada (ad-hoc ou reutilizável). */
export function resolveCalcMetric(
  m: Metric,
  fieldByKey: Map<string, FieldDefinition>
): ResolvedCalcMetric {
  if (m.formula && m.formula.tokens.length > 0) {
    return {
      formula: m.formula,
      currency: m.resultCurrency || null,
      allowNegative: true,
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
    return { formula: null, currency: null, allowNegative: true };
  }
  return {
    formula: def.formula,
    currency:
      def.currency_mode === "fixed"
        ? resolveCurrencyCode(def.currency_code)
        : null,
    allowNegative: def.allow_negative !== false,
  };
}

/**
 * Catálogo de operandos de agregação (FormulaBuilder/FormulaTextEditor):
 * contagem de registros + Σ/Média de cada campo numérico. Compartilhado entre o
 * construtor de widgets e a página /campos.
 */
export function aggOperandRefs(
  numericFields: { field: string; label: string }[]
): RefOption[] {
  return [
    { ref: "agg:count:*", label: "Contagem de registros", group: "Registros" },
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
