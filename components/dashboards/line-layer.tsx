// Versão: 1.1 | Data: 03/08/2026
// v1.1 (03/08/2026): prop boardWidgets (todas as abas) repassada ao
//   WidgetBuilder — listas "Aplicar a" caso o Visual seja trocado p/ filtro.
// Camada livre das Formas "linha" (ShapeKind "linha"): renderiza e manipula os
// widgets-linha FORA do react-grid-layout — SVG absoluto sobre o canvas, ANTES
// do RGL no DOM (pinta sob os cards, mesmo plano dos conectores; o container
// do RGL é pointer-events-none, então os cliques chegam aqui). Movimento em
// px SEM prender às colunas: arrastar o corpo translada a linha inteira;
// arrastar uma ponta alonga/encurta pivotando na outra, projetada ao eixo
// dominante do gesto (a linha é SEMPRE horizontal ou vertical). Nada persiste
// no meio do gesto (estado local; mesma filosofia do grid) — o commit sai no
// pointerup via onCommit (persistLine do dashboard-grid). Clique parado abre o
// menu de ações (Editar dados/Aparência/Copiar/Excluir — o menu "⋮" do
// WidgetCard é interno a ele, então os pesos são montados aqui mesmo). Fora do
// modo edição, clique na linha segue o atalho shape.link (useFocusWidget).
// Tudo interativo leva [data-line-ui]: o canvas ignora esses alvos no pan e no
// menu de colar. Geometria pura em lib/widgets/lines.ts.
"use client";

import { useEffect, useState, useTransition } from "react";
import { Copy, Palette, Pencil, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteWidget } from "@/app/(app)/dashboards/actions";
import { notifyOnError } from "@/lib/feedback/notify";
import type { FieldDefinition } from "@/lib/records/types";
import type { AvailableField } from "@/lib/widgets/fields";
import { itemRect, type GridMetrics } from "@/lib/widgets/connectors";
import { widgetDomId } from "@/lib/widgets/focus";
import { copyWidget } from "@/lib/widgets/clipboard";
import {
  clampLine,
  gridPtToPx,
  lineGridBBox,
  pxDeltaToGrid,
} from "@/lib/widgets/lines";
import type { ShapeLine, Widget, WidgetData } from "@/lib/widgets/types";
import { FloatingPanel, MenuBtn } from "./appearance-editing";
import { useFocusWidget } from "./focus-context";
import { WidgetAppearanceSheet } from "./widget-appearance-sheet";
import { WidgetBuilder } from "./widget-builder";

const DEFAULT_STROKE = "var(--color-brand)";
const DEFAULT_STROKE_WIDTH = 2;
// Fallback estável para o Aparência (linha não tem dados de consulta).
const EMPTY_WIDGET_DATA: WidgetData = { rows: [], dimensions: [], metrics: [] };
// Abaixo disso o gesto é um CLIQUE (abre o menu), não um arraste.
const DRAG_THRESHOLD_PX = 3;

type DragState = {
  id: string;
  kind: "body" | "p1" | "p2";
  sx: number; // clientX/Y no pointerdown
  sy: number;
  start: ShapeLine;
  line: ShapeLine;
  moved: boolean;
};

