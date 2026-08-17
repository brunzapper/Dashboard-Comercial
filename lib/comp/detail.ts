// Versão: 1.0 | Data: 16/08/2026
// Detalhamento por REGISTRO da remuneração — núcleo ÚNICO da pergunta "quais
// registros compõem este membro × fator × mês", consumido pelo diálogo de
// conferência da tela (app/(app)/operacao/remuneracao/detail-actions.ts) e
// pelas abas Det-<Nome> do export p/ Google Planilhas
// (lib/export/comp-detail-sheet.ts). Tela e planilha NUNCA podem divergir —
// por isso a montagem do recorte vive num choke point só (factorRecordQuery).
//
// REGRA DE OURO: a listagem é EVIDÊNCIA, nunca a fonte do número. O realizado
// por membro×fator continua saindo do cálculo (computeEntry sobre o snapshot
// de runCalculatedWidget, via statementBreakdown) — aqui ele é apenas exibido
// AO LADO da soma dos registros listados, com nota quando divergirem. Jamais
// recalcule o realizado a partir desta lista.
//
// O recorte espelha, campo a campo, o que o engine manda ao runCalculatedWidget
// (lib/comp/engine.ts): período do mês APURADO (apuracaoRef → monthPeriod),
// `factor.filters` e, por ÚLTIMO, o filtro de membro do memberFilterFor (o
// mesmo helper, importado — nunca reimplementado). A consulta em si é o funil
// canônico do modo lista (runRecordListWindow), que já resolve predicado de
// sub-fonte, coluna de data por fonte, nome→id de FK, grupo canônico de
// responsável e a regra 0052 dos mocks.
//
// Divergências ESTRUTURAIS entre a lista e a agregação viram `warnings`
// visíveis (nunca silêncio): condição em campo que o modo lista descarta e
// operando com escopo de fonte fora do recorte do fator.
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  commissionMemory,
  DETAIL_DROPPED_FILTER_NOTE,
  DETAIL_UNSUPPORTED_FIELD_NOTE,
  detailAggNote,
  detailTruncatedNote,
  factorPayoutFormula,
  SOMADOS_LABEL,
} from "@/lib/comp/commission-label";
import {
  commissionRolesOf,
  resolvedUnitValue,
  tierLadder,
} from "@/lib/comp/payout-math";
import { loadCorrespondences } from "@/lib/correspondences";
import {
  canonicalOf,
  loadResponsibleCanon,
  type ResponsibleCanon,
} from "@/lib/config/responsible-canon";
import { loadSources } from "@/lib/config/sources";
import { statementBreakdown } from "@/lib/export/comp";
import {
  recordCellValue,
  recordColumnValue,
  recordRefLabel,
  resolveRecordRef,
  type RecordLabels,
} from "@/lib/export/record-cells";
import { isCoreDef } from "@/lib/records/core-defs";
import { expandAggFormula } from "@/lib/records/formula-deps";
import type { AggCondition } from "@/lib/records/formulas";
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import type { SourceDef, SourceKey } from "@/lib/sources";
import {
  basisKeysFor,
  basisMetric,
  lowerSourceScopedOperands,
  parseCondBasisKey,
} from "@/lib/widgets/calc-metrics";
import { loadCurrencyRates, yearQuarterOf } from "@/lib/widgets/currency";
import { buildAvailableFields, type AvailableField } from "@/lib/widgets/fields";
import { formulaScopedSources } from "@/lib/widgets/metric-sources";
import { scopedAuxPeriod, type DashboardPeriod } from "@/lib/widgets/period";
import {
  listFilterFieldSupported,
  runRecordListWindow,
} from "@/lib/widgets/record-list";
import { createTaskLimiter, WIDGET_TASK_CONCURRENCY } from "@/lib/widgets/task-limiter";
import {
  AGG_LABELS,
  type Aggregation,
  type FilterOp,
  type WidgetConfig,
  type WidgetFilter,
} from "@/lib/widgets/types";

import {
  loadTargetsByMember,
  memberFilterFor,
  resolveTargetRates,
  type CompEntryRow,
  type CompPlanRow,
} from "./engine";
import {
  apuracaoRef,
  monthPeriod,
  parseCompPlanConfig,
  roundMoney,
  type CompBreakdown,
  type CompCommissionBlock,
  type CompCommissionBlockBreakdown,
  type CompDetailGrouping,
  type CompFactor,
  type CompPlanConfig,
} from "./model";

/** Registros listados por fator (janela; acima disso a lista é truncada com nota). */
export const MAX_DETAIL_ROWS_PER_FACTOR = 200;
/**
 * Orçamento de linhas somando TODOS os fatores de um export. Fica abaixo do
 * teto do validador (MAX_DETAIL_ROWS_TOTAL) porque a aba tem linhas de
 * ESTRUTURA além dos registros — a folga é cobrada por fator, abaixo.
 */
