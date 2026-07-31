// Versão: 1.3 | Data: 31/07/2026
// v1.3: match de membro por CAMPO do registro (factor.memberField) — o filtro
// injetado vira `<campo> in (display_names do grupo canônico)` via
// memberFilterFor (expansão por CONJUNTO DE NOMES; expandResponsibleFilters
// segue só p/ responsible_id, intocado); membro sem nome ⇒ errors[fid], nunca
// consulta sem filtro. Alvos em moeda estrangeira: resolveTargetRates (moeda →
// R$/unidade no trimestre do mês) alimenta o computeEntry — taxa ausente ⇒
// atingimento null (fail-closed no modelo).
// v1.2: membros por OPERAÇÃO — recompute resolve config.memberOperationIds
// via loadOperationScopes (subárvore viva) + operationMembersFromScopes
// (canonicaliza) e memberResponsibles ganha o 4º arg com os ids resolvidos.
// Engine I/O da remuneração variável (0112): recomputa o mês de um plano
// consultando o REALIZADO de cada membro×fator SÓ pelo choke point
// runCalculatedWidget (fórmula agregada + filtro `responsible_id eq`, que o
// próprio choke point expande para o grupo canônico — RPCs de widget
// INTOCADOS) e regravando em comp_entries APENAS o snapshot CRU
// (computed.realized) + o total efetivo derivado por computeEntry.
// Recompute NUNCA toca inputs/base_amount — overrides sobrevivem sempre.
// v1.1: member.id vai ao computeEntry (tabela de faixas de comissão do membro).
// Alvos vêm de `goals` (scope 'responsible'): batch único por mês/métricas,
// dobrado apelido→canônico (linha do canônico vence; apelido preenche
// ausência — meta digitada no apelido pela área Metas não some).
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadSources } from "@/lib/config/sources";
import { loadCorrespondences } from "@/lib/correspondences";
import {
  loadOperationScopes,
  type OperationScope,
} from "@/lib/config/operation-scope";
import {
  canonicalOf,
  expandResponsibleIds,
  loadResponsibleCanon,
  type ResponsibleCanon,
} from "@/lib/config/responsible-canon";
import type { FieldDefinition } from "@/lib/records/types";
import {
  loadCurrencyRates,
  resolveRate,
  yearQuarterOf,
  type CurrencyRates,
} from "@/lib/widgets/currency";
import { runCalculatedWidget } from "@/lib/widgets/formula-metric";
import {
  createTaskLimiter,
  WIDGET_TASK_CONCURRENCY,
} from "@/lib/widgets/task-limiter";
import type { WidgetFilter } from "@/lib/widgets/types";

import {
  computeEntry,
  explicitMemberIds,
  factorTargetCurrencies,
  lastDayOfMonth,
  monthPeriod,
  parseCompEntryInputs,
  parseCompPlanConfig,
  resolveOperationMembers,
  type CompComputedRaw,
  type CompFactor,
  type CompPlanConfig,
} from "./model";

// Teto defensivo de consultas por recompute (membros × fatores).
export const MAX_RECOMPUTE_CELLS = 400;

/** Linha crua de comp_plans (o config é parseado fail-closed aqui dentro). */
export interface CompPlanRow {
  id: string;
  name: string;
  active: boolean;
  base_amount_default: number | null;
  config: unknown;
}

export interface CompEntryRow {
  id: string;
  responsible_id: string;
  base_amount: number | null;
  inputs: unknown;
  computed: unknown;
  total: number | null;
  mirror_record_id: string | null;
  published_at: string | null;
  updated_at?: string;
}

export interface RecomputeResult {
  ok: boolean;
  message?: string;
  members?: number;
  factors?: number;
  queryErrors?: number;
}

/**
 * Membros do plano: lista explícita (memberIds ∪ operações resolvidas, ∩
 * ativos) ou todos os responsáveis ATIVOS canônicos (apelido nunca vira linha
 * — mesma regra de collapseResponsibleOptions). `operationMemberIds` = ids já
 * CANÔNICOS resolvidos das operações do plano (operationMembersFromScopes);
 * segue pura — a resolução com I/O é do caller.
 */
