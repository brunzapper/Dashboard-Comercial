// Versão: 1.0 | Data: 15/07/2026
// Tabela rápida — computação DEFERIDA (server action chamada pelo widget após
// o mount, para a página abrir sem esse custo): dados BI (dimensões/métricas
// via runWidget) + expressões {=…} das células (runCalculatedWidget), com o
// MESMO período efetivo que a page resolveria (lib/widgets/period-resolve.ts,
// implementação única) e os filtros de visão dos widgets "Filtro por campo"
// (?ff_<id>) que atingem este widget. RLS cobre o acesso (select de widgets/
// células exige visualizador do dashboard).
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { FieldDefinition } from "@/lib/records/types";
import { tokenizeFormulaText } from "@/lib/records/formula-text";
import type { OperandRef } from "@/lib/records/date-operands";
import { COND_DATA_TYPES } from "@/lib/records/cond-operands";
import { buildAvailableFields } from "@/lib/widgets/fields";
import {
  aggOperandRefs,
  condAggOperandRefs,
} from "@/lib/widgets/calc-metrics";
import { loadCurrencyRates, yearQuarterOf } from "@/lib/widgets/currency";
import { runWidget } from "@/lib/widgets/engine";
import { runCalculatedWidget } from "@/lib/widgets/formula-metric";
import {
  buildCorrespondenceMap,
  loadCorrespondences,
} from "@/lib/correspondences";
import {
  createPeriodResolver,
  type PeriodPrefs,
} from "@/lib/widgets/period-resolve";
import {
  cellKey,
  classifyCellRaw,
  exprSource,
  quickTableBI,
} from "@/lib/widgets/quick-table/model";
import { parseViewFilter, viewStateToFilters } from "@/lib/widgets/view-filters";
import { isSourceKey } from "@/lib/sources";
import type {
  CalcWidgetResult,
  DashboardSettings,
  Dimension,
  Widget,
  WidgetConfig,
  WidgetData,
  WidgetFilter,
} from "@/lib/widgets/types";

// Teto de expressões {=…} por tabela (cada SOMASE pode gerar consulta extra).
const QT_MAX_EXPRS = 30;

export interface QuickTableResult {
  // Dados BI (null = tabela sem colunas de dimensão/métrica).
  data: WidgetData | null;
  // Resultado de cada expressão {=…} por chave de célula ("rowKey:colKey").
  exprValues: Record<string, CalcWidgetResult>;
  error?: string;
}

