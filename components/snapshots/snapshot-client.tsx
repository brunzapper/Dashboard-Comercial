// Versão: 1.0 | Data: 15/07/2026
// Shell do VIEWER PÚBLICO de um snapshot (/s/<token>): título + selo de
// atualização + o grid do dashboard em modo somente-leitura. Reusa o
// DashboardGrid real (com os providers que ele exige — History/Pending —
// inertes aqui: nada edita, nada captura) sob o SnapshotModeProvider, que
// desliga as persistências dos componentes interativos (filtros rápidos na
// URL, calculadora local, Tabela Livre precomputada e read-only).
// Sem cabeçalho do app, sem menu, sem edição, sem barra de período, sem troca
// de abas — o snapshot é UMA aba congelada.
"use client";

import { useCallback, useMemo } from "react";

import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import type { AvailableField } from "@/lib/widgets/fields";
import type {
  CalcWidgetResult,
  DashboardSettings,
  FieldFilterOptions,
  GridPosition,
  Widget,
  WidgetData,
  WidgetLinkTarget,
} from "@/lib/widgets/types";
import type { DateFormat } from "@/lib/widgets/format";
import type { CurrencyRates } from "@/lib/widgets/currency";
import type { WidgetQuickFilters } from "@/lib/widgets/quick-filters";
import type { EntityListRow } from "@/lib/widgets/entity-list";
import type { QuickTableResult } from "@/app/(app)/dashboards/quick-table-actions";
import { dashboardBackgroundCss } from "@/lib/widgets/appearance";
import { buildDashboardSnapshot } from "@/lib/widgets/history";
import { focusWidgetWithRetry } from "@/lib/widgets/focus";
import { posOf } from "@/lib/widgets/grid-placement";
import { DashboardGrid } from "@/components/dashboards/dashboard-grid";
import { DashboardHistoryProvider } from "@/components/dashboards/history-context";
import { DashboardPendingProvider } from "@/components/dashboards/pending-context";
import { WidgetFocusProvider } from "@/components/dashboards/focus-context";
import { SnapshotModeProvider } from "./snapshot-mode";

// "Atualizado em 15/07/2026 14:30" no fuso de Brasília.
const REFRESH_FMT = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});

export function SnapshotClient({
  snapshotName,
  dashboardName,
  tabName,
  lastRefreshedAt,
  dashboardId,
  widgets,
  dataById,
  recordListById,
  entityListById,
  calcById,
  calcVarsById,
  noteById,
  calcExprById,
  tableCellsById,
  quickTableResults,
  fields,
  fkLabels,
  available,
  settings,
  activeTabId,
  dateFormat,
  currencyRates,
  conversionPeriodById,
  filterOptionsById,
  quickFiltersById,
}: {
  snapshotName: string;
  dashboardName: string;
  tabName: string;
  lastRefreshedAt: string | null;
  dashboardId: string;
  widgets: Widget[];
  dataById: Record<string, WidgetData>;
  recordListById: Record<string, RecordRow[]>;
  entityListById: Record<string, EntityListRow[]>;
  calcById: Record<string, CalcWidgetResult>;
  calcVarsById: Record<string, Record<string, CalcWidgetResult>>;
  noteById: Record<string, CalcWidgetResult[]>;
  calcExprById: Record<string, string>;
  tableCellsById: Record<
    string,
    { row_key: string; col_key: string; value: number | string | null }[]
  >;
  quickTableResults: Record<string, QuickTableResult>;
  fields: FieldDefinition[];
  fkLabels: Record<string, string>;
  available: AvailableField[];
  settings: DashboardSettings;
  activeTabId: string;
  dateFormat?: DateFormat;
  currencyRates: CurrencyRates;
  conversionPeriodById: Record<string, { year: number; quarter: number }>;
  filterOptionsById?: Record<string, FieldFilterOptions>;
  quickFiltersById?: Record<string, WidgetQuickFilters>;
}) {
  const backgroundCss = dashboardBackgroundCss(settings.background);

  // Layout estático (nada é arrastável): posições base direto dos widgets.
  const layoutById = useMemo(() => {
    const out: Record<string, GridPosition> = {};
    widgets.forEach((w, i) => {
      out[w.id] = posOf(w, i);
    });
    return out;
  }, [widgets]);
  const applyLayoutPatch = useCallback(() => {}, []);

  // Seed inerte do histórico (o grid consome o hook incondicionalmente; sem
  // edição, nada é capturado nem restaurado).
  const historySeed = useMemo(
    () => buildDashboardSnapshot(dashboardName, settings, widgets, []),
    [dashboardName, settings, widgets]
  );

  // Atalhos de forma/nota: só dentro do próprio snapshot (outros dashboards
  // e widgets fora da aba congelada viram no-op).
  const focus = useCallback(
    (t: WidgetLinkTarget) => {
      if (t.dashboardId && t.dashboardId !== dashboardId) return;
      if (!widgets.some((w) => w.id === t.widgetId)) return;
      focusWidgetWithRetry(t.widgetId);
    },
    [dashboardId, widgets]
  );

  // Conectores congelados: a camada só desenha quando recebe saveConnectors;
  // fora do modo edição ela é somente-leitura, então um no-op basta.
  const saveConnectorsNoop = useCallback(() => {}, []);

  const refreshedLabel = lastRefreshedAt
    ? REFRESH_FMT.format(new Date(lastRefreshedAt))
    : null;

  return (
    <SnapshotModeProvider value={{ snapshot: true, quickTableResults }}>
      <DashboardHistoryProvider dashboardId={dashboardId} seed={historySeed}>
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 p-4 md:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex min-w-0 flex-col">
              <h1 className="truncate text-2xl font-semibold">{snapshotName}</h1>
              <p className="text-muted-foreground truncate text-sm">
                {dashboardName}
                {tabName ? ` — ${tabName}` : ""}
              </p>
            </div>
            {refreshedLabel ? (
              <span className="text-muted-foreground shrink-0 rounded-full border px-3 py-1 text-xs">
                Atualizado em {refreshedLabel}
              </span>
            ) : null}
          </div>

          <DashboardPendingProvider>
            <div
              className={backgroundCss ? "rounded-lg p-3" : undefined}
              style={backgroundCss ? { background: backgroundCss } : undefined}
            >
              <WidgetFocusProvider focus={focus}>
                <DashboardGrid
                  widgets={widgets}
                  dataById={dataById}
                  recordListById={recordListById}
                  entityListById={entityListById}
                  calcById={calcById}
                  calcVarsById={calcVarsById}
                  noteById={noteById}
                  calcExprById={calcExprById}
                  tableCellsById={tableCellsById}
                  fields={fields}
                  fkLabels={fkLabels}
                  responsibleOptions={[]}
                  userRoles={[]}
                  canEditValues={false}
                  available={available}
                  availableForBuilder={available}
                  dashboardId={dashboardId}
                  dateFormat={dateFormat}
                  settings={settings}
                  tabs={settings.tabs}
                  activeTabId={activeTabId}
                  canEdit={false}
                  canManageFields={false}
                  currencyRates={currencyRates}
                  conversionPeriodById={conversionPeriodById}
                  editMode={false}
                  filterOptionsById={filterOptionsById}
                  quickFiltersById={quickFiltersById}
                  layoutById={layoutById}
                  applyLayoutPatch={applyLayoutPatch}
                  connectors={settings.connectors ?? []}
                  saveConnectors={saveConnectorsNoop}
                />
              </WidgetFocusProvider>
            </div>
          </DashboardPendingProvider>
        </div>
      </DashboardHistoryProvider>
    </SnapshotModeProvider>
  );
}
