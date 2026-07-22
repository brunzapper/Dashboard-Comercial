// Versão: 3.4 | Data: 20/07/2026
// v3.4 (20/07/2026): unificados por PERNA — o input troca o mapa pronto
//   (`correspondencesMap`) pelas correspondências CRUAS; o mapa passa a ser
//   montado aqui via correspondenceMapForSources(fontes efetivas da consulta,
//   catálogo). O mapa global levava o membro da sub-fonte pro coalesce da pai
//   (mesmo record_type) e alterava cálculos de widget só-pai. Os filtros
//   (segmentação/@period/sourceFilters) também passam a receber o catálogo
//   (sub-fonte resolvia sem predicado/data próprios no caminho calc).
// v3.3 (19/07/2026): aninhamento de agregados — a fórmula de entrada é
//   expandida (expandAggFormula: ref custom:<calculado_agg> → fórmula do campo
//   entre parênteses) antes de qualquer resolução. Cobre widget calculado
//   apontando p/ campo salvo, calculadora, nota, células da tabela rápida,
//   cards e o viewer público de snapshot — todos passam por aqui.
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
import { expandAggFormula } from "@/lib/records/formula-deps";
import type { FieldDefinition } from "@/lib/records/types";
import { isCoreDef } from "@/lib/records/core-defs";
import {
  correspondenceMapForSources,
  type Correspondence,
} from "@/lib/correspondences";
import {
  BUILTIN_SOURCES,
  planSourceLegs,
  recordTypeOf,
  rootSources,
  type SourceDef,
  type SourceKey,
} from "@/lib/sources";
import {
  basisKeysFor,
  basisMetric,
  condFilters,
  evalCalcMoney,
  isCondBasisKey,
  isMoneyOperandField,
  lowerSourceScopedOperands,
  parseCondBasisKey,
  type BasisKey,
  type BasisValues,
  type CalcMoneyMeta,
} from "./calc-metrics";
import {
  aggregate,
  aggregateMoneyBreakdowns,
  resolveFilters,
  resolveFkCondFilters,
  sourceFilters,
} from "./engine";
import { applyFilterSourceTargets } from "./filter-sources";
import { formulaScopedSources } from "./metric-sources";
import { comparisonSpec } from "./comparison";
import { resolveRate, yearQuarterOf, type CurrencyRates } from "./currency";
import {
  applyPeriodToFilters,
  patchAuxPeriodByType,
  scopedAuxPeriod,
  type DashboardPeriod,
} from "./period";
import type { Metric, WidgetFilter } from "./types";

export interface CalcInput {
  formula?: Formula | null;
  sources?: SourceKey[];
  // Catálogo de fontes (SourceDef[]) p/ abaixar operandos com escopo de fonte
  // (`agg:…@<fonte>` → aggif:). Ausente = builtins — suficiente p/ fontes raiz;
  // sub-fontes precisam do catálogo vivo (predicado da sub).
  sourceDefs?: SourceDef[];
  filters?: WidgetFilter[];
  period?: DashboardPeriod | null;
  // Correspondências CRUAS (não o mapa global): o mapa do RPC é montado aqui,
  // escopado às fontes efetivas da consulta (correspondenceMapForSources) —
  // senão o membro de uma sub-fonte entraria no coalesce da pai.
  correspondences?: Correspondence[];
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
  if (!input.formula || input.formula.tokens.length === 0)
    return { value: null, currency: null };

