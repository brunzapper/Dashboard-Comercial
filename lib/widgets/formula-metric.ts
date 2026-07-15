// Versão: 3.2 | Data: 15/07/2026
// v3.2 (15/07/2026): resultado TEXTUAL opcional — quando a fórmula usa funções
//   (SE etc.) e o valor numérico sai null, reavalia sobre a basis numérica
//   crua (rawBasis, sem MoneyBreakdown) e devolve string em `text` (booleano →
//   "Verdadeiro"/"Falso"). Usado pelo widget Nota p/ condicionais textuais.
// v3.1 (15/07/2026): filtros segmentados por fonte (applyFilterSourceTargets,
//   mesma normalização do engine) antes do @period/sourceFilters.
// Fase 3: métrica calculada no nível do DASHBOARD. O avaliador de fórmula
// (evaluateFormula) é agnóstico de contexto — aqui montamos a BASIS
// (somas/contagens canônicas; ver lib/widgets/calc-metrics.ts) resolvendo
// referências de agregação de registros:
//   - agg:<sum|avg|count>:<field> → agregação dos registros via run_widget_query
//     (field pode ser 'value'|'mrr'|'custom:<k>'|'*'; '*' com count = contagem).
// Depois chamamos evalCalcMoney(formula, basis, meta) sem tocar no avaliador.
// v2.0 (11/07/2026): removido o suporte a refs table:* (a "Tabela editável"/matriz
//   foi descontinuada). Refs table:* remanescentes de fórmulas antigas resolvem
//   para null (operando ausente → resultado null).
// v3.0 (14/07/2026): moeda preservada — operandos monetários viram MoneyBreakdown
//   (consulta auxiliar por moeda); o resultado sai com a moeda dos operandos
//   (única → preservada; misturou → BRL) ou convertido p/ a moeda fixa. Retorna
//   { value, currency }.
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  evaluateFormula,
  formulaUsesFunctions,
  type AggCondition,
  type Formula,
} from "@/lib/records/formulas";
import type { FieldDefinition } from "@/lib/records/types";
import type { SourceKey } from "@/lib/sources";
import {
  basisKeysFor,
  basisMetric,
  condFilters,
  evalCalcMoney,
  isCondBasisKey,
  isMoneyOperandField,
  parseCondBasisKey,
  type BasisKey,
  type BasisValues,
  type CalcMoneyMeta,
} from "./calc-metrics";
import {
  aggregate,
  aggregateMoneyBreakdowns,
  resolveFilters,
  sourceFilters,
} from "./engine";
import { applyFilterSourceTargets } from "./filter-sources";
import { resolveRate, yearQuarterOf, type CurrencyRates } from "./currency";
import { applyPeriodToFilters, type DashboardPeriod } from "./period";
import type { Metric, WidgetFilter } from "./types";

export interface CalcInput {
  formula?: Formula | null;
  sources?: SourceKey[];
  filters?: WidgetFilter[];
  period?: DashboardPeriod | null;
  correspondencesMap?: Record<string, string[]>;
  // Moeda do resultado: 'auto' preserva a moeda dos operandos (misturou → BRL);
  // 'fixed' converte p/ `code`; ausente/'none' = número puro (soma crua, v1).
  currencyMode?: "none" | "auto" | "fixed";
  currencyCode?: string | null;
  allowNegative?: boolean;
  // Insumos p/ resolver a moeda dos operandos (campos + taxas + período da taxa
  // fixa). Sem eles, tudo degrada p/ números crus.
  fields?: FieldDefinition[];
  rates?: CurrencyRates;
  conversionPeriod?: { year: number; quarter: number };
}

/**
 * Avalia a fórmula de uma métrica calculada com o contexto do dashboard.
 * Retorna { value, currency, text? }: value null se algum operando faltar /
 * divisão por zero; currency null = número puro (sem moeda); text presente
 * quando a fórmula produz string/booleano (ex.: SE(...) textual da Nota).
 */
