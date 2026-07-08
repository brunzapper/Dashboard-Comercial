// Versão: 1.0 | Data: 05/07/2026
// Grid drag-and-drop dos widgets (react-grid-layout v2 via wrapper /legacy,
// API v1 familiar). No modo edição persiste o layout via saveLayout.
"use client";

import { useRef } from "react";
import RGL, { WidthProvider } from "react-grid-layout/legacy";
import type { Layout } from "react-grid-layout/legacy";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import type { AvailableField } from "@/lib/widgets/fields";
import type { GridPosition, Widget, WidgetData } from "@/lib/widgets/types";
import { saveLayout } from "@/app/(app)/dashboards/actions";
import { WidgetCard } from "./widget-card";

const GridLayout = WidthProvider(RGL);

function posOf(w: Widget, i: number): GridPosition {
  const p = w.grid_position as GridPosition;
  if (p && typeof p.w === "number") return p;
  return { x: (i % 2) * 6, y: Math.floor(i / 2) * 8, w: 6, h: 8 };
}

export function DashboardGrid({
  widgets,
  dataById,
  available,
  dashboardId,
  canEdit,
  editMode,
}: {
  widgets: Widget[];
  dataById: Record<string, WidgetData>;
  available: AvailableField[];
  dashboardId: string;
  canEdit: boolean;
  editMode: boolean;
}) {
  const mounted = useRef(false);

  const layout: Layout = widgets.map((w, i) => {
    const p = posOf(w, i);
    return { i: w.id, x: p.x, y: p.y, w: p.w, h: p.h };
  });

  function onLayoutChange(next: Layout) {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!editMode) return;
    void saveLayout(
      dashboardId,
      next.map((it) => ({ id: it.i, x: it.x, y: it.y, w: it.w, h: it.h }))
    );
  }

  if (widgets.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border p-8 text-center text-sm">
        Nenhum widget ainda. {canEdit ? "Adicione o primeiro." : ""}
      </div>
    );
  }

  return (
    <GridLayout
      className="layout"
      layout={layout}
      cols={12}
      rowHeight={30}
      margin={[12, 12]}
      isDraggable={editMode}
      isResizable={editMode}
      draggableHandle=".widget-drag"
      onLayoutChange={onLayoutChange}
    >
      {widgets.map((w) => (
        <div key={w.id}>
          <WidgetCard
            widget={w}
            data={dataById[w.id] ?? { rows: [], dimensions: [], metrics: [] }}
            available={available}
            dashboardId={dashboardId}
            canEdit={canEdit}
            editMode={editMode}
          />
        </div>
      ))}
    </GridLayout>
  );
}