export const MAX_DETAIL_ROWS_BUDGET = 5000;
/**
 * Linhas de estrutura cobradas do orçamento por fator: cabeçalho do fator,
 * cabeçalho de colunas, subtotal, respiro, mais o rateio do cabeçalho do plano
 * e do bloco da pessoa. Cobrar a mais é barato; cobrar a menos estoura o teto
 * do validador e o export perde o detalhamento inteiro.
 */
const DETAIL_ROWS_OVERHEAD = 10;
/** Teto de consultas por export (membros × planos × fatores). */
export const MAX_DETAIL_QUERIES = 400;

export interface CompDetailRecordRow {
  id: string;
  date: string;
  title: string;
  sourceLabel: string;
  responsibleLabel: string;
  stage: string;
  /** Valor do campo DESTE operando, CRU (a formatação é da planilha/da tela). */
  value: number | null;
  /** Texto do campo quando ele não é numérico (unified:/match:). */
  valueText: string;
  /**
   * Quanto ESTE registro vale em reais para a remuneração — o elo que a lista
   * sozinha não mostrava. null quando a relação não é linear (ver unitValue em
   * lib/comp/payout-math.ts): aí um número enganaria.
   */
  contribution: number | null;
  /** Operando de origem — só preenchido em bloco SOMADO (mistura operandos). */
  origin: string;
}

/** Um degrau da escada de faixas, pronto para exibição. */
export interface CompDetailTier {
  fromPct: number;
  ratePct?: number;
  amount?: number;
  applied: boolean;
  reached: boolean;
}

/** Memória de UM bloco de comissão: o que multiplicou o quê, e a escada. */
export interface CompDetailCommission {
  blockId: string;
  label: string;
  /** pct | flat | per_unit — define a unidade do valor de cada degrau. */
  kind: "pct" | "flat" | "per_unit";
  /** Unidade do limiar das faixas: atingimento % ou realizado absoluto. */
  tierBy: "attainment" | "realized";
  /** Limiar em R$ (tierBy "realized" sobre fator monetário). */
  triggerMoney: boolean;
  /** "20% × R$ 9.450,00 (Vendas) = R$ 1.890,00" — de commissionMemory. */
  formula: string | null;
  /** Faixa aplicada + gatilho, ou o motivo do zero. */
  tierNote: string;
  memberTiers: boolean;
  value: number;
  tiers: CompDetailTier[];
}

/**
 * Um OPERANDO da fórmula do fator — a unidade real do cálculo. Cada operando
 * tem recorte próprio (fontes, condições de SOMASE, escopo de fonte), então
 * cada um vira um bloco com sua própria lista e seu próprio subtotal.
 */
export interface CompDetailOperand {
  /** "Soma de MRR do contrato" | "Contagem de registros". */
  label: string;
  /** Rótulo da coluna de valor ("MRR do contrato" | "Registros"). */
  valueLabel: string;
  /** "Soma de MRR do contrato · 42 registros no recorte". */
  aggNote: string;
  rows: CompDetailRecordRow[];
  /** Σ da coluna listada; null quando o campo não é somável (unified:/match:). */
  listedSum: number | null;
  /** Tamanho do recorte inteiro (contagem exata), mesmo com lista truncada. */
  total: number;
  truncated: boolean;
  warnings: string[];
}

export interface CompDetailFactor {
  factorId: string;
  label: string;
  money: boolean;
  /** AUTORIDADE — realizado efetivo do fator (computeEntry). */
  realized: number | null;
  /** Conta do valor por atingimento: "base × peso × ating. = valor". */
  payoutFormula: string | null;
  /** Quanto UMA unidade do realizado vale em R$; null = relação não linear. */
  unitValue: number | null;
  /** O que se conta (ex.: "reunião") — rótulo da unidade na frase do valor. */
  unitLabel: string;
  /** Comissões que este fator dispara e/ou embasa, com a escada completa. */
  commissions: CompDetailCommission[];
  operands: CompDetailOperand[];
  /**
   * Quantidade listada que DEVE bater com o realizado — só existe quando a
   * fórmula é UM operando puro (Σ de uma soma, contagem de uma contagem).
   * Fórmula que combina operandos não tem um número único a confrontar, e
   * inventar um seria o alarme falso que essa tela existe para evitar.
   */
  listedForCompare: number | null;
  warnings: string[];
}

export interface CompDetailPlan {
  planId: string;
  planName: string;
  factors: CompDetailFactor[];
  /** Todos os blocos de comissão do plano (bloco próprio no detalhamento). */
  commissions: CompDetailCommission[];
}

export interface CompDetailMember {
  memberId: string;
  label: string;
  tabName: string;
  plans: CompDetailPlan[];
  monthTotal: number | null;
}

/** Plano já resolvido para o mês (período apurado, alvos e taxas). */
export interface DetailPlan {
  row: CompPlanRow;
  config: CompPlanConfig;
  period: DashboardPeriod;
  targetRates: Record<string, number | null>;
  entryByMember: Map<string, CompEntryRow>;
  targetsByMember: Map<string, Record<string, number | null>>;
}