  const mode = input.currencyMode ?? "none";
  // Linhas core (0086) fora do mapa por chave: refs custom:<key> nunca apontam
  // p/ coluna núcleo (blindagem no choke point — cobre todos os callers).
  const fieldByKey = new Map(
    (input.fields ?? [])
      .filter((f) => !isCoreDef(f))
      .map((f) => [f.field_key, f])
  );
  // Aninhamento de agregados (19/07/2026): expande refs custom:<calculado_agg>
  // para a fórmula do campo entre parênteses ANTES de resolver bases de
  // comparação e basis — daqui para baixo tudo opera na fórmula expandida
  // (fast path sem aninhamento devolve o mesmo objeto). Em seguida, abaixa os
  // operandos com escopo de fonte (`agg:…@<fonte>` → chave aggif:) — v2.3.
  const expanded = expandAggFormula(input.formula, (k) => fieldByKey.get(k));
  const formula = lowerSourceScopedOperands(expanded, input.sourceDefs);
  const rates = input.rates ?? {};
  const conversionPeriod = input.conversionPeriod ?? yearQuarterOf(null);

  // Fontes da CONSULTA: as do widget ∪ as dos operandos com escopo (invariante
  // 9) — sem a união, o `record_type in (...)`/@period do universo do widget
  // zeraria em silêncio um operando @fonte de fora. Widget "todas as fontes"
  // ([]) permanece sem restrição.
  const scopedSources = formulaScopedSources(expanded);
  const querySources =
    input.sources && input.sources.length > 0
      ? [...new Set([...input.sources, ...scopedSources])]
      : input.sources;

  // Fontes EFETIVAS da consulta (mesma resolução do engine): subs absorvidas
  // somem, sub avulsa é a fonte efetiva do seu record_type; "todas as fontes"
  // = raízes do catálogo. O mapa de unificados sai escopado a elas — o membro
  // da sub NÃO entra no coalesce da pai (bug do widget só-pai, v3.4).
  const catalog = input.sourceDefs ?? BUILTIN_SOURCES;
  const plan = planSourceLegs(querySources, undefined, catalog);
  const effKeys = plan.allMain
    ? rootSources(catalog).map((s) => s.key)
    : plan.mainSources;
  const correspondencesMap = correspondenceMapForSources(
    input.correspondences ?? [],
    effKeys,
    catalog
  );

  // Segmentação por fonte antes dos filtros sintéticos (mesma ordem do engine).
  const baseFilters = applyFilterSourceTargets(
    resolveFilters(input.filters ?? []),
    querySources,
    catalog
  );
  const withPeriod = (p: DashboardPeriod | null | undefined): WidgetFilter[] => {
    let f = baseFilters;
    if (p) f = applyPeriodToFilters(f, p, querySources, catalog);
    return [...sourceFilters(querySources, catalog), ...f];
  };
  const filters = withPeriod(input.period);

