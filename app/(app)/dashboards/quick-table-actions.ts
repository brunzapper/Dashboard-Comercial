// Versão: 2.1 | Data: 02/10/2026
// v2.1 (02/10/2026): METAS — a Tabela Livre absorveu a Tabela de metas.
//   (a) `runQuickTable` resolve as linhas ligadas a indicador pelo dono único
//       `resolveIndicatorValues` (meta por `resolveGoal`, realizado por
//       `runCalculatedWidget`; fonte do realizado própria da linha, recortes
//       expostos e quebra por dimensão) com o período do widget-scope ou os
//       meses fixos de cada coluna; RPCs intocadas;
//   (b) `saveQuickTableGoal` grava a meta do mês pela célula (admin +
//       `goals.editable`), lendo indicador e responsável da LINHA gravada —
//       nunca do navegador; vazio EXCLUI a meta (upsert/delete únicos de
//       lib/metas/upsert.ts). Substitui o `saveGoalCell` da antiga tabela.
// Versão: 2.0 | Data: 21/07/2026
// v2.0 (21/07/2026): escopo via loadWidgetScope (assembly ÚNICA do
//   widget-scope) — a action passa a aplicar o MESMO recorte da page: filtros
//   rápidos do card (__qf__), ?ff_ com fallback lastFieldFilters e tradução de
//   OPERAÇÃO (operation-scope). Antes só período + ?ff_ da URL, e o
//   multi-select de operação era ignorado (dado obsoleto/incompleto até F5).
// v1.1 (20/07/2026): catálogo agregado via builder ÚNICO (lib/widgets/
//   agg-catalog.availableAggCatalogInput) — montagem idêntica, sem cópia local.
// Tabela Livre — computação DEFERIDA (server action chamada pelo widget após
// o mount, para a página abrir sem esse custo): dados BI (dimensões/métricas
// via runWidget) + expressões {=…} das células (runCalculatedWidget), com o
// MESMO período efetivo que a page resolveria (lib/widgets/period-resolve.ts,
// implementação única) e os filtros de visualização da page. RLS cobre o
// acesso (select de widgets/células exige visualizador do dashboard).
"use server";

import { getActiveOrgId } from "@/lib/auth/org";
import { getSessionInfo } from "@/lib/auth/session";
import { todayBrasiliaIso } from "@/lib/date/today";
import {
  loadResponsibleNameIndex,
  responsibleIdForName,
} from "@/lib/config/responsible-names";
import { indicatorsByKey, loadIndicators } from "@/lib/indicators/load";
import { monthsOfRange, parseMonthKey } from "@/lib/indicators/model";
import {
  exposedFilters,
  parseRealizedSource,
  type RealizedSource,
} from "@/lib/indicators/realized-source";
import { resolveIndicatorValues } from "@/lib/indicators/values";
import { deleteGoalTarget, upsertGoalTarget } from "@/lib/metas/upsert";
import { fieldLabel, type AvailableField } from "@/lib/widgets/fields";
import { normalizeLegacyWidget } from "@/lib/widgets/quick-table/goal-convert";
import {
  goalBoundRows,
  goalColumnMonths,
  quickTableHasGoals,
  unionMonths,
  type QTGoalRowData,
  type QuickTableGoalsData,
} from "@/lib/widgets/quick-table/goals";
import { withRpcMemo } from "@/lib/widgets/rpc-memo";
import { withRpcTtlCache } from "@/lib/widgets/rpc-cache";
import type { SessionInfo } from "@/lib/auth/session";
import type { DashboardPeriod } from "@/lib/widgets/period";
import { createClient } from "@/lib/supabase/server";
import { loadGoalMetrics } from "@/lib/config/goal-metrics";
import { loadManualAxes, loadManualSeries } from "@/lib/manual-base/load";
import { tokenizeFormulaText } from "@/lib/records/formula-text";
import type { OperandRef } from "@/lib/records/date-operands";
import {
  availableAggCatalogInput,
  buildAggOperandCatalog,
} from "@/lib/widgets/agg-catalog";
import { loadCurrencyRates, yearQuarterOf } from "@/lib/widgets/currency";
import { runWidget } from "@/lib/widgets/engine";
import { runCalculatedWidget } from "@/lib/widgets/formula-metric";
import {
  cellKey,
  classifyCellRaw,
  exprSource,
  quickTableBI,
} from "@/lib/widgets/quick-table/model";
import { loadWidgetScope } from "@/lib/widgets/widget-scope";
import type {
  CalcWidgetResult,
  Dimension,
  Widget,
  WidgetConfig,
  WidgetData,
} from "@/lib/widgets/types";