export interface CompDetailContext {
  year: number;
  month: number;
  sources: SourceDef[];
  allFields: FieldDefinition[];
  available: AvailableField[];
  canon: ResponsibleCanon;
  nameById: Map<string, string | null>;
  // Rótulos de FK das linhas listadas. Só responsáveis (as demais colunas do
  // detalhe não são FK) e derivados do canon que o módulo já carrega — o
  // `collectRecordFkLabels` custaria uma consulta POR FATOR para chegar ao
  // mesmo resultado (apelido exibe o nome do principal).
  fkLabels: RecordLabels;
  plans: DetailPlan[];
  /** record_type → fonte RAIZ (rótulo/coluna de data da linha). */
  rootByRecordType: Map<string, SourceDef>;
}

/**
 * Carrega UMA vez o que todo detalhamento do mês precisa: catálogo de fontes,
 * campos, correspondências, canon, planos ativos (config parseado fail-closed),
 * lançamentos do mês e alvos/cotações por plano. `memberIds` é o conjunto de
 * membros que serão consultados — os alvos são carregados só para eles.
 */
export async function loadCompDetailContext(
  supabase: SupabaseClient,
  opts: {
    orgId: string | null;
    year: number;
    month: number;
    memberIds: string[];
    planIds?: string[];
  }
): Promise<CompDetailContext> {
  const [sources, correspondences, fieldsRes, rates, canon, respRes, plansRes] =
    await Promise.all([
      loadSources(supabase, opts.orgId),
      loadCorrespondences(supabase, opts.orgId),
      supabase
        .from("field_definitions")
        .select(
          "field_key, label, data_type, formula, applies_to, currency_code, currency_mode, allow_negative, show_as_percent"
        ),
      loadCurrencyRates(supabase),
      loadResponsibleCanon(supabase),
      // TODOS os responsáveis (apelidos/inativos inclusos): o memberFilterFor
      // casa por CONJUNTO de nomes do grupo canônico.
      supabase.from("responsibles").select("id, display_name"),
      supabase
        .from("comp_plans")
        .select("id, name, active, base_amount_default, config")
        .eq("active", true),
    ]);

  const allFields = (fieldsRes.data ?? []) as FieldDefinition[];
  const available = buildAvailableFields(allFields, correspondences, sources);
  const nameById = new Map(
    ((respRes.data ?? []) as { id: string; display_name: string | null }[]).map(
      (r) => [r.id, r.display_name]
    )
  );

  const planRows = ((plansRes.data ?? []) as CompPlanRow[]).filter(
    (p) => !opts.planIds || opts.planIds.includes(p.id)
  );
  const parsed = planRows
    .map((row) => ({ row, config: parseCompPlanConfig(row.config) }))
    .filter((p): p is { row: CompPlanRow; config: CompPlanConfig } =>
      Boolean(p.config)
    );

  const entriesRes = parsed.length
    ? await supabase
        .from("comp_entries")
        .select(
          "id, plan_id, responsible_id, base_amount, inputs, computed, total, mirror_record_id, published_at"
        )
        .in(
          "plan_id",
          parsed.map((p) => p.row.id)
        )
        .eq("period_year", opts.year)
        .eq("period_month", opts.month)
    : { data: [] };
  const entries = (entriesRes.data ?? []) as (CompEntryRow & {
    plan_id: string;
  })[];

  const plans: DetailPlan[] = await Promise.all(
    parsed.map(async ({ row, config }) => {
      // Janela APURADA (M-1 quando config.apuracao): o call site fala SEMPRE o
      // mês do lançamento — deslocar aqui fora leria M-2.
      const ref = apuracaoRef(opts.year, opts.month, config);
      const period = monthPeriod(ref.year, ref.month, sources);
      const targetsByMember = opts.memberIds.length
        ? await loadTargetsByMember(supabase, {
            year: opts.year,
            month: opts.month,
            config,
            memberIds: opts.memberIds,
            canon,
          })
        : new Map<string, Record<string, number | null>>();
      const entryByMember = new Map(
        entries
          .filter((e) => e.plan_id === row.id)
          .map((e) => [e.responsible_id, e as CompEntryRow])
      );
      return {
        row,
        config,
        period,
        targetRates: resolveTargetRates(config, rates, yearQuarterOf(period.to)),
        entryByMember,
        targetsByMember,
      };
    })
  );

  const responsibles: Record<string, string> = {};
  for (const [id] of nameById) {
    const label = nameById.get(canonicalOf(id, canon)) ?? nameById.get(id);
    if (label) responsibles[id] = label;
  }

  const rootByRecordType = new Map<string, SourceDef>();
  for (const s of sources) {
    if (s.parentKey) continue; // sub-fonte compartilha o record_type da pai
    if (!rootByRecordType.has(s.recordType)) rootByRecordType.set(s.recordType, s);
  }

  return {
    year: opts.year,
    month: opts.month,
    sources,
    allFields,
    available,
    canon,
    nameById,
    fkLabels: { responsibles },
    plans,
    rootByRecordType,
  };
}

/**
 * Um operando da fórmula, já resolvido para consulta. Espelha 1:1 uma chave de
 * basis do runCalculatedWidget — que é a unidade real de consulta do cálculo.
 */