  // Funções ANTERIOR/VARPCT/VARABS: a MESMA basis é resolvida também sob os
  // filtros do período de comparação (bases "anterior"/"ano"; janelas ficam de
  // fora do v1 das fórmulas) e vira contexto alternativo do avaliador. Sem
  // período ativo (todo o período) → base indisponível → null ("—").
  const cmpFiltersByBase: Partial<Record<ComparisonFuncBase, WidgetFilter[]>> = {};
  // Período de cada base (mesmo objeto passado ao withPeriod) — insumo das
  // auxes de operandos ESCOPADOS (período pela data da fonte do escopo).
  const cmpPeriodByBase: Partial<Record<ComparisonFuncBase, DashboardPeriod>> =
    {};
  for (const b of formulaComparisonBases(formula)) {
    const spec = comparisonSpec(input.period, {
      enabled: true,
      base: b === "ano" ? "previous_year" : "previous_period",
    });
    if (!spec || !input.period) continue;
    const cmpPeriod: DashboardPeriod = {
      field: input.period.field,
      from: spec.from,
      to: spec.to,
      fieldBySource: input.period.fieldBySource,
    };
    cmpPeriodByBase[b] = cmpPeriod;
    cmpFiltersByBase[b] = withPeriod(cmpPeriod);
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

  // Aux de operando ESCOPADO (20/07/2026): perna SÓ da fonte do escopo —
  // período pela coluna de data DELA (scopedAuxPeriod + patch do sentinel
  // pré-sintetizado) e correspondências com o membro DELA. Mesma regra do
  // engine (computeRows.scopedAuxInputs).
  const scopedAuxInputs = (
    scope: SourceKey,
    runPeriod: DashboardPeriod | null | undefined
  ): { filters: WidgetFilter[]; corr: Record<string, string[]> } => {
    const rt = recordTypeOf(scope, catalog);
    const scopeField =
      runPeriod?.fieldBySource?.[scope] ??
      catalog.find((s) => s.key === scope)?.defaultPeriodField ??
      runPeriod?.field ??
      "source_created_at";
    let f = applyFilterSourceTargets(
      resolveFilters(input.filters ?? []),
      [scope],
      catalog
    );
    const p = scopedAuxPeriod(runPeriod, scope, catalog);
    if (p) f = applyPeriodToFilters(f, p, [scope], catalog);
    f = [...sourceFilters([scope], catalog), ...f];
    return {
      filters: patchAuxPeriodByType(f, rt, scopeField),
      corr: correspondenceMapForSources(
        input.correspondences ?? [],
        [scope],
        catalog
      ),
    };
  };

  // Resolve `keys` sob `keyFilters` escrevendo nos alvos dados — a mesma rodada
  // serve a basis principal e as de comparação. `corrOverride` = mapa de
  // correspondências da aux escopada (default: o da consulta principal).
  const makeResolver =
    (target: BasisValues, rawTarget: Record<string, number | null>) =>
    async (
      keys: BasisKey[],
      keyFilters: WidgetFilter[],
      corrOverride?: Record<string, string[]>
    ) => {
      const corr = corrOverride ?? correspondencesMap;
      const metrics: Metric[] = keys.map(basisMetric);
      const values = await aggregate(supabase, metrics, keyFilters, corr);
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
            corr,
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
    // Período DESTA rodada (principal ou base de comparação) — insumo das
    // auxes de operandos escopados.
    runPeriod: DashboardPeriod | null | undefined,
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
      // Uma consulta por conjunto distinto de condições (+ escopo — specs
      // idênticos com escopos diferentes têm auxes diferentes).
      const groups = new Map<
        string,
        { conds: AggCondition[]; keys: BasisKey[]; scope?: string }
      >();
      for (const key of condKeys) {
        const parsed = parseCondBasisKey(key);
        if (!parsed) {
          target[key] = null;
          continue;
        }
        const gk = JSON.stringify([parsed.conds, parsed.scope ?? null]);
        const g =
          groups.get(gk) ??
          ({ conds: parsed.conds, keys: [], scope: parsed.scope } as {
            conds: AggCondition[];
            keys: BasisKey[];
            scope?: string;
          });
        g.keys.push(key);
        groups.set(gk, g);
      }
      for (const g of groups.values()) {
        // Falha da consulta condicional (ex.: migração 0050 dos operadores
        // normalizados ainda não aplicada) degrada a chave para null (operando
        // ausente → "—") em vez de derrubar a página do dashboard.
        jobs.push(
          (async () => {
            // Condição sobre relação por NOME → resolve p/ UUID antes do RPC.
            const extra = await resolveFkCondFilters(
              supabase,
              condFilters(g.conds)
            );
            const scoped = g.scope
              ? scopedAuxInputs(g.scope, runPeriod)
              : null;
            await resolveKeys(
              g.keys,
              [...(scoped ? scoped.filters : baseFiltersFor), ...extra],
              scoped?.corr
            );
          })().catch(() => {
            for (const key of g.keys) target[key] = null;
          })
        );
      }
    }
  };

  const jobs: Promise<void>[] = [];
  enqueueBasis(jobs, basis, rawBasis, filters, input.period, false);
  for (const [b, f] of Object.entries(cmpFiltersByBase) as [
    ComparisonFuncBase,
    WidgetFilter[],
  ][]) {
    const target: BasisValues = {};
    const rawTarget: Record<string, number | null> = {};
    cmpBasis[b] = target;
    cmpRawBasis[b] = rawTarget;
    enqueueBasis(jobs, target, rawTarget, f, cmpPeriodByBase[b], true);
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
