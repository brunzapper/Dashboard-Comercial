// Versão: 2.0 | Data: 09/07/2026
// Shell do dashboard: cabeçalho + alternar modo de edição + adicionar widget +
// barra de período global + o grid. Recebe tudo já serializável (widgets +
// dados pré-computados). v2.0 (09/07/2026): barra de período editável/removível
// e filtro como widget (siblings ao builder).
"use client";

import { useState, useTransition } from "react";
import { Check, Clock, Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AvailableField } from "@/lib/widgets/fields";
import type { DashboardSettings, Widget, WidgetData } from "@/lib/widgets/types";
import { updateDashboardSettings } from "@/app/(app)/dashboards/actions";
import { DashboardGrid } from "./dashboard-grid";
import { PeriodFilter } from "./period-filter";
import { WidgetBuilder } from "./widget-builder";

export function DashboardClient({
  dashboardId,
  dashboardName,
  widgets,
  dataById,
  available,
  canEdit,
  periodBar,
}: {
  dashboardId: string;
  dashboardName: string;
  widgets: Widget[];
  dataById: Record<string, WidgetData>;
  available: AvailableField[];
  canEdit: boolean;
  periodBar?: DashboardSettings["periodBar"];
}) {
  const [editMode, setEditMode] = useState(false);
  const [pending, startTransition] = useTransition();

  const barEnabled = periodBar?.enabled !== false;

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
              trigger={
                <Button size="sm">
                  <Plus className="size-4" /> Adicionar widget
                </Button>
              }
            />
          </div>
        ) : null}
      </div>

      {barEnabled ? (
        <PeriodFilter
          available={available}
          canEdit={canEdit}
          dashboardId={dashboardId}
          periodBar={periodBar}
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

      <DashboardGrid
        widgets={widgets}
        dataById={dataById}
        available={available}
        dashboardId={dashboardId}
        canEdit={canEdit}
        editMode={editMode}
      />
    </div>
  );
}