export interface FactorOperand {
  /**
   * Chave ESTÁVEL do operando (1ª chave de basis do recorte) — é ela que a
   * engrenagem grava em `config.detailGrouping` para dizer quem fica separado.
   */
  key: string;
  /** Campo agregado ("*" = contagem de linhas). */
  field: string;
  /** Agregações que a fórmula pede sobre este campo (avg emite sum + count). */
  aggs: Set<Aggregation>;
  /** Condições do SOMASE/CONT.SE e/ou o predicado do escopo de fonte. */
  conds: AggCondition[];
  /** Fonte do operando escopado (`agg:…@<fonte>`), quando houver. */
  scope?: SourceKey;
  /** Rótulo do campo p/ a coluna de valor. */
  fieldLabel: string;
  /** "Soma de MRR do contrato" | "Contagem de registros". */
  label: string;
}

/** Agregação efetiva do operando: sum+count juntos vieram de uma MÉDIA. */
function effectiveAgg(aggs: Set<Aggregation>): Aggregation {
  if (aggs.has("sum") && aggs.has("count")) return "avg";
  return aggs.has("sum") ? "sum" : "count";
}

function operandLabel(field: string, agg: Aggregation, fieldLabel: string): string {
  if (agg === "count" && (field === "*" || !field)) return "Contagem de registros";
  return `${AGG_LABELS[agg]} de ${fieldLabel}`;
}

/**
 * OPERANDOS do fator, reproduzindo o lowering do runCalculatedWidget passo a
 * passo (expandAggFormula → lowerSourceScopedOperands → basisKeysFor). É o que
 * garante que a listagem enxergue o MESMO recorte do cálculo: campo calculado
 * agregado aninhado já expandido, operando com escopo de fonte já abaixado para
 * chave condicional, e as condições de SOMASE presentes.
 *
 * Chaves de basis do mesmo recorte (mesmo campo + mesmas condições + mesmo
 * escopo) colapsam num operando só — uma MÉDIA gera `sum:` e `count:` sobre a
 * mesma consulta e não deve virar dois blocos idênticos.
 */
export function factorOperands(
  ctx: CompDetailContext,
  factor: CompFactor
): FactorOperand[] {
  const fieldByKey = new Map(
    ctx.allFields.filter((f) => !isCoreDef(f)).map((f) => [f.field_key, f])
  );
  const expanded = expandAggFormula(factor.formula, (k) => fieldByKey.get(k));
  const lowered = lowerSourceScopedOperands(expanded, ctx.sources);

  const byRecorte = new Map<string, FactorOperand>();
  for (const key of basisKeysFor(lowered)) {
    const cond = parseCondBasisKey(key);
    const metric = basisMetric(key);
    const field = metric.field || "*";
    const conds = cond?.conds ?? [];
    const scope = cond?.scope;
    const gk = JSON.stringify([field, conds, scope ?? null]);
    const cur = byRecorte.get(gk);
    if (cur) {
      cur.aggs.add(metric.agg);
      continue;
    }
    byRecorte.set(gk, {
      key,
      field,
      aggs: new Set([metric.agg]),
      conds,
      ...(scope ? { scope } : {}),
      fieldLabel: recordRefLabel(field, ctx.allFields),
      label: "",
    });
  }

  return [...byRecorte.values()].map((op) => {
    const agg = effectiveAgg(op.aggs);
    return { ...op, label: operandLabel(op.field, agg, op.fieldLabel) };
  });
}

/**
 * Condições do operando (SOMASE / predicado do escopo) como filtros que o MODO
 * LISTA sabe aplicar. NÃO dá para reusar o `condFilters` do RPC aqui: ele emite
 * operadores INTERNOS (`eq_ci`/`neq_ci`/`*_num`, normalizados na 0050) que o
 * funil da listagem não traduz e DESCARTA em silêncio — o filtro sumiria e o
 * recorte voltaria a ser "tudo do responsável", que é justamente o bug que este
 * módulo corrige. O mapeamento é direto e sem operador interno.
 *
 * Limitação assumida: o RPC compara texto normalizado (trim + minúsculas) e
 * número com cast; aqui a comparação é literal. Valor gravado fora do padrão
 * pode ficar de FORA da listagem — erra para menos, nunca para mais.
 */
function listCondFilters(conds: AggCondition[]): WidgetFilter[] {
  const OPS: Record<string, FilterOp> = {
    "=": "eq",
    "<>": "neq",
    "<": "lt",
    ">": "gt",
    "<=": "lte",
    ">=": "gte",
  };
  const out: WidgetFilter[] = [];
  for (const c of conds) {
    if (c.op === "is_null" || c.op === "not_null") {
      out.push({ field: c.ref, op: c.op });
      continue;
    }
    if (c.op === "in") {
      out.push({
        field: c.ref,
        op: "in",
        value: Array.isArray(c.value) ? c.value : [c.value],
      });
      continue;
    }
    const op = OPS[c.op];
    if (!op) continue;
    out.push({
      field: c.ref,
      op,
      value: typeof c.value === "boolean" ? String(c.value) : c.value,
    });
  }
  return out;
}