export async function runCalculatedWidget(
  supabase: SupabaseClient,
  input: CalcInput
): Promise<{ value: number | null; currency: string | null; text?: string }> {
  const { formula } = input;
  if (!formula || formula.tokens.length === 0)
    return { value: null, currency: null };

  const mode = input.currencyMode ?? "none";
  const fieldByKey = new Map(
    (input.fields ?? []).map((f) => [f.field_key, f])
  );
  const rates = input.rates ?? {};
  const conversionPeriod = input.conversionPeriod ?? yearQuarterOf(null);

  // Segmentação por fonte antes dos filtros sintéticos (mesma ordem do engine).
  let filters = applyFilterSourceTargets(
    resolveFilters(input.filters ?? []),
    input.sources
  );
  if (input.period)
    filters = applyPeriodToFilters(filters, input.period, input.sources);
  filters = [...sourceFilters(input.sources), ...filters];

  // Basis numérica via RPC agregado — é o valor final das contagens/campos
  // numéricos e o fallback cru dos monetários. Chaves condicionais (aggif: de
  // SOMASE/CONT.SE/MÉDIASE) NÃO entram na consulta principal: filtro é da
  // consulta inteira, então cada conjunto de condições vira uma consulta extra
  // com os filtros da condição anexados aos do dashboard.
  const allKeys = basisKeysFor(formula);
  const plainKeys = allKeys.filter((k) => !isCondBasisKey(k));
  const condKeys = allKeys.filter(isCondBasisKey);
  const basis: BasisValues = {};
  // Basis numérica CRUA (antes da substituição por MoneyBreakdown): contexto
  // da reavaliação textual (evaluateFormula não entende MoneyBreakdown).
  const rawBasis: Record<string, number | null> = {};

  const resolveKeys = async (keys: BasisKey[], keyFilters: WidgetFilter[]) => {
    const metrics: Metric[] = keys.map(basisMetric);
    const values = await aggregate(
      supabase,
      metrics,
      keyFilters,
      input.correspondencesMap ?? {}
    );
    keys.forEach((key, i) => {
      basis[key] = Number.isFinite(values[i]) ? values[i] : null;
      rawBasis[key] = Number.isFinite(values[i]) ? values[i] : null;
    });

    // Operandos monetários: detalhamento por moeda (preserva a moeda única do
    // recorte / converte p/ Real quando misturar). Aux indisponível → mantém o
    // número cru (degradação = comportamento v1).
    if (mode !== "none") {
      const moneyKeys = keys.filter(
        (key) =>
          basisMetric(key).agg === "sum" &&
          isMoneyOperandField(basisMetric(key).field, fieldByKey)
      );
      if (moneyKeys.length > 0) {
        const bds = await aggregateMoneyBreakdowns(
          supabase,
          moneyKeys.map(basisMetric),
          keyFilters,
          input.correspondencesMap ?? {},
          fieldByKey,
          rates,
          conversionPeriod
        );
        if (bds) moneyKeys.forEach((key, i) => {
          basis[key] = bds[i];
        });
      }
    }
  };

  const jobs: Promise<void>[] = [];
  if (plainKeys.length > 0) jobs.push(resolveKeys(plainKeys, filters));
  if (condKeys.length > 0) {
    // Uma consulta por conjunto distinto de condições.
    const groups = new Map<string, { conds: AggCondition[]; keys: BasisKey[] }>();
    for (const key of condKeys) {
      const parsed = parseCondBasisKey(key);
      if (!parsed) {
        basis[key] = null;
        continue;
      }
      const gk = JSON.stringify(parsed.conds);
      const g = groups.get(gk) ?? { conds: parsed.conds, keys: [] };
      g.keys.push(key);
      groups.set(gk, g);
    }
    for (const g of groups.values()) {
      // Falha da consulta condicional (ex.: migração 0050 dos operadores
      // normalizados ainda não aplicada) degrada a chave para null (operando
      // ausente → "—") em vez de derrubar a página do dashboard.
      jobs.push(
        resolveKeys(g.keys, [...filters, ...condFilters(g.conds)]).catch(() => {
          for (const key of g.keys) basis[key] = null;
        })
      );
    }
  }
  await Promise.all(jobs);

  const meta: CalcMoneyMeta = {
    mode,
    code: input.currencyCode ?? null,
    fixedRate:
      mode === "fixed" && input.currencyCode
        ? resolveRate(
            rates,
            input.currencyCode,
            conversionPeriod.year,
            conversionPeriod.quarter
          )
        : null,
    allowNegative: input.allowNegative,
  };
  // Refs desconhecidas (table:* legadas) resolvem p/ null dentro do
  // evalCalcMoney (operando ausente). Resultado texto/booleano → value null.
  const result = evalCalcMoney(formula, basis, meta);
  if (result.value == null && formulaUsesFunctions(formula)) {
    // Fórmula com funções (SE/E/OU…) pode legitimamente produzir texto ou
    // booleano — reavalia sobre a basis crua e expõe como `text`.
    try {
      const raw = evaluateFormula(formula, rawBasis);
      if (typeof raw === "string") return { ...result, text: raw };
      if (typeof raw === "boolean")
        return { ...result, text: raw ? "Verdadeiro" : "Falso" };
    } catch {
      // Avaliação textual é melhor-esforço: mantém o resultado numérico null.
    }
  }
  return result;
}
