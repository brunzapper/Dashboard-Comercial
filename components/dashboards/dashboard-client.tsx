// Versão: 2.0 | Data: 09/07/2026
// Shell do dashboard: cabeçalho + alternar modo de edição + adicionar widget +
// barra de período global + o grid. Recebe tudo já serializável (widgets +
// dados pré-computados). v2.0 (09/07/2026): barra de período editável/removível
// e filtro como widget (siblings ao builder).
"use client";

import { useState, useTransition } from "react";
import { Check, Clock, Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import type { AvailableField } from "@/lib/widgets/fields";
import type { PeriodSelection } from "@/lib/widgets/period";
import type {
  DashboardSettings,
  FieldFilterOptions,
  Widget,
  WidgetData,
} from "@/lib/widgets/types";
import type { DateFormat } from "@/lib/widgets/format";
import type { CurrencyRates } from "@/lib/widgets/currency";
import type { EntityListRow } from "@/lib/widgets/entity-list";
import { dashboardBackgroundCss } from "@/lib/widgets/appearance";
import { updateDashboardSettings } from "@/app/(app)/dashboards/actions";
import { DashboardGrid } from "./dashboard-grid";
import { DashboardMenu } from "./dashboard-menu";
import { DashboardTabs } from "./dashboard-tabs";
import { DashboardPendingProvider } from "./pending-context";
import { PeriodFilter } from "./period-filter";
import { WidgetBuilder } from "./widget-builder";

export function DashboardClient({
  dashboardId,
  dashboardName,
  widgets,
  dataById,
  recordListById,
  entityListById,
  calcById,
  fields,
  fkLabels,
  responsibleOptions,
  userRoles,
  canEditValues,
  available,
  canEdit,
  canManageFields = false,
  currencyOptions,
  currencyRates = {},
  settings,
  visibleToRoles,
  dateFormat,
  periodBar,
  periodDefaults,
  periodDefaultField,
  filterOptionsById,
}: {
  dashboardId: string;
  dashboardName: string;
  widgets: Widget[];
  dataById: Record<string, WidgetData>;
  recordListById: Record<string, RecordRow[]>;
  entityListById: Record<string, EntityListRow[]>;
  calcById: Record<string, number | null>;
  fields: FieldDefinition[];
  fkLabels: Record<string, string>;
  responsibleOptions?: { value: string; label: string }[];
  userRoles: string[];
  canEditValues: boolean;
  available: AvailableField[];
  canEdit: boolean;
  canManageFields?: boolean;
  currencyOptions?: { value: string; label: string }[];
  currencyRates?: CurrencyRates;
  settings: DashboardSettings;
  visibleToRoles: string[];
  dateFormat?: DateFormat;
  periodBar?: DashboardSettings["periodBar"];
  periodDefaults?: PeriodSelection;
  periodDefaultField?: string;
  filterOptionsById?: Record<string, FieldFilterOptions>;
}) {
  const [editMode, setEditMode] = useState(false);
  const [pending, startTransition] = useTransition();

  const barEnabled = periodBar?.enabled !== false;
  const backgroundCss = dashboardBackgroundCss(settings.background);

  // Abas: id efetivo de um widget = settings.tab ?? primeira aba. Sem abas
  // configuradas, o dashboard é uma tela única (todos os widgets visíveis).
  const tabs = settings.tabs ?? [];
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0]?.id ?? "");
  const firstTabId = tabs[0]?.id ?? "";
  const tabIds = new Set(tabs.map((t) => t.id));
  // Aba efetiva: a do widget quando ainda existe; senão (sem aba ou aba excluída)
  // cai na primeira aba, para nenhum widget "sumir".
  const widgetTab = (w: Widget) => {
    const t = w.settings?.tab;
    return t && tabIds.has(t) ? t : firstTabId;
  };
  const visibleWidgets =
    tabs.length === 0 ? widgets : widgets.filter((w) => widgetTab(w) === activeTabId);

  function showBar() {
    startTransition(async () => {
      await updateDashboardSettings(dashboardId, {
        ...settings,
        periodBar: { ...periodBar, enabled: true },
      });
    });
  }

  function saveTabs(next: DashboardSettings["tabs"]) {
    startTransition(async () => {
      await updateDashboardSettings(dashboardId, { ...settings, tabs: next });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{dashboardName}</h1>
        {canEdit ? (
          <div className="flex items-center gap-2">
            <Button
              variant={editMode ? "default" : "outline"}
              size="sm"
              onClick={() => setEditMode((v) => !v)}
            >
              {editMode ? <Check className="size-4" /> : <Pencil className="size-4" />}
              {editMode ? "Concluir" : "Editar layout"}
            </Button>
            <WidgetBuilder
              dashboardId={dashboardId}
              available={available}
              siblings={widgets}
              canManageFields={canManageFields}
              fields={fields}
              currencyOptions={currencyOptions}
              tabs={tabs}
              activeTabId={activeTabId}
              trigger={
                <Button size="sm">
                  <Plus className="size-4" /> Adicionar widget
                </Button>
              }
            />
            <DashboardMenu
              dashboardId={dashboardId}
              settings={settings}
              visibleToRoles={visibleToRoles}
            />
          </div>
        ) : null}
      </div>

      {tabs.length > 0 || (canEdit && editMode) ? (
        <DashboardTabs
          tabs={tabs}
          activeId={activeTabId}
          onSelect={setActiveTabId}
          editMode={canEdit && editMode}
          onChange={saveTabs}
        />
      ) : null}

      <DashboardPendingProvider>
        {barEnabled ? (
          <PeriodFilter
            available={available}
            canEdit={canEdit}
            dashboardId={dashboardId}
            periodBar={periodBar}
            periodDefaults={periodDefaults}
            periodDefaultField={periodDefaultField}
          />
        ) : canEdit ? (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={pending}
            onClick={showBar}
          >
            <Clock className="size-4" /> Mostrar barra de período
          </Button>
        ) : null}

        <div
          className={backgroundCss ? "rounded-lg p-3" : undefined}
          style={backgroundCss ? { background: backgroundCss } : undefined}
        >
          <DashboardGrid
            widgets={visibleWidgets}
            dataById={dataById}
            recordListById={recordListById}
            entityListById={entityListById}
            calcById={calcById}
            fields={fields}
            fkLabels={fkLabels}
            responsibleOptions={responsibleOptions}
            userRoles={userRoles}
            canEditValues={canEditValues}
            available={available}
            dashboardId={dashboardId}
            dateFormat={dateFormat}
            settings={settings}
            tabs={tabs}
            canEdit={canEdit}
            canManageFields={canManageFields}
            currencyOptions={currencyOptions}
            currencyRates={currencyRates}
            editMode={editMode}
            filterOptionsById={filterOptionsById}
          />
        </div>
      </DashboardPendingProvider>
    </div>
  );
}
