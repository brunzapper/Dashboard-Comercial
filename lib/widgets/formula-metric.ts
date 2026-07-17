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
  formulaComparisonBases,
  formulaUsesFunctions,
  type AggCondition,
  type ComparisonFuncBase,
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
import { comparisonSpec } from "./comparison";
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
  const baseFilters = applyFilterSourceTargets(
    resolveFilters(input.filters ?? []),
    input.sources
  );
  const withPeriod = (p: DashboardPeriod | null | undefined): WidgetFilter[] => {
    let f = baseFilters;
    if (p) f = applyPeriodToFilters(f, p, input.sources);
    return [...sourceFilters(input.sources), ...f];
  };
  const filters = withPeriod(input.period);

  // Funções ANTERIOR/VARPCT/VARABS: a MESMA basis é resolvida também sob os
  // filtros do período de comparação (bases "anterior"/"ano"; janelas ficam de
  // fora do v1 das fórmulas) e vira contexto alternativo do avaliador. Sem
  // período ativo (todo o período) → base indisponível → null ("—").
  const cmpFiltersByBase: Partial<Record<ComparisonFuncBase, WidgetFilter[]>> = {};
  for (const b of formulaComparisonBases(formula)) {
    const spec = comparisonSpec(input.period, {
      enabled: true,
      base: b === "ano" ? "previous_year" : "previous_period",
    });
    if (!spec || !input.period) continue;
    cmpFiltersByBase[b] = withPeriod({
      field: input.period.field,
      from: spec.from,
      to: spec.to,
      fieldBySource: input.period.fieldBySource,
    });
  }

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
  // Basis do período de comparação, por base (mesmas chaves da principal).
  const cmpBasis: Partial<Record<ComparisonFuncBase, BasisValues>> = {};
  const cmpRawBasis: Partial<
    Record<ComparisonFuncBase, Record<string, number | null>>
  > = {};

  // Resolve `keys` sob `keyFilters` escrevendo nos alvos dados — a mesma rodada
  // serve a basis principal e as de comparação.
  const makeResolver =
    (target: BasisValues, rawTarget: Record<string, number | null>) =>
    async (keys: BasisKey[], keyFilters: WidgetFilter[]) => {
      const metrics: Metric[] = keys.map(basisMetric);
      const values = await aggregate(
        supabase,
        metrics,
        keyFilters,
        input.correspondencesMap ?? {}
      );
      keys.forEach((key, i) => {
        target[key] = Number.isFinite(values[i]) ? values[i] : null;
        rawTarget[key] = Number.isFinite(values[i]) ? values[i] : null;
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
            target[key] = bds[i];
          });
        }
      }
    };

  // Enfileira as consultas (plain + condicionais) de UMA basis num conjunto de
  // filtros; usada p/ a principal e p/ cada base de comparação presente.
  const enqueueBasis = (
    jobs: Promise<void>[],
    target: BasisValues,
    rawTarget: Record<string, number | null>,
    baseFiltersFor: WidgetFilter[],
    // Basis de comparação degrada TUDO para null em falha (widget segue sem
    // variação); a principal preserva o comportamento original (plain propaga).
    lenient: boolean
  ) => {
    const resolveKeys = makeResolver(target, rawTarget);
    if (plainKeys.length > 0) {
      const p = resolveKeys(plainKeys, baseFiltersFor);
      jobs.push(
        lenient
          ? p.catch(() => {
              for (const key of plainKeys) target[key] = null;
            })
          : p
      );
    }
    if (condKeys.length > 0) {
      // Uma consulta por conjunto distinto de condições.
      const groups = new Map<string, { conds: AggCondition[]; keys: BasisKey[] }>();
      for (const key of condKeys) {
        const parsed = parseCondBasisKey(key);
        if (!parsed) {
          target[key] = null;
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
          resolveKeys(g.keys, [...baseFiltersFor, ...condFilters(g.conds)]).catch(
            () => {
              for (const key of g.keys) target[key] = null;
            }
          )
        );
      }
    }
  };

  const jobs: Promise<void>[] = [];
  enqueueBasis(jobs, basis, rawBasis, filters, false);
  for (const [b, f] of Object.entries(cmpFiltersByBase) as [
    ComparisonFuncBase,
    WidgetFilter[],
  ][]) {
    const target: BasisValues = {};
    const rawTarget: Record<string, number | null> = {};
    cmpBasis[b] = target;
    cmpRawBasis[b] = rawTarget;
    enqueueBasis(jobs, target, rawTarget, f, true);
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
  const hasCmp = Boolean(cmpBasis.anterior || cmpBasis.ano);
  const result = evalCalcMoney(
    formula,
    basis,
    meta,
    hasCmp ? cmpBasis : undefined
  );
  if (result.value == null && formulaUsesFunctions(formula)) {
    // Fórmula com funções (SE/E/OU…) pode legitimamente produzir texto ou
    // booleano — reavalia sobre a basis crua e expõe como `text`.
    try {
      const raw = evaluateFormula(
        formula,
        rawBasis,
        undefined,
        hasCmp ? cmpRawBasis : undefined
      );
      if (typeof raw === "string") return { ...result, text: raw };
      if (typeof raw === "boolean")
        return { ...result, text: raw ? "Verdadeiro" : "Falso" };
    } catch {
      // Avaliação textual é melhor-esforço: mantém o resultado numérico null.
    }
  }
  return result;
}
