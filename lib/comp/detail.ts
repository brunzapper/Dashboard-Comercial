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
  DETAIL_DROPPED_FILTER_NOTE,
  DETAIL_SCOPED_SOURCE_NOTE,
  detailAggNote,
  detailTruncatedNote,
} from "@/lib/comp/commission-label";
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
  recordRefLabel,
  resolveRecordRef,
  type RecordLabels,
} from "@/lib/export/record-cells";
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import type { SourceDef } from "@/lib/sources";
import { parseAggRef } from "@/lib/widgets/calc-metrics";
import { loadCurrencyRates, yearQuarterOf } from "@/lib/widgets/currency";
import { buildAvailableFields, type AvailableField } from "@/lib/widgets/fields";
import type { DashboardPeriod } from "@/lib/widgets/period";
import {
  listFilterFieldSupported,
  runRecordListWindow,
} from "@/lib/widgets/record-list";
import { createTaskLimiter, WIDGET_TASK_CONCURRENCY } from "@/lib/widgets/task-limiter";
import { AGG_LABELS, type WidgetConfig } from "@/lib/widgets/types";

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
  /** Operando agregado principal, CRU (a formatação é da planilha/da tela). */
  value: number | null;
  /** Demais operandos da fórmula: "Campo: v · Campo2: v". */
  extras: string;
}

export interface CompDetailFactor {
  factorId: string;
  label: string;
  money: boolean;
  /** Rótulo da coluna de valor ("Valor", "Registros"…). */
  valueLabel: string;
  /** "Soma de Valor · 42 registros no recorte". */
  aggNote: string;
  /** AUTORIDADE — realizado efetivo do fator (computeEntry). */
  realized: number | null;
  /** Σ da coluna listada; null quando somar não faz sentido (média/mín/máx). */
  listedSum: number | null;
  rows: CompDetailRecordRow[];
  /** Tamanho do recorte inteiro (contagem exata), mesmo com lista truncada. */
  total: number;
  truncated: boolean;
  warnings: string[];
}

export interface CompDetailPlan {
  planId: string;
  planName: string;
  factors: CompDetailFactor[];
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

/** Coluna de valor por registro derivada de um operando `agg:` da fórmula. */
export interface FactorValueColumn {
  ref: string;
  agg: string;
  label: string;
}

/**
 * Operandos agregados da fórmula do fator, em ordem de aparição e sem repetir
 * o mesmo campo. Contagens (`agg:count:*`) não viram coluna — a evidência
 * delas é a própria existência da linha.
 */
export function factorValueColumns(
  factor: CompFactor,
  allFields: FieldDefinition[]
): FactorValueColumn[] {
  const out: FactorValueColumn[] = [];
  const seen = new Set<string>();
  for (const token of factor.formula?.tokens ?? []) {
    if (token.kind !== "field" || !token.ref.startsWith("agg:")) continue;
    const { agg, field } = parseAggRef(token.ref);
    if (agg === "count" || field === "*" || field === "id") continue;
    if (seen.has(field)) continue;
    seen.add(field);
    out.push({ ref: field, agg, label: recordRefLabel(field, allFields) });
  }
  return out;
}

/** Fontes citadas por operandos com escopo `@<fonte>` na fórmula do fator. */
function scopedSourceKeys(factor: CompFactor): string[] {
  const out = new Set<string>();
  for (const token of factor.formula?.tokens ?? []) {
    if (token.kind !== "field" || !token.ref.startsWith("agg:")) continue;
    const { source } = parseAggRef(token.ref);
    if (source) out.add(source);
  }
  return [...out];
}

export type FactorQuery =
  | { ok: true; config: WidgetConfig; period: DashboardPeriod; warnings: string[] }
  | { ok: false; error: string };

/**
 * CHOKE POINT do recorte — espelha o que recomputePlanMonth manda ao
 * runCalculatedWidget. A ordem dos filtros (`factor.filters` e DEPOIS o filtro
 * de membro) é carregada: mantenha idêntica à do engine.
 */
export function factorRecordQuery(
  ctx: CompDetailContext,
  plan: DetailPlan,
  factor: CompFactor,
  memberId: string
): FactorQuery {
  const memberFilter = memberFilterFor(factor, memberId, ctx.canon, ctx.nameById);
  if ("error" in memberFilter) return { ok: false, error: memberFilter.error };

  const warnings: string[] = [];
  if ((factor.filters ?? []).some((f) => !listFilterFieldSupported(f.field)))
    warnings.push(DETAIL_DROPPED_FILTER_NOTE);
  const factorSources = factor.sources ?? [];
  if (
    factorSources.length > 0 &&
    scopedSourceKeys(factor).some((k) => !factorSources.includes(k))
  )
    warnings.push(DETAIL_SCOPED_SOURCE_NOTE);

  return {
    ok: true,
    warnings,
    period: plan.period,
    config: {
      source: "records",
      sources: factorSources,
      dimensions: [],
      metrics: [],
      filters: [...(factor.filters ?? []), memberFilter],
      visual_type: "tabela",
      settings: { rowMode: "records" },
    },
  };
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
  cols: FactorValueColumn[],
  labels: RecordLabels,
  period: DashboardPeriod
): CompDetailRecordRow {
  const root = ctx.rootByRecordType.get(record.record_type);
  const dateRef =
    (root && period.fieldBySource?.[root.key]) ?? period.field ?? "closed_at";
  const primary = cols[0];
  const raw = primary ? Number(resolveRecordRef(record, primary.ref)) : 1;
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
    value: Number.isFinite(raw) ? raw : null,
    extras: cols
      .slice(1)
      .map(
        (c) => `${c.label}: ${recordCellValue(record, c.ref, ctx.allFields, labels)}`
      )
      .join(" · "),
  };
}