export function memberResponsibles(
  responsibles: { id: string; display_name: string | null }[],
  canon: ResponsibleCanon,
  config: CompPlanConfig,
  operationMemberIds: string[] = []
): { id: string; display_name: string | null }[] {
  const explicit = explicitMemberIds(config, operationMemberIds);
  if (explicit !== null) {
    const byId = new Map(responsibles.map((r) => [r.id, r]));
    return explicit
      .map((id) => byId.get(id))
      .filter((r): r is { id: string; display_name: string | null } => !!r)
      // Defensivo: um apelido que escapou da canonicalização nunca vira linha.
      .filter((r) => !canon.canonicalById.has(r.id));
  }
  return responsibles.filter((r) => !canon.canonicalById.has(r.id));
}

/**
 * Filtro de MEMBRO de um fator: sem memberField é o clássico
 * `responsible_id eq` (o choke point expande para o grupo canônico); com
 * memberField o match é por NOME — `<campo> in (display_names do grupo
 * canônico do membro, apelidos inclusos)`, valores exatamente como o sync
 * grava (lookups.userName / responsibles.display_name). Membro sem nenhum
 * nome ⇒ erro (a célula isola como falha de consulta; NUNCA consultar sem o
 * filtro — vazaria o realizado global p/ todo membro).
 */
export function memberFilterFor(
  factor: CompFactor,
  memberId: string,
  canon: ResponsibleCanon,
  nameById: Map<string, string | null>
): WidgetFilter | { error: string } {
  if (!factor.memberField) {
    return { field: "responsible_id", op: "eq", value: memberId };
  }
  const names: string[] = [];
  for (const id of expandResponsibleIds([memberId], canon)) {
    const name = nameById.get(id);
    if (name && name.trim() !== "" && !names.includes(name)) names.push(name);
  }
  if (names.length === 0) {
    return {
      error:
        "Membro sem nome de exibição para casar o campo do plano (memberField).",
    };
  }
  return { field: factor.memberField, op: "in", value: names };
}

/**
 * Taxas de conversão dos ALVOS (moeda → R$/unidade) no trimestre do mês —
 * insumo do computeEntry p/ fatores com targetCurrency. Moeda sem taxa fica
 * null (o modelo falha fechado: atingimento null + targetRateMissing).
 */
export function resolveTargetRates(
  config: CompPlanConfig,
  rates: CurrencyRates,
  conv: { year: number; quarter: number }
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const code of factorTargetCurrencies(config)) {
    out[code] = resolveRate(rates, code, conv.year, conv.quarter);
  }
  return out;
}

/**
 * Conveniência p/ os callers fora do recompute (deriveTotal/publish/pages):
 * fast path SEM consulta quando o plano não usa moeda de alvo; senão carrega
 * as taxas e resolve no trimestre do fim do mês (mesma regra do recompute —
 * yearQuarterOf(period.to)).
 */