export function LineLayer({
  widgets,
  lineFor,
  metrics,
  cols,
  maxRows,
  editMode,
  canEdit,
  dashboardId,
  onCommit,
  onWidgetDeleted,
  availableForBuilder,
  fields,
  currencyOptions,
  tabs,
  siblings,
  boardWidgets,
  canManageFields = false,
}: {
  widgets: Widget[]; // só os widgets-linha da aba visível
  // Traçado efetivo (otimista ?? settings ?? derivado do rect) — vem do grid,
  // que conhece o layoutById.
  lineFor: (w: Widget, i: number) => ShapeLine;
  metrics: GridMetrics;
  cols: number;
  maxRows: number;
  editMode: boolean;
  canEdit: boolean;
  dashboardId: string;
  onCommit: (id: string, next: ShapeLine) => void;
  onWidgetDeleted?: (id: string) => void;
  availableForBuilder: AvailableField[];
  fields: FieldDefinition[];
  currencyOptions?: { value: string; label: string }[];
  tabs?: { id: string; name: string; color?: string }[];
  siblings: Widget[];
  // TODOS os widgets do board — só p/ as listas "Aplicar a" do builder.
  boardWidgets?: Widget[];
  canManageFields?: boolean;
}) {
  const focus = useFocusWidget();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  // Menu de ações + overlays do widget ativo (nonce remonta o painel a cada
  // abertura, mesmo padrão do widget-card).
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(
    null
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderNonce, setBuilderNonce] = useState(0);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [appearanceNonce, setAppearanceNonce] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Esc cancela o arraste em curso (restaura o traçado inicial — nada foi
  // persistido). O capture do ponteiro segue até o pointerup, mas os handlers
  // ignoram eventos sem drag ativo.
  useEffect(() => {
    if (!drag) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrag(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [drag]);

  // Saiu do modo edição no meio de um gesto/menu → descarta (ajuste de estado
  // no render, padrão seedKey do shell).
  const [seenEditMode, setSeenEditMode] = useState(editMode);
  if (seenEditMode !== editMode) {
    setSeenEditMode(editMode);
    if (!editMode) {
      setDrag(null);
      setMenu(null);
    }
  }

  function beginDrag(
    e: React.PointerEvent<SVGElement>,
    id: string,
    kind: DragState["kind"],
    start: ShapeLine
  ) {
    if (!editMode) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id, kind, sx: e.clientX, sy: e.clientY, start, line: start, moved: false });
  }

  function moveDrag(e: React.PointerEvent<SVGElement>) {
    if (!drag) return;
    const dxPx = e.clientX - drag.sx;
    const dyPx = e.clientY - drag.sy;
    const moved =
      drag.moved || Math.hypot(dxPx, dyPx) >= DRAG_THRESHOLD_PX;
    if (!moved) return;
    const d = pxDeltaToGrid(dxPx, dyPx, metrics);
    const s = drag.start;
    let next: ShapeLine;
    if (drag.kind === "body") {
      next = {
        x1: s.x1 + d.dx,
        y1: s.y1 + d.dy,
        x2: s.x2 + d.dx,
        y2: s.y2 + d.dy,
      };
    } else {
      // A ponta arrastada segue o cursor pivotando na OUTRA (âncora fixa),
      // projetada ao eixo dominante do vão âncora→cursor — é assim que a
      // linha troca entre horizontal e vertical.
      const anchor =
        drag.kind === "p1"
          ? { x: s.x2, y: s.y2 }
          : { x: s.x1, y: s.y1 };
      const raw =
        drag.kind === "p1"
          ? { x: s.x1 + d.dx, y: s.y1 + d.dy }
          : { x: s.x2 + d.dx, y: s.y2 + d.dy };
      const pt =
        Math.abs(raw.x - anchor.x) >= Math.abs(raw.y - anchor.y)
          ? { x: raw.x, y: anchor.y }
          : { x: anchor.x, y: raw.y };
      next =
        drag.kind === "p1"
          ? { x1: pt.x, y1: pt.y, x2: anchor.x, y2: anchor.y }
          : { x1: anchor.x, y1: anchor.y, x2: pt.x, y2: pt.y };
    }
    setDrag({ ...drag, line: clampLine(next, cols, maxRows), moved: true });
  }

  function endDrag(e: React.PointerEvent<SVGElement>) {
    if (!drag) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // capture pode já ter sido liberada
    }
    const done = drag;
    setDrag(null);
    if (done.moved) {
      onCommit(done.id, done.line);
      return;
    }
    // Clique parado no corpo: abre o menu de ações.
    if (done.kind === "body" && canEdit) {
      setMenu({ id: done.id, x: e.clientX, y: e.clientY });
    }
  }

  const active = activeId ? widgets.find((w) => w.id === activeId) : undefined;
  const menuWidget = menu ? widgets.find((w) => w.id === menu.id) : undefined;

  return (
    <>
      <svg
        className="absolute inset-0 h-full w-full"
        style={{ pointerEvents: "none" }}
        aria-hidden
      >
        {widgets.map((w, i) => {
          const line =
            drag?.id === w.id && drag.moved ? drag.line : lineFor(w, i);
          const p1 = gridPtToPx({ x: line.x1, y: line.y1 }, metrics);
          const p2 = gridPtToPx({ x: line.x2, y: line.y2 }, metrics);
          const ap = w.settings?.appearance?.shape;
          const stroke = ap?.stroke ?? DEFAULT_STROKE;
          const strokeWidth = ap?.strokeWidth ?? DEFAULT_STROKE_WIDTH;
          const link = w.settings?.shape?.link;
          const text = w.settings?.shape?.text;
          const activeLine =
            drag?.id === w.id || hoverId === w.id || menu?.id === w.id;
          const horizontal =
            Math.abs(line.x2 - line.x1) >= Math.abs(line.y2 - line.y1);
          const interactive = editMode || (!!link && !editMode);
          return (
            <g key={w.id}>
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke={stroke}
                strokeWidth={strokeWidth + (activeLine && editMode ? 1 : 0)}
                strokeLinecap="round"
              />
              {/* Área de clique/arraste generosa e invisível. */}
              <line
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                data-line-ui
                stroke="transparent"
                strokeWidth={Math.max(14, strokeWidth + 8)}
                style={{
                  pointerEvents: interactive ? "stroke" : "none",
                  cursor: editMode ? "move" : link ? "pointer" : undefined,
                  touchAction: "none",
                }}
                onPointerEnter={() => setHoverId(w.id)}
                onPointerLeave={() =>
                  setHoverId((cur) => (cur === w.id ? null : cur))
                }
                onPointerDown={(e) => beginDrag(e, w.id, "body", lineFor(w, i))}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={() => setDrag(null)}
                onClick={
                  !editMode && link ? () => focus(link) : undefined
                }
              />
              {text ? (
                <text
                  x={(p1.x + p2.x) / 2}
                  y={(p1.y + p2.y) / 2 - 8}
                  textAnchor="middle"
                  className="text-xs"
                  fill={ap?.textColor ?? stroke}
                  fontSize={ap?.fontSize}
                  stroke="var(--color-background)"
                  strokeWidth={3}
                  style={{ paintOrder: "stroke" }}
                >
                  {text}
                </text>
              ) : null}
              {/* Alças das pontas (modo edição, linha em foco). */}
              {editMode && activeLine
                ? (
                    [
                      { kind: "p1" as const, p: p1 },
                      { kind: "p2" as const, p: p2 },
                    ]
                  ).map(({ kind, p }) => (
                    <circle
                      key={kind}
                      data-line-ui
                      cx={p.x}
                      cy={p.y}
                      r={6}
                      fill={stroke}
                      stroke="var(--color-background)"
                      strokeWidth={2}
                      style={{
                        pointerEvents: "auto",
                        cursor: horizontal ? "ew-resize" : "ns-resize",
                        touchAction: "none",
                      }}
                      onPointerEnter={() => setHoverId(w.id)}
                      onPointerLeave={() =>
                        setHoverId((cur) => (cur === w.id ? null : cur))
                      }
                      onPointerDown={(e) =>
                        beginDrag(e, w.id, kind, lineFor(w, i))
                      }
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={() => setDrag(null)}
                    />
                  ))
                : null}
            </g>
          );
        })}
      </svg>

      {/* Âncoras de DOM no bbox de cada linha: alvo do foco/atalho para widget
          (focusWidgetWithRetry procura widget-<id>; o pulso .widget-focus
          desenha em volta do bbox). */}
      <div className="absolute inset-0" style={{ pointerEvents: "none" }}>
        {widgets.map((w, i) => {
          const line =
            drag?.id === w.id && drag.moved ? drag.line : lineFor(w, i);
          const r = itemRect(lineGridBBox(line), metrics);
          return (
            <div
              key={w.id}
              id={widgetDomId(w.id)}
              className="absolute"
              style={{
                left: r.left,
                top: r.top,
                width: r.width,
                height: r.height,
              }}
            />
          );
        })}
      </div>

      {/* Menu de ações da linha clicada (mesmas ações do "⋮" de um card). */}
      {menu && menuWidget && canEdit ? (
        <div data-line-ui>
          <FloatingPanel
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            className="w-44"
          >
            <MenuBtn
              onClick={() => {
                setActiveId(menu.id);
                setMenu(null);
                setBuilderNonce((n) => n + 1);
                setBuilderOpen(true);
              }}
            >
              <Pencil /> Editar dados
            </MenuBtn>
            <MenuBtn
              onClick={() => {
                setActiveId(menu.id);
                setMenu(null);
                setAppearanceNonce((n) => n + 1);
                setAppearanceOpen(true);
              }}
            >
              <Palette /> Aparência
            </MenuBtn>
            <MenuBtn
              onClick={() => {
                copyWidget(menuWidget);
                setCopiedId(menu.id);
                window.setTimeout(() => setCopiedId(null), 1500);
              }}
            >
              <Copy /> {copiedId === menu.id ? "Copiado!" : "Copiar widget"}
            </MenuBtn>
            <div className="bg-border my-1 h-px" />
            <MenuBtn
              onClick={() => {
                setActiveId(menu.id);
                setMenu(null);
                setDeleteOpen(true);
              }}
            >
              <Trash2 className="text-destructive" />{" "}
              <span className="text-destructive">Excluir</span>
            </MenuBtn>
          </FloatingPanel>
        </div>
      ) : null}

      {canEdit && active ? (
        <>
          <WidgetBuilder
            key={`b${builderNonce}`}
            dashboardId={dashboardId}
            available={availableForBuilder}
            widget={active}
            siblings={siblings}
            boardWidgets={boardWidgets}
            canManageFields={canManageFields}
            fields={fields}
            currencyOptions={currencyOptions}
            tabs={tabs}
            open={builderOpen}
            onOpenChange={setBuilderOpen}
          />
          <WidgetAppearanceSheet
            key={`a${appearanceNonce}`}
            dashboardId={dashboardId}
            widget={active}
            data={EMPTY_WIDGET_DATA}
            available={availableForBuilder}
            open={appearanceOpen}
            onOpenChange={setAppearanceOpen}
          />
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir widget?</AlertDialogTitle>
                <AlertDialogDescription>
                  Tem certeza que deseja excluir
                  {active.title ? ` "${active.title}"` : " esta linha"}? Esta
                  ação não pode ser desfeita.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>
                  Cancelar
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={pending}
                  onClick={(e) => {
                    e.preventDefault();
                    startTransition(async () => {
                      const res = await notifyOnError(
                        deleteWidget(active.id, dashboardId),
                        "Não foi possível excluir a linha"
                      );
                      if (res?.ok) onWidgetDeleted?.(active.id);
                      setDeleteOpen(false);
                    });
                  }}
                >
                  Excluir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </>
  );
}
