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
import type { DashboardSettings, Widget, WidgetData } from "@/lib/widgets/types";
import type { DateFormat } from "@/lib/widgets/format";
import type { EntityListRow } from "@/lib/widgets/entity-list";
import { dashboardBackgroundCss } from "@/lib/widgets/appearance";
import { updateDashboardSettings } from "@/app/(app)/dashboards/actions";
import { DashboardGrid } from "./dashboard-grid";
import { DashboardMenu } from "./dashboard-menu";
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
  userRoles,
  canEditValues,
  available,
  canEdit,
  canManageFields = false,
  settings,
  dateFormat,
  periodBar,
  periodDefaults,
  periodDefaultField,
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
  userRoles: string[];
  canEditValues: boolean;
  available: AvailableField[];
  canEdit: boolean;
  canManageFields?: boolean;
  settings: DashboardSettings;
  dateFormat?: DateFormat;
  periodBar?: DashboardSettings["periodBar"];
  periodDefaults?: PeriodSelection;
  periodDefaultField?: string;
}) {
  const [editMode, setEditMode] = useState(false);
  const [pending, startTransition] = useTransition();

  const barEnabled = periodBar?.enabled !== false;
  const backgroundCss = dashboardBackgroundCss(settings.background);

  function showBar() {
    startTransition(async () => {
      await updateDashboardSettings(dashboardId, {
        periodBar: { ...periodBar, enabled: true },
      });
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
              trigger={
                <Button size="sm">
                  <Plus className="size-4" /> Adicionar widget
                </Button>
              }
            />
            <DashboardMenu dashboardId={dashboardId} settings={settings} />
          </div>
        ) : null}
      </div>

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
            widgets={widgets}
            dataById={dataById}
            recordListById={recordListById}
            entityListById={entityListById}
            calcById={calcById}
            fields={fields}
            fkLabels={fkLabels}
            userRoles={userRoles}
            canEditValues={canEditValues}
            available={available}
            dashboardId={dashboardId}
            dateFormat={dateFormat}
            canEdit={canEdit}
            canManageFields={canManageFields}
            editMode={editMode}
          />
        </div>
      </DashboardPendingProvider>
    </div>
  );
}