/**
 * Predicado de "registro útil" para um operando, derivado do SQL da RPC
 * (0054): `sum`/`avg` operam sobre `nullif(campo,'')::numeric` e `count(campo)`
 * conta `nullif(campo,'')` — ou seja, campo vazio/nulo NÃO contribui. Sem esse
 * recorte a listagem enche de linhas "R$ 0,00" que o cálculo ignorou.
 * `count(*)` (campo "*") não filtra nada: ali o recorte É a linha.
 */
function nonEmptyFilters(field: string): WidgetFilter[] {
  if (!field || field === "*") return [];
  if (!listFilterFieldSupported(field)) return [];
  const out: WidgetFilter[] = [{ field, op: "not_null" }];
  // custom:<k> mora como TEXTO no jsonb — string vazia existe e o RPC a
  // descarta. Coluna numérica do núcleo não leva o `neq ""` (o PostgREST
  // rejeitaria o literal vazio num numérico).
  if (field.startsWith("custom:")) out.push({ field, op: "neq", value: "" });
  return out;
}

export type FactorQuery =
  | { ok: true; config: WidgetConfig; period: DashboardPeriod; warnings: string[] }
  | { ok: false; error: string };

/**
 * CHOKE POINT do recorte de UM operando — espelha a consulta que o
 * runCalculatedWidget dispara para a chave de basis correspondente:
 *  - universo: fontes do fator ∪ fontes dos operandos escopados; operando COM
 *    escopo roda como perna só da fonte dele (e com a coluna de data DELA);
 *  - filtros, nesta ordem: `factor.filters` → filtro de membro → condições do
 *    operando (SOMASE / predicado do escopo) → recorte de "campo preenchido".
 * A ordem dos dois primeiros é carregada: mantenha idêntica à do engine.
 */
export function operandRecordQuery(
  ctx: CompDetailContext,
  plan: DetailPlan,
  factor: CompFactor,
  operand: FactorOperand,
  memberId: string
): FactorQuery {
  const memberFilter = memberFilterFor(factor, memberId, ctx.canon, ctx.nameById);
  if ("error" in memberFilter) return { ok: false, error: memberFilter.error };

  const warnings: string[] = [];
  if ((factor.filters ?? []).some((f) => !listFilterFieldSupported(f.field)))
    warnings.push(DETAIL_DROPPED_FILTER_NOTE);
  if (operand.field !== "*" && !listFilterFieldSupported(operand.field))
    warnings.push(DETAIL_UNSUPPORTED_FIELD_NOTE);

  const factorSources = factor.sources ?? [];
  const sources = operand.scope
    ? [operand.scope]
    : factorSources.length > 0
      ? [...new Set([...factorSources, ...scopedSourcesOf(ctx, factor)])]
      : factorSources;
  // Operando escopado janela pela coluna de data da PRÓPRIA fonte (mesma regra
  // da perna auxiliar do engine).
  const period = operand.scope
    ? (scopedAuxPeriod(plan.period, operand.scope, ctx.sources) ?? plan.period)
    : plan.period;

  return {
    ok: true,
    warnings,
    period,
    config: {
      source: "records",
      sources,
      dimensions: [],
      metrics: [],
      filters: [
        ...(factor.filters ?? []),
        memberFilter,
        ...listCondFilters(operand.conds),
        ...nonEmptyFilters(operand.field),
      ],
      visual_type: "tabela",
      settings: { rowMode: "records" },
    },
  };
}

/** Fontes citadas por operandos com escopo, já na fórmula EXPANDIDA. */
function scopedSourcesOf(
  ctx: CompDetailContext,
  factor: CompFactor
): SourceKey[] {
  const fieldByKey = new Map(
    ctx.allFields.filter((f) => !isCoreDef(f)).map((f) => [f.field_key, f])
  );
  return formulaScopedSources(
    expandAggFormula(factor.formula, (k) => fieldByKey.get(k))
  );
}

function planStatement(plan: DetailPlan, memberId: string, label: string) {
  const entry = plan.entryByMember.get(memberId) ?? null;
  if (!entry) return null;
  return statementBreakdown({
    planName: plan.row.name,
    memberLabel: label,
    config: plan.config,
    baseAmountDefault: plan.row.base_amount_default,
    entry,
    targets: plan.targetsByMember.get(memberId) ?? {},
    targetRates: plan.targetRates,
  });
}

