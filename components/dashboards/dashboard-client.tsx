// Versão: 1.0 | Data: 05/07/2026
// Shell do dashboard: cabeçalho + alternar modo de edição + adicionar widget +
// o grid. Recebe tudo já serializável (widgets + dados pré-computados).
"use client";

import { useState } from "react";
import { Check, Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AvailableField } from "@/lib/widgets/fields";
import type { Widget, WidgetData } from "@/lib/widgets/types";
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
}: {
  dashboardId: string;
  dashboardName: string;
  widgets: Widget[];
  dataById: Record<string, WidgetData>;
  available: AvailableField[];
  canEdit: boolean;
}) {
  const [editMode, setEditMode] = useState(false);

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
              trigger={
                <Button size="sm">
                  <Plus className="size-4" /> Adicionar widget
                </Button>
              }
            />
          </div>
        ) : null}
      </div>

      <PeriodFilter available={available} />

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
