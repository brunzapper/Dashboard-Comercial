// Versão: 2.0 | Data: 09/07/2026
// Shell do dashboard: cabeçalho + alternar modo de edição + adicionar widget +
// barra de período global + o grid. Recebe tudo já serializável (widgets +
// dados pré-computados). v2.0 (09/07/2026): barra de período editável/removível
// e filtro como widget (siblings ao builder).
"use client";

import { useState, useTransition } from "react";
import { Check, Clock, Pencil, Plus, Redo2, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import type { AvailableField } from "@/lib/widgets/fields";
import type { PeriodScope, PeriodSelection } from "@/lib/widgets/period";
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
import type { DashboardSnapshot } from "@/lib/widgets/history";
import { renameDashboard, updateDashboardSettings } from "@/app/(app)/dashboards/actions";
import { DashboardGrid } from "./dashboard-grid";
import type { ResponsibleOption } from "./charts/record-list-table";
import { DashboardMenu } from "./dashboard-menu";
import { DashboardTabs } from "./dashboard-tabs";
import {
  DashboardHistoryProvider,
  useDashboardHistory,
} from "./history-context";
import { DashboardPendingProvider } from "./pending-context";
import { PeriodFilter } from "./period-filter";
import { WidgetBuilder } from "./widget-builder";

export function DashboardClient({
  dashboardId,
  dashboardName,
  historySeed,
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
  conversionPeriodById = {},
  settings,
  visibleToRoles,
  dateFormat,
  periodBar,
  periodScope,
  periodDefaultsByTab,
  periodDefaultFieldByTab,
  filterOptionsById,
}: {
  dashboardId: string;
  dashboardName: string;
  historySeed: DashboardSnapshot;
  widgets: Widget[];
  dataById: Record<string, WidgetData>;
  recordListById: Record<string, RecordRow[]>;
  entityListById: Record<string, EntityListRow[]>;
  calcById: Record<string, number | null>;
  fields: FieldDefinition[];
  fkLabels: Record<string, string>;
  responsibleOptions?: ResponsibleOption[];
  userRoles: string[];
  canEditValues: boolean;
  available: AvailableField[];
  canEdit: boolean;
  canManageFields?: boolean;
  currencyOptions?: { value: string; label: string }[];
  currencyRates?: CurrencyRates;
  conversionPeriodById?: Record<string, { year: number; quarter: number }>;
  settings: DashboardSettings;
  visibleToRoles: string[];
  dateFormat?: DateFormat;
  periodBar?: DashboardSettings["periodBar"];
  periodScope?: PeriodScope;
  periodDefaultsByTab?: Record<string, PeriodSelection>;
  periodDefaultFieldByTab?: Record<string, string>;
  filterOptionsById?: Record<string, FieldFilterOptions>;
}) {
  const [editMode, setEditMode] = useState(false);
  const [pending, startTransition] = useTransition();

  const barEnabled = periodBar?.enabled !== false;
  const backgroundCss = dashboardBackgroundCss(settings.background);

  // Abas: id efetivo de um widget = settings.tab ?? primeira aba. Sem abas
  // configuradas, o dashboard é uma tela única (todos os widgets visíveis).
  // Estado local otimista: cor/nome/adicionar/excluir refletem na hora (a
  // revalidação do servidor só chega ao recarregar). Ressincroniza quando o
  // servidor muda de fato (comparação por valor, sem useEffect).
  const serverTabs = settings.tabs ?? [];
  const serverKey = JSON.stringify(serverTabs);
  const [seedKey, setSeedKey] = useState(serverKey);
  const [tabs, setTabs] = useState(serverTabs);
  if (seedKey !== serverKey) {
    setSeedKey(serverKey);
    setTabs(serverTabs);
  }
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

  // Renomear o dashboard (inline no título). Estado otimista: aplica o nome na
  // hora e persiste no servidor. Nome vazio mantém o atual.
  const [renaming, setRenaming] = useState(false);
  const [seedName, setSeedName] = useState(dashboardName);
  const [name, setName] = useState(dashboardName);
  // Ressincroniza só quando a prop do servidor muda de fato (evita reverter o
  // valor otimista a cada render, como o padrão seedKey das abas acima).
  if (seedName !== dashboardName) {
    setSeedName(dashboardName);
    setName(dashboardName);
  }
  function commitName(value: string) {
    setRenaming(false);
    const next = value.trim();
    if (!next || next === name) return;
    setName(next);
    startTransition(async () => {
      await renameDashboard(dashboardId, next);
    });
  }

  function showBar() {
    startTransition(async () => {
      await updateDashboardSettings(dashboardId, {
        ...settings,
        periodBar: { ...periodBar, enabled: true },
      });
    });
  }

  function saveTabs(next: DashboardSettings["tabs"]) {
    setTabs(next ?? []); // aplica na hora (cor/nome/adicionar/excluir)
    startTransition(async () => {
      await updateDashboardSettings(dashboardId, { ...settings, tabs: next });
    });
  }

  return (
    <DashboardHistoryProvider dashboardId={dashboardId} seed={historySeed}>
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        {renaming ? (
          <Input
            autoFocus
            defaultValue={name}
            className="h-9 max-w-xs text-2xl font-semibold"
            onBlur={(e) => commitName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setRenaming(false);
            }}
            aria-label="Nome do dashboard"
          />
        ) : (
          <div className="flex items-center gap-1">
            <h1
              className="text-2xl font-semibold"
              onDoubleClick={() => canEdit && setRenaming(true)}
            >
              {name}
            </h1>
            {canEdit ? (
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground size-7"
                onClick={() => setRenaming(true)}
                title="Renomear dashboard"
                aria-label="Renomear dashboard"
              >
                <Pencil className="size-4" />
              </Button>
            ) : null}
          </div>
        )}
        {canEdit ? (
          <div className="flex items-center gap-2">
            <HistoryButtons />
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
            periodScope={periodScope}
            activeTabId={activeTabId}
            hasTabs={tabs.length > 0}
            periodDefaultsByTab={periodDefaultsByTab}
            periodDefaultFieldByTab={periodDefaultFieldByTab}
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
            activeTabId={activeTabId}
            canEdit={canEdit}
            canManageFields={canManageFields}
            currencyOptions={currencyOptions}
            currencyRates={currencyRates}
            conversionPeriodById={conversionPeriodById}
            editMode={editMode}
            filterOptionsById={filterOptionsById}
          />
        </div>
      </DashboardPendingProvider>
    </div>
    </DashboardHistoryProvider>
  );
}

// Botões Desfazer/Refazer (à esquerda de "Editar layout"). Componente separado
// para consumir o contexto de dentro do provider. Desabilita nos extremos do
// histórico e enquanto um restore está em andamento.
function HistoryButtons() {
  const { undo, redo, canUndo, canRedo, isRestoring } = useDashboardHistory();
  return (
    <>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        onClick={undo}
        disabled={!canUndo || isRestoring}
        title="Desfazer"
        aria-label="Desfazer"
      >
        <Undo2 className="size-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        onClick={redo}
        disabled={!canRedo || isRestoring}
        title="Refazer"
        aria-label="Refazer"
      >
        <Redo2 className="size-4" />
      </Button>
    </>
  );
}