// Teto de expressões {=…} por tabela (cada SOMASE pode gerar consulta extra).
const QT_MAX_EXPRS = 30;

export interface QuickTableResult {
  // Dados BI (null = tabela sem colunas de dimensão/métrica).
  data: WidgetData | null;
  // Resultado de cada expressão {=…} por chave de célula ("rowKey:colKey").
  exprValues: Record<string, CalcWidgetResult>;
  error?: string;
  /** v2.1: metas das linhas ligadas (ausente = tabela sem colunas de meta). */
  goals?: QuickTableGoalsData | null;
}

export async function runQuickTable(
  dashboardId: string,
  widgetId: string,
  // window.location.search do cliente — período/aba/filtros são parâmetros de
  // URL, e a action os resolve exatamente como a page (resolver único).
  search: string
): Promise<QuickTableResult> {
  const empty: QuickTableResult = { data: null, exprValues: {} };
  const session = await getSessionInfo();
  if (!session) return { ...empty, error: "Sessão expirada." };
  const supabase = await createClient();

  // Escopo efetivo (widget + período + filtros de visualização) — a MESMA
  // assembly da page/paginação/export (lib/widgets/widget-scope.ts).
  const [scoped, currencyRates] = await Promise.all([
    loadWidgetScope(supabase, session, dashboardId, widgetId, search),
    loadCurrencyRates(supabase),
  ]);
  if (!scoped.ok) return { ...empty, error: scoped.message };
  const { config, period, available, allFields, sources, correspondences } =
    scoped.scope;
  // v2.1: o widget-scope já devolve a Tabela de metas legada convertida.
  const widget = normalizeLegacyWidget(scoped.scope.widget);
  if (widget.visual_type !== "tabela_editavel") {
    return { ...empty, error: "Widget não encontrado." };
  }
  const qt = widget.settings?.quickTable;
  if (!qt) return empty;

  // ---- metas (v2.1) — em paralelo com o resto ----
  const goalsPromise = quickTableHasGoals(qt)
    ? computeQuickTableGoals(supabase, session, qt, period, available).catch((e) => {
        console.error(`[quick-table] metas do widget ${widgetId} falharam:`, e);
        return {
          months: [],
          monthsByCol: {},
          rows: {},
          canEdit: false,
          message: "Não foi possível carregar as metas.",
        } satisfies QuickTableGoalsData;
      })
    : null;

  const conversionPeriod = yearQuarterOf(period?.to ?? period?.from ?? null);
  // widget.filters + filtros de visualização resolvidos (inclui __qf__/ff_/
  // operação traduzida) — mesmos das demais consultas do widget.
  const filters = config.filters ?? [];

  // ---- dados BI (dimensões/métricas nas colunas) ----
  const bi = quickTableBI(qt);
  let data: WidgetData | null = null;
  if (bi.hasBI) {
    const dimOf = (c: (typeof bi.rowDims)[number]): Dimension => ({
      field: c.field!,
      ...(c.transform && c.transform !== "none"
        ? { transform: c.transform, weekMode: c.weekMode }
        : {}),
    });
    const biConfig: WidgetConfig = {
      source: "records",
      sources: widget.sources ?? [],
      splitBySource: false,
      // Ordem CONTRATUAL com buildQuickTableMatrix: rowDims…, pivot por último.
      dimensions: [
        ...bi.rowDims.map(dimOf),
        ...(bi.pivotDim ? [dimOf(bi.pivotDim)] : []),
      ],
      metrics: bi.metricCols.map((c) => c.metric!),
      filters,
      visual_type: "tabela",
      settings: config.settings,
    };
    try {
      data = await runWidget(
        supabase,
        biConfig,
        available,
        period,
        allFields,
        currencyRates,
        conversionPeriod,
        sources,
        correspondences
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[quick-table] widget ${widgetId} falhou:`, msg);
      data = { rows: [], dimensions: [], metrics: [], error: msg };
    }
  }

  // ---- expressões {=…} nas células ----
  const exprValues: Record<string, CalcWidgetResult> = {};
  const { data: cellRows } = await supabase
    .from("dashboard_table_cells")
    .select("row_key, col_key, value")
    .eq("widget_id", widgetId);
  const exprCells = (cellRows ?? [])
    .filter(
      (c) =>
        !String(c.row_key).startsWith("__") &&
        classifyCellRaw(String(c.value ?? "")) === "expr"
    )
    .slice(0, QT_MAX_EXPRS);

  if (exprCells.length > 0) {
    // Catálogo agregado — builder ÚNICO (lib/widgets/agg-catalog.ts), mesma
    // montagem do editor da Nota (widget-card) e do viewer de snapshot; sem
    // aninhados (comportamento vigente das expressões {=…}).
    const [goalMetrics, manualSeries, manualAxes] = await Promise.all([
      loadGoalMetrics(supabase),
      loadManualSeries(supabase),
      loadManualAxes(supabase),
    ]);
    const catalog: OperandRef[] = buildAggOperandCatalog(
      availableAggCatalogInput(
        available,
        allFields,
        sources,
        goalMetrics,
        manualSeries,
        manualAxes
      )
    );

    await Promise.all(
      exprCells.map(async (c) => {
        const key = cellKey(String(c.row_key), String(c.col_key));
        const tok = tokenizeFormulaText(
          exprSource(String(c.value ?? "")),
          catalog
        );
        if (!tok.ok) {
          exprValues[key] = { value: null, currency: null, text: "#ERRO" };
          return;
        }
        try {
          exprValues[key] = await runCalculatedWidget(supabase, {
            formula: tok.formula,
            sources: widget.sources ?? [],
            sourceDefs: sources,
            filters,
            period,
            correspondences,
            currencyMode: "auto",
            fields: allFields,
            rates: currencyRates,
            conversionPeriod,
          });
        } catch {
          exprValues[key] = { value: null, currency: null };
        }
      })
    );
  }

  const goals = goalsPromise ? await goalsPromise : null;
  return {
    data,
    exprValues,
    error: data?.error,
    ...(goals ? { goals } : {}),
  };
}

// ============================================================================
// v2.1 (02/10/2026): METAS
// ============================================================================

type QuickTable = NonNullable<NonNullable<Widget["settings"]>["quickTable"]>;

async function computeQuickTableGoals(
  supabase: Awaited<ReturnType<typeof createClient>>,
  session: SessionInfo,
  qt: QuickTable,
  period: DashboardPeriod | null,
  available: AvailableField[]
): Promise<QuickTableGoalsData> {
  const orgId = await getActiveOrgId();
  const [registry, indicators, names] = await Promise.all([
    loadGoalMetrics(supabase),
    loadIndicators(supabase, orgId),
    loadResponsibleNameIndex(supabase),
  ]);
  const today = todayBrasiliaIso();
  const periodMonths = monthsOfRange(period?.from ?? null, period?.to ?? null, today);
  const monthsByCol: Record<string, string[]> = {};
  for (const c of qt.columns) {
    if (c.kind === "goal") monthsByCol[c.id] = goalColumnMonths(c, periodMonths);
  }
  const months = unionMonths(Object.values(monthsByCol));
  const known = new Set(registry.map((m) => m.key));
  const byKey = indicatorsByKey(indicators);

  const bound = goalBoundRows(qt)
    .filter((r) => known.has(r.bind.indicator))
    .map((r) => {
      const responsible = r.bind.responsible?.trim() || null;
      const responsibleId = responsible ? responsibleIdForName(names, responsible) : null;
      return {
        row: r,
        responsible,
        responsibleId,
        missing: Boolean(responsible) && !responsibleId,
        // Shape re-checado em runtime (settings são graváveis por RLS); a
        // régua semântica roda no save (saveWidgetSettings).
        realized: parseRealizedSource(r.bind.realized) as RealizedSource | null,
      };
    });

  const showRealized = qt.goals?.showRealized !== false;
  const rpcClient = withRpcMemo(withRpcTtlCache(supabase, `u:${session.user.id}`));
  const series = await resolveIndicatorValues(supabase, rpcClient, {
    orgId,
    indicators: byKey,
    requests: bound
      .filter((b) => !b.missing)
      .map((b) => ({
        key: b.row.bind.indicator,
        responsibleId: b.responsibleId,
        id: b.row.id,
        realized: b.realized,
      })),
    months,
    todayIso: today,
    withRealized: showRealized,
  });
  const seriesById = new Map(series.map((x) => [x.id ?? "", x]));

  const rows: Record<string, QTGoalRowData> = {};
  for (const b of bound) {
    const key = b.row.bind.indicator;
    const def = byKey.get(key);
    const metric = registry.find((m) => m.key === key);
    const s = b.missing ? null : seriesById.get(b.row.id);
    const monthsData: QTGoalRowData["months"] = {};
    months.forEach((m, mi) => {
      const c = s?.cells[mi];
      monthsData[m] = {
        target: c?.target ?? null,
        realized: c?.realized ?? null,
        attainment: c?.attainment ?? null,
        status: c?.status ?? "sem_dado",
        elapsed: c?.elapsed ?? 0,
        ...(s?.errors?.[m] ? { error: s.errors[m] } : {}),
      };
    });
    const chips = exposedFilters(b.realized).map((f) => {
      const v = Array.isArray(f.value) ? f.value.join(", ") : String(f.value ?? "");
      return `${fieldLabel(f.field, available)}: ${v}`;
    });
    const bd = b.realized?.breakdown;
    rows[b.row.id] = {
      indicator: key,
      defaultLabel: def?.label ?? metric?.label ?? key,
      unit: def?.unit ?? (metric?.money ? "moeda" : "quantidade"),
      rollup: def?.rollup ?? "soma",
      direction: def?.direction ?? "maior_melhor",
      responsibleName: b.responsible,
      responsibleMissing: b.missing,
      hasRealized: showRealized && (s?.hasRealized ?? Boolean(def?.realized)),
      formulaText: def?.realized
        ? (def.realized.formulaText ?? def.realized.formula.source ?? null)
        : null,
      months: monthsData,
      ...(chips.length > 0 ? { chips } : {}),
      ...(bd && s?.breakdown && s.breakdown.length > 0
        ? {
            breakdown: {
              label: fieldLabel(bd.field, available),
              display: bd.display,
              rows: s.breakdown,
            },
          }
        : {}),
    };
  }
  return {
    months,
    monthsByCol,
    rows,
    canEdit: qt.goals?.editable === true && session.roles.includes("admin"),
  };
}

/**
 * v2.1: meta do mês editada na célula da Tabela Livre. A linha (indicador e
 * responsável) é lida do widget GRAVADO — a célula não é uma porta genérica
 * para `goals`. Admin (a RLS de goals já exige) + `goals.editable`; o mês tem
 * de pertencer a uma coluna de meta fixa (ou a coluna ser do período).
 */
export async function saveQuickTableGoal(input: {
  dashboardId: string;
  widgetId: string;
  rowId: string;
  month: string;
  target: number | null;
}): Promise<{ ok: boolean; message?: string }> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!session.roles.includes("admin"))
    return { ok: false, message: "Apenas administradores editam metas." };
  const ym = parseMonthKey(input.month);
  if (!ym) return { ok: false, message: "Mês inválido." };
  if (input.target != null && !Number.isFinite(input.target))
    return { ok: false, message: "Valor inválido." };
  const supabase = await createClient();
  const { data: raw } = await supabase
    .from("widgets")
    .select("id, visual_type, settings")
    .eq("id", input.widgetId)
    .eq("dashboard_id", input.dashboardId)
    .maybeSingle();
  if (!raw) return { ok: false, message: "Widget não encontrado." };
  const w = normalizeLegacyWidget(raw as Pick<Widget, "visual_type" | "settings">);
  const qt = w.settings?.quickTable;
  if (w.visual_type !== "tabela_editavel" || !qt || qt.goals?.editable !== true)
    return { ok: false, message: "Esta tabela não permite editar metas." };
  const row = goalBoundRows(qt).find((r) => r.id === input.rowId);
  if (!row) return { ok: false, message: "Linha sem indicador." };
  const goalCols = qt.columns.filter((c) => c.kind === "goal");
  const allowed = goalCols.some((c) => !c.months?.length || c.months.includes(input.month));
  if (!allowed) return { ok: false, message: "Mês fora das colunas desta tabela." };

  let responsibleId: string | null = null;
  const responsible = row.bind.responsible?.trim();
  if (responsible) {
    responsibleId = responsibleIdForName(await loadResponsibleNameIndex(supabase), responsible);
    if (!responsibleId) return { ok: false, message: `Responsável "${responsible}" não encontrado.` };
  }
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, message: "Organização ativa não encontrada." };
  const slot = {
    year: ym.year,
    month: ym.month,
    scope: (responsibleId ? "responsible" : "global") as "responsible" | "global",
    responsibleId,
    metric: row.bind.indicator,
  };
  const error =
    input.target == null
      ? await deleteGoalTarget(supabase, slot)
      : await upsertGoalTarget(supabase, orgId, slot, input.target);
  return error ? { ok: false, message: error } : { ok: true };
}

/**
 * v2.1: responsáveis cadastrados (ativos, principais) — o painel de linha os
 * oferece em lista e grava o NOME (regra "filtros por nome"), nunca o id.
 */
export async function listActiveResponsibleNames(): Promise<string[]> {
  const session = await getSessionInfo();
  if (!session) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("responsibles")
    .select("display_name")
    .is("canonical_id", null)
    .eq("active", true)
    .order("display_name");
  return (data ?? [])
    .map((r) => (r as { display_name: string | null }).display_name ?? "")
    .filter(Boolean);
}
