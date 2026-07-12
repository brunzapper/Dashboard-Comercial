// Versão: 1.0 | Data: 05/07/2026
// Grid drag-and-drop dos widgets (react-grid-layout v2 via wrapper /legacy,
// API v1 familiar). No modo edição persiste o layout via saveLayout.
"use client";

import { useRef } from "react";
import { Loader2 } from "lucide-react";
import RGL, { WidthProvider } from "react-grid-layout/legacy";
import type { Layout } from "react-grid-layout/legacy";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { cn } from "@/lib/utils";
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import type { AvailableField } from "@/lib/widgets/fields";
import type {
  FieldFilterOptions,
  GridPosition,
  Widget,
  WidgetData,
} from "@/lib/widgets/types";
import type { DateFormat } from "@/lib/widgets/format";
import type { CurrencyRates } from "@/lib/widgets/currency";
import type { EntityListRow } from "@/lib/widgets/entity-list";
import { saveLayout } from "@/app/(app)/dashboards/actions";
import { useNavPending } from "./pending-context";
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
  recordListById,
  entityListById,
  calcById,
  fields,
  fkLabels,
  responsibleOptions,
  userRoles,
  canEditValues,
  available,
  dashboardId,
  dateFormat,
  cols,
  rowHeight,
  tabs,
  canEdit,
  canManageFields = false,
  currencyOptions,
  currencyRates = {},
  editMode,
  filterOptionsById,
}: {
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
  dashboardId: string;
  dateFormat?: DateFormat;
  cols?: number;
  rowHeight?: number;
  tabs?: { id: string; name: string; color?: string }[];
  canEdit: boolean;
  canManageFields?: boolean;
  currencyOptions?: { value: string; label: string }[];
  currencyRates?: CurrencyRates;
  editMode: boolean;
  filterOptionsById?: Record<string, FieldFilterOptions>;
}) {
  const mounted = useRef(false);
  const { pending } = useNavPending();

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
    <div className="relative">
      {/* Overlay de recarregamento: aparece enquanto o servidor recomputa os
          widgets após uma mudança de período/filtro. */}
      {pending ? (
        <div className="bg-background/50 absolute inset-0 z-20 flex items-start justify-center rounded-lg backdrop-blur-[1px]">
          <div className="bg-background text-muted-foreground mt-6 flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm shadow-sm">
            <Loader2 className="size-4 animate-spin" />
            Carregando…
          </div>
        </div>
      ) : null}
      <GridLayout
        className={cn("layout transition-opacity", pending && "opacity-60")}
        layout={layout}
        cols={cols ?? 12}
        rowHeight={rowHeight ?? 30}
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
              recordList={recordListById[w.id] ?? []}
              entityList={entityListById[w.id] ?? []}
              calcValue={calcById[w.id] ?? null}
              fields={fields}
              currencyOptions={currencyOptions}
              currencyRates={currencyRates}
              fkLabels={fkLabels}
              responsibleOptions={responsibleOptions}
              userRoles={userRoles}
              canEditValues={canEditValues}
              available={available}
              dashboardId={dashboardId}
              dateFormat={dateFormat}
              siblings={widgets}
              tabs={tabs}
              canEdit={canEdit}
              canManageFields={canManageFields}
              editMode={editMode}
              filterOptions={filterOptionsById?.[w.id]}
            />
          </div>
        ))}
      </GridLayout>
    </div>
  );
}