function toDetailRow(
  record: RecordRow,
  ctx: CompDetailContext,
  operand: FactorOperand,
  labels: RecordLabels,
  period: DashboardPeriod,
  // R$ por unidade do realizado; null = relação não linear (nada de inventar).
  perUnit: number | null
): CompDetailRecordRow {
  const root = ctx.rootByRecordType.get(record.record_type);
  const dateRef =
    (root && period.fieldBySource?.[root.key]) ?? period.field ?? "closed_at";
  // `count(*)` não tem campo: cada linha vale 1 (é o que a contagem soma).
  const numeric =
    operand.field === "*" ? 1 : Number(resolveRecordRef(record, operand.field));
  return {
    id: record.id,
    date: recordCellValue(record, dateRef, ctx.allFields, labels),
    title: record.title ?? "—",
    sourceLabel: root?.label ?? record.record_type,
    responsibleLabel: recordCellValue(
      record,
      "responsible_id",
      ctx.allFields,
      labels
    ),
    stage: recordCellValue(record, "stage", ctx.allFields, labels),
    value: Number.isFinite(numeric) ? numeric : null,
    contribution:
      perUnit != null && Number.isFinite(numeric)
        ? roundMoney(perUnit * numeric)
        : null,
    origin: operand.label,
    // recordColumnValue (não recordCellValue): resolve também `unified:` e
    // `match:`, que podem ser o campo do operando.
    valueText:
      operand.field === "*"
        ? ""
        : recordColumnValue(
            record,
            operand.field,
            ctx.allFields,
            labels,
            ctx.available
          ),
  };
}

/** Registros de UM operando (janela + contagem exata do recorte). */
async function loadOperandRecords(
  supabase: SupabaseClient,
  ctx: CompDetailContext,
  plan: DetailPlan,
  factor: CompFactor,
  operand: FactorOperand,
  rowBudget: number,
  memberId: string,
  perUnit: number | null
): Promise<CompDetailOperand> {
  const valueLabel = operand.field === "*" ? "Registros" : operand.fieldLabel;
  const query = operandRecordQuery(ctx, plan, factor, operand, memberId);
  if (!query.ok) {
    return {
      label: operand.label,
      valueLabel,
      aggNote: operand.label,
      rows: [],
      listedSum: null,
      total: 0,
      truncated: false,
      warnings: [query.error],
    };
  }

  const maxRows = Math.max(0, Math.min(MAX_DETAIL_ROWS_PER_FACTOR, rowBudget));
  const { rows, total } = await runRecordListWindow(
    supabase,
    query.config,
    query.period,
    ctx.available,
    ctx.sources,
    { offset: 0, maxRows: maxRows + 1 }
  );
  const kept = rows.slice(0, maxRows);
  const detailRows = kept.map((r) =>
    toDetailRow(r, ctx, operand, ctx.fkLabels, query.period, perUnit)
  );
  // Campo que o modo lista não sabe resolver (unified:/match:) não vira Σ — um
  // número ali seria pior que a ausência dele.
  const summable =
    operand.field === "*" || listFilterFieldSupported(operand.field);
  const truncated = total > kept.length;

  const warnings = [...query.warnings];
  if (truncated) warnings.push(detailTruncatedNote(kept.length, total));

  return {
    label: operand.label,
    valueLabel,
    aggNote: detailAggNote(operand.label, total),
    rows: detailRows,
    listedSum:
      summable && !truncated
        ? detailRows.reduce((a, r) => a + (r.value ?? 0), 0)
        : null,
    total,
    truncated,
    warnings,
  };
}

/**
 * Agrupa os operandos para EXIBIÇÃO conforme `config.detailGrouping` (por
 * plano). Operando marcado como separado vira um grupo só dele; os demais caem
 * num grupo único ("Somados"). Sem config, cada operando fica no próprio grupo
 * — o comportamento padrão. Isto é APRESENTAÇÃO: o recorte consultado de cada
 * operando não muda, a fusão acontece depois da consulta.
 */
export function groupOperands(
  operands: FactorOperand[],
  factorId: string,
  grouping: CompDetailGrouping | undefined
): FactorOperand[][] {
  const separate = grouping?.separateByFactor?.[factorId];
  if (!separate || operands.length < 2) return operands.map((o) => [o]);
  const own: FactorOperand[][] = [];
  const merged: FactorOperand[] = [];
  for (const op of operands) {
    if (separate.includes(op.key)) own.push([op]);
    else merged.push(op);
  }
  if (merged.length === 0) return own;
  // Sobrando UM, o grupo tem um membro só e `mergeOperandBlocks` o devolve
  // intacto — soma de um é ele mesmo, sem virar bloco "Somados".
  return [...own, merged];
}

/** Funde os blocos de um grupo num só (rows concatenadas, subtotal somado). */
function mergeOperandBlocks(blocks: CompDetailOperand[]): CompDetailOperand {
  if (blocks.length === 1) return blocks[0];
  const total = blocks.reduce((a, b) => a + b.total, 0);
  const somavel = blocks.every((b) => b.listedSum != null);
  return {
    label: SOMADOS_LABEL,
    // Operandos distintos podem medir coisas diferentes; o rótulo da coluna
    // deixa de prometer um campo específico.
    valueLabel: "Valor",
    aggNote: detailAggNote(
      blocks.map((b) => b.label).join(" + "),
      total
    ),
    rows: blocks.flatMap((b) => b.rows),
    listedSum: somavel
      ? blocks.reduce((a, b) => a + (b.listedSum ?? 0), 0)
      : null,
    total,
    truncated: blocks.some((b) => b.truncated),
    warnings: [...new Set(blocks.flatMap((b) => b.warnings))],
  };
}

