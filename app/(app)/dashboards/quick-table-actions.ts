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

import { getSessionInfo } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
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
  const { widget, config, period, available, allFields, sources, correspondences } =
    scoped.scope;
  if (widget.visual_type !== "tabela_editavel") {
    return { ...empty, error: "Widget não encontrado." };
  }
  const qt = widget.settings?.quickTable;
  if (!qt) return empty;

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
    const catalog: OperandRef[] = buildAggOperandCatalog(
      availableAggCatalogInput(available, allFields, sources)
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

  return { data, exprValues, error: data?.error };
}