function str(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
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

  // Query string → mesmo shape do searchParams da page.
  const sp: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of new URLSearchParams(search ?? "")) {
    const cur = sp[k];
    sp[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
  }

  const [
    { data: dash },
    { data: widgetsData },
    { data: fieldsData },
    correspondences,
    { data: prefData },
    currencyRates,
  ] = await Promise.all([
    supabase
      .from("dashboards")
      .select("id, settings")
      .eq("id", dashboardId)
      .maybeSingle(),
    supabase
      .from("widgets")
      .select(
        "id, dashboard_id, title, visual_type, source, sources, split_by_source, dimensions, metrics, filters, settings, grid_position, sort_order"
      )
      .eq("dashboard_id", dashboardId),
    supabase
      .from("field_definitions")
      .select(
        "id, field_key, label, data_type, options, visible_to_roles, editable_by_roles, is_local, show_in_builder, formula, allow_negative, currency_code, currency_mode, show_as_percent, sort_order, applies_to, source_system, source_field_id, write_back"
      )
      .eq("show_in_builder", true)
      .order("sort_order", { ascending: true }),
    loadCorrespondences(supabase),
    supabase
      .from("user_preferences")
      .select("settings")
      .eq("user_id", session.user.id)
      .eq("dashboard_id", dashboardId)
      .maybeSingle(),
    loadCurrencyRates(supabase),
  ]);
  if (!dash) return { ...empty, error: "Dashboard não encontrado." };

  const widgets = (widgetsData ?? []) as Widget[];
  const widget = widgets.find((w) => w.id === widgetId);
  if (!widget || widget.visual_type !== "tabela_editavel") {
    return { ...empty, error: "Widget não encontrado." };
  }
  const qt = widget.settings?.quickTable;
  if (!qt) return empty;

  const allFields = (fieldsData ?? []) as FieldDefinition[];
  const available = buildAvailableFields(allFields, correspondences);
  const correspondencesMap = buildCorrespondenceMap(correspondences);
  const dashSettings = (dash.settings ?? {}) as DashboardSettings;
  const prefSettings = (prefData?.settings ?? {}) as PeriodPrefs;

  // Período efetivo deste widget (barra global + widgets de filtro) — mesma
  // implementação da page.
  const resolver = createPeriodResolver({
    sp,
    available,
    correspondences,
    dashSettings,
    prefSettings,
  });
  const dataWidgets = widgets.filter(
    (w) =>
      w.visual_type !== "filtro" &&
      w.visual_type !== "filtro_campo" &&
      w.visual_type !== "forma"
  );
  const filterWidgets = widgets.filter((w) => w.visual_type === "filtro");
  const { periodByWidget } = resolver.computeWidgetPeriods(
    dataWidgets,
    filterWidgets
  );
  const period = periodByWidget[widgetId] ?? null;
  const conversionPeriod = yearQuarterOf(period?.to ?? period?.from ?? null);

  // Filtros de visão dos widgets "Filtro por campo" (?ff_<id>) que atingem
  // este widget — mesma regra de alvo/fonte da page.
  const sourcesOverlap = (a: string[], b: string[]) => {
    if (a.length === 0 || b.length === 0) return true;
    return a.some((s) => b.includes(s));
  };
  const viewFilters: WidgetFilter[] = [];
  for (const fw of widgets.filter((w) => w.visual_type === "filtro_campo")) {
    const raw = str(sp[`ff_${fw.id}`]);
    if (!raw) continue;
    if ((fw.settings?.excludedTargets ?? []).includes(widgetId)) continue;
    const fs = viewStateToFilters(
      parseViewFilter(raw),
      fw.settings?.searchFields
    );
    if (fs.length === 0) continue;
    const fwSources = (fw.sources ?? []) as string[];
    const isUnifiedFilter = (f: WidgetFilter) =>
      f.field.split("|").some((p) => p.startsWith("unified:"));
    const unified = fs.some(isUnifiedFilter);
    if (
      !unified &&
      !sourcesOverlap(fwSources, (widget.sources ?? []) as string[])
    )
      continue;
    const fwSourceKeys = fwSources.filter(isSourceKey);
    viewFilters.push(
      ...(fwSourceKeys.length > 0
        ? fs.map((f) =>
            isUnifiedFilter(f) ? f : { ...f, sources: fwSourceKeys }
          )
        : fs)
    );
  }
  const filters = [...(widget.filters ?? []), ...viewFilters];

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
    const config: WidgetConfig = {
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
      settings: widget.settings,
    };
    try {
      data = await runWidget(
        supabase,
        config,
        available,
        period,
        correspondencesMap,
        allFields,
        currencyRates,
        conversionPeriod
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
    // Catálogo agregado — mesma montagem do editor da Nota (widget-card).
    const numeric = available.filter((f) => f.isNumeric);
    const countable = available.filter(
      (f) => (f.isNumeric || f.isDate) && !f.aggCalc && !f.displayOnly
    );
    const customCond = allFields
      .filter((f) => COND_DATA_TYPES.includes(f.data_type))
      .map((f) => ({ field_key: f.field_key, label: f.label }));
    const customDate = allFields
      .filter((f) => f.data_type === "data")
      .map((f) => ({ field_key: f.field_key, label: f.label }));
    const catalog: OperandRef[] = [
      ...aggOperandRefs(numeric, countable),
      ...condAggOperandRefs(numeric, customCond, customDate),
    ];

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
            filters,
            period,
            correspondencesMap,
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

  return { data, exprValues, error: data?.error };
}