/**
 * Registros de UM membro × fator (janela de MAX_DETAIL_ROWS_PER_FACTOR, com a
 * contagem exata do recorte). `realized` vem de FORA (do breakdown do plano) —
 * nunca é derivado das linhas.
 */
export async function loadFactorRecords(
  supabase: SupabaseClient,
  ctx: CompDetailContext,
  plan: DetailPlan,
  factor: CompFactor,
  memberId: string,
  realized: number | null,
  rowBudget = MAX_DETAIL_ROWS_PER_FACTOR
): Promise<CompDetailFactor> {
  const cols = factorValueColumns(factor, ctx.allFields);
  const primary = cols[0];
  const valueLabel = primary ? primary.label : "Registros";
  const aggLabel = primary
    ? `${AGG_LABELS[primary.agg as keyof typeof AGG_LABELS] ?? primary.agg} de ${primary.label}`
    : "Contagem de registros";
  const base = {
    factorId: factor.id,
    label: factor.label,
    money: factor.money,
    valueLabel,
    realized,
  };

  const query = factorRecordQuery(ctx, plan, factor, memberId);
  if (!query.ok) {
    return {
      ...base,
      aggNote: aggLabel,
      listedSum: null,
      rows: [],
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
    toDetailRow(r, ctx, cols, ctx.fkLabels, query.period)
  );
  // Somar só faz sentido para soma/contagem — média/mín/máx não se reconstroem
  // por adição, e um Σ ali sugeriria uma conferência que não existe.
  const summable = !primary || primary.agg === "sum";
  const listedSum = summable
    ? detailRows.reduce((a, r) => a + (r.value ?? 0), 0)
    : null;
  const truncated = total > kept.length;

  const warnings = [...query.warnings];
  if (truncated) warnings.push(detailTruncatedNote(kept.length, total));

  return {
    ...base,
    aggNote: detailAggNote(aggLabel, total),
    listedSum,
    rows: detailRows,
    total,
    truncated,
    warnings,
  };
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
  const realized = derived?.breakdown.byFactor[factor.id]?.realized ?? null;
  const detail = await loadFactorRecords(
    supabase,
    ctx,
    plan,
    factor,
    opts.memberId,
    realized
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
        const realized = derived?.breakdown.byFactor[factor.id]?.realized ?? null;
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
          realized,
          take
        );
        budget += take - detail.rows.length;
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
      plans.push({ planId: plan.row.id, planName: plan.row.name, factors });
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