/** Memória de um bloco de comissão, com a escada completa. */
function commissionDetail(
  cb: CompCommissionBlockBreakdown,
  block: CompCommissionBlock,
  memberId: string
): CompDetailCommission {
  const mem = commissionMemory(cb);
  return {
    blockId: cb.blockId,
    label: cb.label,
    kind: cb.kind,
    tierBy: cb.tierBy,
    triggerMoney: cb.triggerMoney,
    formula: mem.formula,
    tierNote: mem.tierNote,
    memberTiers: mem.memberTiers,
    value: cb.value,
    tiers: tierLadder(block, memberId, cb.triggerValue),
  };
}

/**
 * Registros de UM membro × fator, um bloco por GRUPO de operandos (a fórmula é
 * decomposta em operandos porque é assim que o cálculo consulta; o agrupamento
 * de EXIBIÇÃO vem da engrenagem). O `breakdown` vem de FORA — realizado, payout
 * e comissão continuam saindo do computeEntry, nunca das linhas.
 */
export async function loadFactorRecords(
  supabase: SupabaseClient,
  ctx: CompDetailContext,
  plan: DetailPlan,
  factor: CompFactor,
  memberId: string,
  breakdown: CompBreakdown | null,
  rowBudget = MAX_DETAIL_ROWS_PER_FACTOR
): Promise<CompDetailFactor> {
  const fb = breakdown?.byFactor[factor.id] ?? null;
  const operands = factorOperands(ctx, factor);

  // ---- Memória de cálculo (o "como isso vira dinheiro") ----
  const roles = commissionRolesOf(plan.config, factor.id);
  const blocksById = new Map(
    (breakdown?.commissionBlocks ?? []).map((b) => [b.blockId, b])
  );
  const uv =
    fb && breakdown
      ? resolvedUnitValue(factor, fb, roles, blocksById, breakdown.base)
      : null;
  const payoutFormula =
    fb && breakdown && factor.weightPct > 0 && !fb.overridden.payout && fb.attainmentPct != null
      ? factorPayoutFormula(
          breakdown.base,
          factor.weightPct,
          fb.attainmentPct,
          fb.payout
        )
      : null;
  const commissions = roles.flatMap((role) => {
    const cb = blocksById.get(role.block.id);
    return cb ? [commissionDetail(cb, role.block, memberId)] : [];
  });

  const base = {
    factorId: factor.id,
    label: factor.label,
    money: factor.money,
    realized: fb?.realized ?? null,
    payoutFormula,
    unitValue: uv?.perUnit ?? null,
    // Operando de contagem conta LINHAS: a unidade é o registro. Operando de
    // campo mede o próprio campo, então a frase fala em reais.
    unitLabel: operands[0]?.field === "*" ? "registro" : factor.label,
    commissions,
    warnings: [] as string[],
  };
  if (operands.length === 0) {
    return { ...base, operands: [], listedForCompare: null };
  }

  // Orçamento repartido entre os operandos do fator (o teto por fator continua
  // valendo p/ o conjunto).
  const perOperand = Math.max(
    1,
    Math.floor(Math.max(0, rowBudget) / operands.length)
  );
  const byKey = new Map<string, CompDetailOperand>();
  for (const operand of operands) {
    byKey.set(
      operand.key,
      await loadOperandRecords(
        supabase,
        ctx,
        plan,
        factor,
        operand,
        perOperand,
        memberId,
        uv?.perUnit ?? null
      )
    );
  }
  const grupos = groupOperands(
    operands,
    factor.id,
    plan.config.detailGrouping
  );
  const blocks = grupos.map((g) =>
    mergeOperandBlocks(
      g.flatMap((o) => {
        const b = byKey.get(o.key);
        return b ? [b] : [];
      })
    )
  );

  return {
    ...base,
    operands: blocks,
    // A conferência exige um operando puro E nenhuma fusão em jogo.
    listedForCompare:
      blocks.length === 1
        ? comparableQuantity(ctx, factor, operands, blocks)
        : null,
  };
}

/**
 * Quantidade listada confrontável com o realizado. Existe SÓ quando a fórmula
 * é um operando puro (um único token de campo): aí o valor do fator É a soma
 * (ou a contagem) daquele recorte e a conferência é exata. Qualquer combinação
 * — média, diferença de somas, constante — não tem um número único a comparar.
 */
function comparableQuantity(
  ctx: CompDetailContext,
  factor: CompFactor,
  operands: FactorOperand[],
  blocks: CompDetailOperand[]
): number | null {
  if (operands.length !== 1 || blocks.length !== 1) return null;
  const fieldByKey = new Map(
    ctx.allFields.filter((f) => !isCoreDef(f)).map((f) => [f.field_key, f])
  );
  const lowered = lowerSourceScopedOperands(
    expandAggFormula(factor.formula, (k) => fieldByKey.get(k)),
    ctx.sources
  );
  if (lowered.tokens.length !== 1 || lowered.tokens[0].kind !== "field")
    return null;
  const agg = effectiveAgg(operands[0].aggs);
  if (agg === "count") return blocks[0].total;
  if (agg === "sum") return blocks[0].listedSum;
  return null; // média: o Σ das linhas não é o valor do operando
}

