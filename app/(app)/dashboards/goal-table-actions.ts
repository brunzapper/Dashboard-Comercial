// Versão: 1.1 | Data: 01/10/2026
// v1.1 (01/10/2026): `loadTreeIndicatorValues` respeita os meses FIXOS da
//   Tree (`settings.tree.months`, saneados por `cleanMonthKeys`).
// Server Actions da TABELA DE METAS (visual_type 'metas', 0149) e dos valores
// de indicador da Tree.
//
// Escopo SEMPRE pelo widget-scope (invariante 12): o período efetivo da aba e
// do card sai de `loadWidgetScope`, nunca remontado aqui. Os valores saem do
// dono único `resolveIndicatorValues` (lib/indicators/values.ts) — meta por
// `resolveGoal`, realizado por `runCalculatedWidget`; RPCs intocadas.
//
// Edição de célula: SÓ por `upsertGoalTarget`/`deleteGoalTarget`
// (lib/metas/upsert.ts — a dança find-then-update única). Célula vazia EXCLUI
// a meta (nunca target = 0). Gate = admin (a RLS de goals já exige) + o widget
// ter `editable` ligado.
"use server";

import { getActiveOrgId } from "@/lib/auth/org";
import { getSessionInfo } from "@/lib/auth/session";
import { todayBrasiliaIso } from "@/lib/date/today";
import { createClient } from "@/lib/supabase/server";
import { loadGoalMetrics } from "@/lib/config/goal-metrics";
import {
  loadResponsibleNameIndex,
  responsibleIdForName,
} from "@/lib/config/responsible-names";
import { indicatorsByKey, loadIndicators } from "@/lib/indicators/load";
import {
  cleanMonthKeys,
  monthsOfRange,
  parseMonthKey,
  type IndicatorRollup,
  type IndicatorUnit,
} from "@/lib/indicators/model";
import {
  resolveIndicatorValues,
  type IndicatorCell,
} from "@/lib/indicators/values";
import { deleteGoalTarget, upsertGoalTarget } from "@/lib/metas/upsert";
import {
  goalTableRequests,
  sanitizeGoalTableSettings,
  sumColumn,
} from "@/lib/widgets/goal-table";
import { withRpcMemo } from "@/lib/widgets/rpc-memo";
import { withRpcTtlCache } from "@/lib/widgets/rpc-cache";
import { loadWidgetScope } from "@/lib/widgets/widget-scope";

export interface GoalTableRowResult {
  id: string;
  indicator: string;
  label: string;
  unit: IndicatorUnit;
  /** Regra de total entre meses (o card recalcula com a meta otimista). */
  rollup: IndicatorRollup;
  bold: boolean;
  responsibleName: string | null;
  /** Responsável informado mas não encontrado (a linha mostra o aviso). */
  responsibleMissing: boolean;
  cells: IndicatorCell[];
  total: { target: number | null; realized: number | null; attainment: number | null };
  hasRealized: boolean;
  errors?: Record<string, string>;
}

export interface GoalTableResult {
  ok: boolean;
  message?: string;
  months: string[];
  rows: GoalTableRowResult[];
  /** Modo por responsável: soma das metas por mês. */
  totalRow?: { label: string; targets: (number | null)[]; total: number | null };
  canEdit: boolean;
}

const EMPTY: GoalTableResult = { ok: false, months: [], rows: [], canEdit: false };

