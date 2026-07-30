// Versão: 1.0 | Data: 30/07/2026
// Engine I/O da remuneração variável (0112): recomputa o mês de um plano
// consultando o REALIZADO de cada membro×fator SÓ pelo choke point
// runCalculatedWidget (fórmula agregada + filtro `responsible_id eq`, que o
// próprio choke point expande para o grupo canônico — RPCs de widget
// INTOCADOS) e regravando em comp_entries APENAS o snapshot CRU
// (computed.realized) + o total efetivo derivado por computeEntry.
// Recompute NUNCA toca inputs/base_amount — overrides sobrevivem sempre.
// Alvos vêm de `goals` (scope 'responsible'): batch único por mês/métricas,
// dobrado apelido→canônico (linha do canônico vence; apelido preenche
// ausência — meta digitada no apelido pela área Metas não some).
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadSources } from "@/lib/config/sources";
import { loadCorrespondences } from "@/lib/correspondences";
import {
  canonicalOf,
  expandResponsibleIds,
  loadResponsibleCanon,
  type ResponsibleCanon,
} from "@/lib/config/responsible-canon";
import type { FieldDefinition } from "@/lib/records/types";
import { loadCurrencyRates, yearQuarterOf } from "@/lib/widgets/currency";
import { runCalculatedWidget } from "@/lib/widgets/formula-metric";
import {
  createTaskLimiter,
  WIDGET_TASK_CONCURRENCY,
} from "@/lib/widgets/task-limiter";
import type { WidgetFilter } from "@/lib/widgets/types";

import {
  computeEntry,
  monthPeriod,
  parseCompEntryInputs,
  parseCompPlanConfig,
  type CompComputedRaw,
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
 * Membros do plano: `config.memberIds` (∩ ativos) ou todos os responsáveis
 * ATIVOS canônicos (apelido nunca vira linha — mesma regra de
 * collapseResponsibleOptions).
 */
export function memberResponsibles(
  responsibles: { id: string; display_name: string | null }[],
  canon: ResponsibleCanon,
  config: CompPlanConfig
): { id: string; display_name: string | null }[] {
  if (config.memberIds && config.memberIds.length > 0) {
    const byId = new Map(responsibles.map((r) => [r.id, r]));
    return config.memberIds
      .map((id) => byId.get(id))
      .filter((r): r is { id: string; display_name: string | null } => !!r);
  }
  return responsibles.filter((r) => !canon.canonicalById.has(r.id));
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

  const [sources, correspondences, fieldsRes, rates, canon, respRes, entriesRes] =
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
      supabase
        .from("responsibles")
        .select("id, display_name")
        .eq("active", true),
      supabase
        .from("comp_entries")
        .select(
          "id, responsible_id, base_amount, inputs, computed, total, mirror_record_id, published_at"
        )
        .eq("plan_id", opts.plan.id)
        .eq("period_year", opts.year)
        .eq("period_month", opts.month),
    ]);
  const allFields = (fieldsRes.data ?? []) as FieldDefinition[];
  const responsibles = (respRes.data ?? []) as {
    id: string;
    display_name: string | null;
  }[];
  const entries = (entriesRes.data ?? []) as CompEntryRow[];

  const members = memberResponsibles(responsibles, canon, config);
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
            const filters: WidgetFilter[] = [
              ...(factor.filters ?? []),
              { field: "responsible_id", op: "eq", value: member.id },
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
      targetsByMember.get(member.id) ?? {}
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