export async function loadTargetRatesForConfig(
  supabase: SupabaseClient,
  config: CompPlanConfig,
  year: number,
  month: number
): Promise<Record<string, number | null>> {
  if (factorTargetCurrencies(config).length === 0) return {};
  const rates = await loadCurrencyRates(supabase);
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(
    lastDayOfMonth(year, month)
  ).padStart(2, "0")}`;
  return resolveTargetRates(config, rates, yearQuarterOf(monthEnd));
}

/**
 * opId → ids CANÔNICOS dedup a partir dos escopos de operação. O vínculo
 * (`responsible_operations`) pode apontar um APELIDO — canonicalizar aqui
 * garante linha na grade e alvo em goals no principal.
 */
export function operationMembersFromScopes(
  scopes: Map<string, OperationScope>,
  canon: ResponsibleCanon
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [opId, scope] of scopes) {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const raw of scope.responsibleIds) {
      const id = canonicalOf(raw, canon);
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    out[opId] = ids;
  }
  return out;
}

/**
 * Alvos do mês por membro (chaveados por factorId), lidos de `goals` num batch
 * único: `responsible_id in (grupo canônico expandido)` + `metric in (chaves
 * dos fatores)`. Dobra apelido→canônico: linha do id CANÔNICO sempre vence;
 * apelido só preenche ausência.
 */
export async function loadTargetsByMember(
  supabase: SupabaseClient,
  opts: {
    year: number;
    month: number;
    config: CompPlanConfig;
    memberIds: string[];
    canon: ResponsibleCanon;
  }
): Promise<Map<string, Record<string, number | null>>> {
  const out = new Map<string, Record<string, number | null>>();
  const metricKeys = opts.config.factors.map((f) => f.metricKey);
  if (metricKeys.length === 0 || opts.memberIds.length === 0) return out;
  const factorByMetric = new Map(
    opts.config.factors.map((f) => [f.metricKey, f.id])
  );
  const expanded = expandResponsibleIds(opts.memberIds, opts.canon);
  const { data, error } = await supabase
    .from("goals")
    .select("responsible_id, metric, target")
    .eq("period_year", opts.year)
    .eq("period_month", opts.month)
    .eq("scope", "responsible")
    .in("metric", metricKeys)
    .in("responsible_id", expanded);
  if (error) return out;
  const rows = (data ?? []) as {
    responsible_id: string | null;
    metric: string;
    target: number | null;
  }[];
  const memberSet = new Set(opts.memberIds);
  for (const row of rows) {
    if (!row.responsible_id) continue;
    const canonId = canonicalOf(row.responsible_id, opts.canon);
    if (!memberSet.has(canonId)) continue;
    const factorId = factorByMetric.get(row.metric);
    if (!factorId) continue;
    const bucket = out.get(canonId) ?? {};
    const isCanonicalRow = row.responsible_id === canonId;
    if (isCanonicalRow || bucket[factorId] == null) {
      bucket[factorId] =
        typeof row.target === "number" && Number.isFinite(row.target)
          ? row.target
          : null;
    }
    out.set(canonId, bucket);
  }
  return out;
}

/**
 * Recomputa o mês do plano: uma consulta runCalculatedWidget por membro×fator
 * (serializada pelo task-limiter compartilhado), snapshot CRU + total efetivo
 * regravados por entry. `supabase` = client RLS (tabelas); `rpcClient` = o
 * mesmo client embrulhado em memo/TTL para as consultas de widget.
 */
export async function recomputePlanMonth(
  supabase: SupabaseClient,
  rpcClient: SupabaseClient,
  opts: { plan: CompPlanRow; year: number; month: number; orgId: string | null }
): Promise<RecomputeResult> {
  const config = parseCompPlanConfig(opts.plan.config);
  if (!config) {
    return {
      ok: false,
      message: "Configuração do plano inválida — reabra e salve o plano.",
    };
  }
  if (config.factors.length === 0) {
    return { ok: false, message: "O plano não tem fatores." };
  }

  const [sources, correspondences, fieldsRes, rates, canon, respRes, entriesRes, opScopes] =
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
      // TODOS os responsáveis (apelidos/inativos inclusos): o nameById do
      // memberFilterFor precisa dos nomes do grupo canônico inteiro; a lista
      // de MEMBROS segue só o subset ativo (comportamento clássico).
      supabase.from("responsibles").select("id, display_name, active"),
      supabase
        .from("comp_entries")
        .select(
          "id, responsible_id, base_amount, inputs, computed, total, mirror_record_id, published_at"
        )
        .eq("plan_id", opts.plan.id)
        .eq("period_year", opts.year)
        .eq("period_month", opts.month),
      config.memberOperationIds?.length
        ? loadOperationScopes(supabase, config.memberOperationIds)
        : Promise.resolve(new Map<string, OperationScope>()),
    ]);
  const allFields = (fieldsRes.data ?? []) as FieldDefinition[];
  const allResponsibles = (respRes.data ?? []) as {
    id: string;
    display_name: string | null;
    active: boolean;
  }[];
  const responsibles = allResponsibles.filter((r) => r.active);
  const nameById = new Map(allResponsibles.map((r) => [r.id, r.display_name]));
  const entries = (entriesRes.data ?? []) as CompEntryRow[];

  const operationMemberIds = resolveOperationMembers(
    config.memberOperationIds,
    operationMembersFromScopes(opScopes, canon)
  );
  const members = memberResponsibles(responsibles, canon, config, operationMemberIds);
  if (members.length === 0)
    return { ok: false, message: "O plano não tem membros ativos." };
  if (members.length * config.factors.length > MAX_RECOMPUTE_CELLS) {
    return {
      ok: false,
      message: `Plano grande demais para recalcular de uma vez (máx. ${MAX_RECOMPUTE_CELLS} células).`,
    };
  }

  const targetsByMember = await loadTargetsByMember(supabase, {
    year: opts.year,
    month: opts.month,
    config,
    memberIds: members.map((m) => m.id),
    canon,
  });

  const period = monthPeriod(opts.year, opts.month, sources);
  const conversionPeriod = yearQuarterOf(period.to);
  const targetRates = resolveTargetRates(config, rates, conversionPeriod);
  const runLimited = createTaskLimiter(WIDGET_TASK_CONCURRENCY);
  const nowIso = new Date().toISOString();
  let queryErrors = 0;

  // Uma consulta por membro×fator; falha de UMA célula isola (realized null +
  // errors[fid]) — os demais fatores do membro seguem valendo.
  const perMember = await Promise.all(
    members.map(async (member) => {
      const realized: Record<string, number | null> = {};
      const errors: Record<string, string> = {};
      await Promise.all(
        config.factors.map((factor) =>
          runLimited(async () => {
            const memberFilter = memberFilterFor(factor, member.id, canon, nameById);
            if ("error" in memberFilter) {
              realized[factor.id] = null;
              errors[factor.id] = memberFilter.error;
              queryErrors += 1;
              return;
            }
            const filters: WidgetFilter[] = [
              ...(factor.filters ?? []),
              memberFilter,
            ];
            try {
              const res = await runCalculatedWidget(rpcClient, {
                formula: factor.formula,
                sources: factor.sources,
                sourceDefs: sources,
                filters,
                period,
                correspondences,
                currencyMode: "fixed",
                currencyCode: "BRL",
                allowNegative: true,
                fields: allFields,
                rates,
                conversionPeriod,
              });
              realized[factor.id] = res.value;
            } catch (e) {
              realized[factor.id] = null;
              errors[factor.id] =
                e instanceof Error ? e.message : "Falha na consulta.";
              queryErrors += 1;
            }
          })
        )
      );
      const computed: CompComputedRaw = {
        v: 1,
        at: nowIso,
        realized,
        ...(Object.keys(errors).length > 0 ? { errors } : {}),
      };
      return { member, computed };
    })
  );

  const entryByMember = new Map(entries.map((e) => [e.responsible_id, e]));
  for (const { member, computed } of perMember) {
    const entry = entryByMember.get(member.id);
    const inputs = parseCompEntryInputs(entry?.inputs);
    const breakdown = computeEntry(
      config,
      entry?.base_amount ?? opts.plan.base_amount_default,
      inputs,
      computed.realized,
      targetsByMember.get(member.id) ?? {},
      member.id,
      targetRates
    );
    // Update NUNCA toca inputs/base_amount (overrides sobrevivem ao recompute);
    // insert novo carimba org (WITH CHECK falha alto em org errada).
    const { error } = entry
      ? await supabase
          .from("comp_entries")
          .update({ computed, total: breakdown.total })
          .eq("id", entry.id)
      : await supabase.from("comp_entries").insert({
          plan_id: opts.plan.id,
          responsible_id: member.id,
          period_year: opts.year,
          period_month: opts.month,
          computed,
          total: breakdown.total,
          ...(opts.orgId ? { organization_id: opts.orgId } : {}),
        });
    if (error) return { ok: false, message: error.message };
  }

  return {
    ok: true,
    members: members.length,
    factors: config.factors.length,
    queryErrors,
  };
}