export async function runGoalTable(
  dashboardId: string,
  widgetId: string,
  search: string
): Promise<GoalTableResult> {
  const session = await getSessionInfo();
  if (!session) return { ...EMPTY, message: "Sessão expirada." };
  const supabase = await createClient();
  const scoped = await loadWidgetScope(supabase, session, dashboardId, widgetId, search);
  if (!scoped.ok) return { ...EMPTY, message: scoped.message };
  const { widget, period } = scoped.scope;
  if (widget.visual_type !== "metas") return { ...EMPTY, message: "Widget não encontrado." };

  const orgId = await getActiveOrgId();
  const [registry, indicators, names] = await Promise.all([
    loadGoalMetrics(supabase),
    loadIndicators(supabase, orgId),
    loadResponsibleNameIndex(supabase),
  ]);
  const settings = sanitizeGoalTableSettings(widget.settings?.goalTable ?? {}, {
    knownKeys: new Set(registry.map((m) => m.key)),
    where: "",
    warnings: [],
  });
  const today = todayBrasiliaIso();
  const months =
    settings?.months && settings.months.length > 0
      ? settings.months
      : monthsOfRange(period?.from ?? null, period?.to ?? null, today);
  const requests = goalTableRequests(settings ?? undefined);
  const byKey = indicatorsByKey(indicators);
  const labelOf = (key: string) =>
    byKey.get(key)?.label ?? registry.find((m) => m.key === key)?.label ?? key;
  const unitOf = (key: string): IndicatorUnit =>
    byKey.get(key)?.unit ??
    (registry.find((m) => m.key === key)?.money ? "moeda" : "quantidade");

  const resolved = requests.map((r) => {
    const id = r.responsibleName ? responsibleIdForName(names, r.responsibleName) : null;
    return { ...r, responsibleId: id, missing: Boolean(r.responsibleName) && !id };
  });
  const rpcClient = withRpcMemo(withRpcTtlCache(supabase, `u:${session.user.id}`));
  const series = await resolveIndicatorValues(supabase, rpcClient, {
    orgId,
    indicators: byKey,
    requests: resolved
      .filter((r) => !r.missing)
      .map((r) => ({ key: r.indicator, responsibleId: r.responsibleId })),
    months,
    todayIso: today,
    withRealized: settings?.showRealized !== false,
  });
  let si = 0;
  const rows: GoalTableRowResult[] = resolved.map((r) => {
    const s = r.missing ? null : series[si++];
    return {
      id: r.id,
      indicator: r.indicator,
      label: r.label ?? labelOf(r.indicator),
      unit: unitOf(r.indicator),
      rollup: byKey.get(r.indicator)?.rollup ?? "soma",
      bold: r.bold,
      responsibleName: r.responsibleName,
      responsibleMissing: r.missing,
      cells:
        s?.cells ??
        months.map((m) => ({
          month: m,
          target: null,
          realized: null,
          attainment: null,
          status: "sem_dado" as const,
          elapsed: 0,
        })),
      total: s?.total ?? { target: null, realized: null, attainment: null },
      hasRealized: Boolean(byKey.get(r.indicator)?.realized),
      ...(s?.errors ? { errors: s.errors } : {}),
    };
  });
  const totalRow =
    settings?.mode === "por_responsavel" && settings.totalRowLabel
      ? (() => {
          const targets = months.map((_, mi) =>
            sumColumn(rows.map((r) => r.cells[mi]?.target ?? null))
          );
          return {
            label: settings.totalRowLabel,
            targets,
            total: sumColumn(targets),
          };
        })()
      : undefined;
  return {
    ok: true,
    months,
    rows,
    ...(totalRow ? { totalRow } : {}),
    canEdit: settings?.editable === true && session.roles.includes("admin"),
  };
}

export async function saveGoalCell(input: {
  dashboardId: string;
  widgetId: string;
  indicator: string;
  responsibleName: string | null;
  month: string;
  target: number | null;
}): Promise<{ ok: boolean; message?: string }> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.roles.includes("admin"))
    return { ok: false, message: "Apenas administradores editam metas." };
  const p = parseMonthKey(input.month);
  if (!p) return { ok: false, message: "Mês inválido." };
  if (input.target != null && !Number.isFinite(input.target))
    return { ok: false, message: "Valor inválido." };
  const supabase = await createClient();
  // O widget tem de existir no board, ser uma Tabela de metas EDITÁVEL e citar
  // este indicador — a célula não é uma porta genérica para `goals`.
  const { data: w } = await supabase
    .from("widgets")
    .select("id, visual_type, settings")
    .eq("id", input.widgetId)
    .eq("dashboard_id", input.dashboardId)
    .maybeSingle();
  const gt = (w?.settings as { goalTable?: unknown } | null)?.goalTable;
  const settings = sanitizeGoalTableSettings(gt ?? {}, {
    knownKeys: new Set([input.indicator]),
    where: "",
    warnings: [],
  });
  if (!w || w.visual_type !== "metas" || settings?.editable !== true)
    return { ok: false, message: "Esta tabela não permite editar metas." };
  const cited = goalTableRequests(settings).some(
    (r) =>
      r.indicator === input.indicator &&
      (r.responsibleName ?? null) === (input.responsibleName ?? null)
  );
  if (!cited) return { ok: false, message: "Indicador fora desta tabela." };

  let responsibleId: string | null = null;
  if (input.responsibleName) {
    responsibleId = responsibleIdForName(
      await loadResponsibleNameIndex(supabase),
      input.responsibleName
    );
    if (!responsibleId)
      return { ok: false, message: `Responsável "${input.responsibleName}" não encontrado.` };
  }
  const key = {
    year: p.year,
    month: p.month,
    scope: responsibleId ? "responsible" : "global",
    responsibleId,
    metric: input.indicator,
  };
  const orgId = await getActiveOrgId();
  const error =
    input.target == null
      ? await deleteGoalTarget(supabase, key)
      : await upsertGoalTarget(supabase, orgId, key, input.target);
  return error ? { ok: false, message: error } : { ok: true };
}

