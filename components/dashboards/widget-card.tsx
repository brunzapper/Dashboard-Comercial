// Versão: 1.0 | Data: 05/07/2026
// Card de um widget no grid: cabeçalho (título + editar/excluir + alça de
// arraste no modo edição) e o chart.
"use client";

import { useTransition } from "react";
import { GripVertical, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AvailableField } from "@/lib/widgets/fields";
import type { Widget, WidgetData } from "@/lib/widgets/types";
import { deleteWidget } from "@/app/(app)/dashboards/actions";
import { WidgetChart } from "./charts/widget-chart";
import { WidgetBuilder } from "./widget-builder";

export function WidgetCard({
  widget,
  data,
  available,
  dashboardId,
  canEdit,
  editMode,
}: {
  widget: Widget;
  data: WidgetData;
  available: AvailableField[];
  dashboardId: string;
  canEdit: boolean;
  editMode: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="bg-card flex h-full flex-col overflow-hidden rounded-lg border">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {editMode ? (
          <span className="widget-drag text-muted-foreground cursor-move">
            <GripVertical className="size-4" />
          </span>
        ) : null}
        <span className="flex-1 truncate text-sm font-medium">
          {widget.title ?? "Sem título"}
        </span>
        {canEdit ? (
          <div className="flex items-center gap-1">
            <WidgetBuilder
              dashboardId={dashboardId}
              available={available}
              widget={widget}
              trigger={
                <Button variant="ghost" size="icon" aria-label="Editar widget">
                  <Pencil className="size-4" />
                </Button>
              }
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Excluir widget"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await deleteWidget(widget.id, dashboardId);
                })
              }
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 p-2">
        <WidgetChart visualType={widget.visual_type} data={data} />
      </div>
    </div>
  );
}