export type FactorDetailResult =
  | {
      ok: true;
      detail: CompDetailFactor;
      planName: string;
      memberLabel: string;
      apuracaoShifted: boolean;
    }
  | { ok: false; message: string };

/** Uma célula (diálogo de conferência da tela). */
export async function loadFactorDetail(
  supabase: SupabaseClient,
  ctx: CompDetailContext,
  opts: { planId: string; factorId: string; memberId: string; memberLabel: string }
): Promise<FactorDetailResult> {
  const plan = ctx.plans.find((p) => p.row.id === opts.planId);
  if (!plan) return { ok: false, message: "Plano não encontrado ou inativo." };
  const factor = plan.config.factors.find((f) => f.id === opts.factorId);
  if (!factor) return { ok: false, message: "Fator não encontrado no plano." };

  const derived = planStatement(plan, opts.memberId, opts.memberLabel);
  const detail = await loadFactorRecords(
    supabase,
    ctx,
    plan,
    factor,
    opts.memberId,
    derived?.breakdown ?? null
  );
  return {
    ok: true,
    detail,
    planName: plan.row.name,
    memberLabel: opts.memberLabel,
    apuracaoShifted: plan.config.apuracao === "mes_anterior",
  };
}

/** Erro de TETO — o export degrada (sai sem detalhamento) em vez de falhar. */
export class CompDetailTooLargeError extends Error {}

/**
 * Matriz inteira do export: um bloco por membro × plano COM lançamento no mês
 * (sem lançamento não há realizado a detalhar). Membro sem nenhum lançamento
 * sai de fora — a visão geral simplesmente não ganha hiperlink para ele.
 */
export async function loadCompDetail(
  supabase: SupabaseClient,
  ctx: CompDetailContext,
  members: { id: string; label: string; tabName: string }[]
): Promise<CompDetailMember[]> {
  const planned: {
    member: (typeof members)[number];
    plan: DetailPlan;
    factor: CompFactor;
  }[] = [];
  for (const member of members) {
    for (const plan of ctx.plans) {
      if (!plan.entryByMember.has(member.id)) continue;
      for (const factor of plan.config.factors)
        planned.push({ member, plan, factor });
    }
  }
  if (planned.length > MAX_DETAIL_QUERIES) {
    throw new CompDetailTooLargeError(
      `Detalhamento grande demais para gerar de uma vez (máx. ${MAX_DETAIL_QUERIES} consultas).`
    );
  }

  // Orçamento de linhas COMPARTILHADO: os primeiros fatores levam o que
  // precisam e o resto degrada para lista truncada — nunca estoura o payload.
  // A reserva acontece ANTES do await (as consultas rodam concorrentes; ler o
  // saldo depois deixaria N tarefas gastarem o mesmo saldo) e o que sobrar
  // volta para o bolo.
  let budget = MAX_DETAIL_ROWS_BUDGET;
  const runLimited = createTaskLimiter(WIDGET_TASK_CONCURRENCY);
  const results = new Map<string, CompDetailFactor>();
  await Promise.all(
    planned.map(({ member, plan, factor }) =>
      runLimited(async () => {
        const derived = planStatement(plan, member.id, member.label);
        const take = Math.max(
          0,
          Math.min(MAX_DETAIL_ROWS_PER_FACTOR, budget - DETAIL_ROWS_OVERHEAD)
        );
        budget -= take + DETAIL_ROWS_OVERHEAD;
        const detail = await loadFactorRecords(
          supabase,
          ctx,
          plan,
          factor,
          member.id,
          derived?.breakdown ?? null,
          take
        );
        const usadas = detail.operands.reduce((a, o) => a + o.rows.length, 0);
        budget += take - usadas;
        results.set(`${member.id}:${plan.row.id}:${factor.id}`, detail);
      })
    )
  );

  const out: CompDetailMember[] = [];
  for (const member of members) {
    const plans: CompDetailPlan[] = [];
    let monthTotal: number | null = null;
    for (const plan of ctx.plans) {
      if (!plan.entryByMember.has(member.id)) continue;
      const derived = planStatement(plan, member.id, member.label);
      if (derived?.breakdown.total != null)
        monthTotal = (monthTotal ?? 0) + derived.breakdown.total;
      const factors = plan.config.factors
        .map((f) => results.get(`${member.id}:${plan.row.id}:${f.id}`))
        .filter((f): f is CompDetailFactor => Boolean(f));
      const blockById = new Map(
        (plan.config.commissions ?? []).map((b) => [b.id, b])
      );
      const commissions = (derived?.breakdown.commissionBlocks ?? []).flatMap(
        (cb) => {
          const block = blockById.get(cb.blockId);
          return block ? [commissionDetail(cb, block, member.id)] : [];
        }
      );
      plans.push({
        planId: plan.row.id,
        planName: plan.row.name,
        factors,
        commissions,
      });
    }
    if (plans.length === 0) continue;
    out.push({
      memberId: member.id,
      label: member.label,
      tabName: member.tabName,
      plans,
      monthTotal,
    });
  }
  return out;
}