// ============================================================================
// Valores dos nós de INDICADOR da Tree (0149). Mesmo escopo (widget-scope) e
// mesmo dono dos números (resolveIndicatorValues) da Tabela de metas — a Tree
// não tem caminho próprio de consulta.
// ============================================================================

export interface TreeIndicatorSeries {
  key: string;
  responsible: string | null;
  label: string;
  unit: IndicatorUnit;
  rollup: IndicatorRollup;
  direction: "maior_melhor" | "menor_melhor";
  hasRealized: boolean;
  responsibleMissing: boolean;
  cells: IndicatorCell[];
  total: { target: number | null; realized: number | null; attainment: number | null };
}

export interface TreeIndicatorValues {
  ok: boolean;
  message?: string;
  months: string[];
  series: TreeIndicatorSeries[];
}

const MAX_TREE_INDICATOR_REQUESTS = 60;

export async function loadTreeIndicatorValues(
  dashboardId: string,
  widgetId: string,
  requests: { key: string; responsible: string | null }[],
  search: string
): Promise<TreeIndicatorValues> {
  const empty: TreeIndicatorValues = { ok: false, months: [], series: [] };
  const session = await getSessionInfo();
  if (!session) return { ...empty, message: "Sessão expirada." };
  const supabase = await createClient();
  const scoped = await loadWidgetScope(supabase, session, dashboardId, widgetId, search);
  if (!scoped.ok) return { ...empty, message: scoped.message };
  if (scoped.scope.widget.visual_type !== "tree")
    return { ...empty, message: "Widget não encontrado." };
  const { period } = scoped.scope;
  const orgId = await getActiveOrgId();
  const [registry, indicators, names] = await Promise.all([
    loadGoalMetrics(supabase),
    loadIndicators(supabase, orgId),
    loadResponsibleNameIndex(supabase),
  ]);
  const known = new Set(registry.map((m) => m.key));
  const byKey = indicatorsByKey(indicators);
  const wanted = requests
    .filter((r) => r && typeof r.key === "string" && known.has(r.key))
    .slice(0, MAX_TREE_INDICATOR_REQUESTS)
    .map((r) => {
      const responsible = typeof r.responsible === "string" ? r.responsible.trim() || null : null;
      const responsibleId = responsible ? responsibleIdForName(names, responsible) : null;
      return { key: r.key, responsible, responsibleId, missing: Boolean(responsible) && !responsibleId };
    });
  const today = todayBrasiliaIso();
  // v1.1: meses fixos da Tree vencem o período do painel.
  const fixedMonths = cleanMonthKeys(scoped.scope.widget.settings?.tree?.months);
  const months =
    fixedMonths.length > 0
      ? fixedMonths
      : monthsOfRange(period?.from ?? null, period?.to ?? null, today);
  const rpcClient = withRpcMemo(withRpcTtlCache(supabase, `u:${session.user.id}`));
  const resolved = await resolveIndicatorValues(supabase, rpcClient, {
    orgId,
    indicators: byKey,
    requests: wanted
      .filter((w) => !w.missing)
      .map((w) => ({ key: w.key, responsibleId: w.responsibleId })),
    months,
    todayIso: today,
  });
  let i = 0;
  const series: TreeIndicatorSeries[] = wanted.map((w) => {
    const s = w.missing ? null : resolved[i++];
    const def = byKey.get(w.key);
    return {
      key: w.key,
      responsible: w.responsible,
      label: def?.label ?? registry.find((m) => m.key === w.key)?.label ?? w.key,
      unit: def?.unit ?? (registry.find((m) => m.key === w.key)?.money ? "moeda" : "quantidade"),
      rollup: def?.rollup ?? "soma",
      direction: def?.direction ?? "maior_melhor",
      hasRealized: Boolean(def?.realized),
      responsibleMissing: w.missing,
      cells: s?.cells ?? [],
      total: s?.total ?? { target: null, realized: null, attainment: null },
    };
  });
  return { ok: true, months, series };
}
