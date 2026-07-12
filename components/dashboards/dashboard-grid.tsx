// Versão: 2.0 | Data: 12/07/2026
// Grid drag-and-drop dos widgets (react-grid-layout v2 via wrapper /legacy,
// API v1 familiar). No modo edição persiste o layout via saveLayout.
// v2.0 (12/07/2026): área de trabalho redimensionável. Em vez de WidthProvider
//   (largura travada = tela ÷ colunas), a largura é calculada mantendo o tamanho
//   de célula das 12 colunas, e uma alça de canto (modo edição) aumenta cols/rows
//   do canvas — que ganha rolagem quando passa da tela. Tamanho por dashboard em
//   settings.canvas ({ cols, rows, rowHeight }).
"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import RGL from "react-grid-layout/legacy";
import type { Layout } from "react-grid-layout/legacy";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { cn } from "@/lib/utils";
import type { FieldDefinition, RecordRow } from "@/lib/records/types";
import type { AvailableField } from "@/lib/widgets/fields";
import type {
  DashboardSettings,
  FieldFilterOptions,
  GridPosition,
  Widget,
  WidgetData,
} from "@/lib/widgets/types";
import type { DateFormat } from "@/lib/widgets/format";
import type { CurrencyRates } from "@/lib/widgets/currency";
import type { EntityListRow } from "@/lib/widgets/entity-list";
import { saveLayout, updateDashboardSettings } from "@/app/(app)/dashboards/actions";
import { useNavPending } from "./pending-context";
import { WidgetCard } from "./widget-card";

// Margens do grid e limites do canvas (mesmos valores de sempre).
const MX = 12;
const MY = 12;
const DEFAULT_ROW_H = 30;
const MIN_COLS = 12;
const MAX_COLS = 48;
const MIN_ROWS = 8;
const MAX_ROWS = 200;

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
  settings,
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
  settings: DashboardSettings;
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

  // Extensão do conteúdo — pisos para não cortar widgets ao encolher a área.
  const contentRight = layout.reduce((m, l) => Math.max(m, l.x + l.w), MIN_COLS);
  const contentBottom = layout.reduce((m, l) => Math.max(m, l.y + l.h), MIN_ROWS);
  const ROW_H = settings.canvas?.rowHeight ?? DEFAULT_ROW_H;

  // Tamanho efetivo do canvas (vindo das settings): nunca abaixo do conteúdo,
  // nunca além dos limites.
  const propCols = Math.min(MAX_COLS, Math.max(contentRight, settings.canvas?.cols ?? MIN_COLS));
  const propRows = Math.min(MAX_ROWS, Math.max(contentBottom, settings.canvas?.rows ?? contentBottom));
  // Override transitório durante o arraste da alça (null fora do arraste → segue
  // as settings, então mudanças pelo menu refletem na hora).
  const [drag, setDrag] = useState<{ cols: number; rows: number } | null>(null);
  const cols = drag ? drag.cols : propCols;
  const rows = drag ? drag.rows : propRows;
  // Limpa o override assim que as settings do servidor alcançam o valor arrastado
  // (evita "piscar" de volta ao tamanho antigo enquanto revalida). Padrão do React
  // de ajustar estado no render — sem useEffect.
  if (drag && propCols === drag.cols && propRows === drag.rows) setDrag(null);

  // Largura visível (base das 12 colunas) medida do container de rolagem.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [baseWidth, setBaseWidth] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setBaseWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Célula constante: 12 colunas preenchem a largura visível (fórmula do RGL:
  // colWidth = (width - MX*(cols+1))/cols), então widgets não mudam de tamanho.
  const cellW = baseWidth > 0 ? (baseWidth - MX * (MIN_COLS + 1)) / MIN_COLS : 0;
  const gridW = (c: number) => c * cellW + MX * (c + 1);
  const gridH = (r: number) => r * ROW_H + MY * (r + 1);

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

  // Alças de borda: a barra inferior arrasta a ALTURA (rows), a barra direita a
  // LARGURA (cols). Persiste ao soltar, preservando as demais settings (rowHeight,
  // background, abas, …).
  const dragRef = useRef<
    { x: number; y: number; cols: number; rows: number; axis: "row" | "col" } | null
  >(null);
  const lastRef = useRef<{ cols: number; rows: number } | null>(null);
  function onHandleDown(e: React.PointerEvent, axis: "row" | "col") {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { x: e.clientX, y: e.clientY, cols, rows, axis };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onHandleMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || cellW <= 0) return;
    const nextCols =
      d.axis === "col"
        ? Math.min(MAX_COLS, Math.max(contentRight, d.cols + Math.round((e.clientX - d.x) / (cellW + MX))))
        : d.cols;
    const nextRows =
      d.axis === "row"
        ? Math.min(MAX_ROWS, Math.max(contentBottom, d.rows + Math.round((e.clientY - d.y) / (ROW_H + MY))))
        : d.rows;
    const next = { cols: nextCols, rows: nextRows };
    lastRef.current = next;
    setDrag(next);
  }
  function onHandleUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // capture pode já ter sido liberada
    }
    const last = lastRef.current;
    if (!last) return;
    void updateDashboardSettings(dashboardId, {
      ...settings,
      canvas: { ...settings.canvas, cols: last.cols, rows: last.rows },
    });
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
      {/* Container de rolagem: a largura do grid pode passar da tela → rolagem
          horizontal; a altura é explícita, então a página cresce normalmente. */}
      <div ref={scrollRef} className="overflow-x-auto overflow-y-hidden">
        {baseWidth > 0 ? (
          <div
            className={cn(
              "relative",
              editMode &&
                "rounded-md border border-dashed border-primary/40 bg-primary/[0.02]"
            )}
            style={{ width: gridW(cols), height: gridH(rows) }}
          >
            <RGL
              className={cn("layout transition-opacity", pending && "opacity-60")}
              layout={layout}
              cols={cols}
              width={gridW(cols)}
              maxRows={rows}
              rowHeight={ROW_H}
              margin={[MX, MY]}
              containerPadding={[MX, MY]}
              autoSize={false}
              style={{ height: gridH(rows) }}
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
            </RGL>
            {editMode ? (
              <>
                {/* Barra inferior: arrasta a ALTURA (adiciona linhas vazias). */}
                <span
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Arraste para aumentar a altura da área"
                  title="Arraste para aumentar a altura da área"
                  onPointerDown={(e) => onHandleDown(e, "row")}
                  onPointerMove={onHandleMove}
                  onPointerUp={onHandleUp}
                  onPointerCancel={onHandleUp}
                  className={cn(
                    "absolute bottom-0 left-0 z-20 flex h-3 w-full items-center justify-center",
                    "cursor-ns-resize touch-none rounded-b-md bg-primary/15 hover:bg-primary/30",
                    "before:h-0.5 before:w-8 before:rounded-full before:bg-primary/60 before:content-['']"
                  )}
                />
                {/* Barra direita: arrasta a LARGURA. */}
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Arraste para aumentar a largura da área"
                  title="Arraste para aumentar a largura da área"
                  onPointerDown={(e) => onHandleDown(e, "col")}
                  onPointerMove={onHandleMove}
                  onPointerUp={onHandleUp}
                  onPointerCancel={onHandleUp}
                  className={cn(
                    "absolute top-0 right-0 z-20 flex h-full w-3 items-center justify-center",
                    "cursor-ew-resize touch-none rounded-r-md bg-primary/15 hover:bg-primary/30",
                    "before:h-8 before:w-0.5 before:rounded-full before:bg-primary/60 before:content-['']"
                  )}
                />
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
