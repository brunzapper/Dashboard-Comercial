// Versão: 1.0 | Data: 15/07/2026
// Camada de conectores (linhas retas/curvas entre widgets, estilo n8n/Make).
// Renderiza um SVG absoluto sobre o canvas do grid, ANTES do RGL no DOM (as
// linhas pintam sob os cards). Geometria em lib/widgets/connectors.ts a partir
// do layout do grid; durante um arraste/redimensionamento o grid entrega o
// layout transitório via apiRef.setLive (as pontas seguem o gesto sem
// re-render do grid). Criação (connectMode): âncoras nos 4 lados de cada
// widget — clique na origem, linha elástica até o cursor, clique no destino.
// Edição (editMode): clique na linha abre um painel (forma/cor/espessura/
// tracejado/seta/rótulo/excluir). Tudo com [data-conn-ui]: o canvas ignora
// esses alvos no pan e no menu de colar.
"use client";

import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { newConnectorId } from "@/lib/widgets/calculator";
import {
  anchorPoint,
  connectorMidpoint,
  connectorPath,
  connectorTab,
  itemRect,
  resolveSides,
  type Anchor,
  type GridMetrics,
  type PxRect,
  type Side,
} from "@/lib/widgets/connectors";
import type { Connector, Widget } from "@/lib/widgets/types";
import { ColorField } from "./appearance-controls";
import { FloatingPanel } from "./appearance-editing";

// Item mínimo de layout que a camada precisa (estruturalmente compatível com o
// Layout do react-grid-layout/legacy).
export interface LayoutLike {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ConnectorLayerApi {
  // Layout transitório do gesto (onDrag/onResize do RGL); null = fim do gesto.
  setLive: (l: readonly LayoutLike[] | null) => void;
}

const DEFAULT_COLOR = "var(--color-primary)";
const SIDES: Side[] = ["top", "right", "bottom", "left"];

export function ConnectorLayer({
  connectors,
  layout,
  widgets,
  metrics,
  tabs,
  activeTabId,
  editMode,
  connectMode,
  onChange,
  apiRef,
}: {
  connectors: Connector[];
  layout: readonly LayoutLike[];
  widgets: Widget[];
  metrics: GridMetrics;
  tabs?: { id: string; name: string; color?: string }[];
  activeTabId: string;
  editMode: boolean;
  connectMode: boolean;
  onChange: (next: Connector[]) => void;
  apiRef: MutableRefObject<ConnectorLayerApi | null>;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [live, setLive] = useState<readonly LayoutLike[] | null>(null);
  useEffect(() => {
    apiRef.current = { setLive };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);

  // Conector selecionado (painel de edição) e origem pendente da criação.
  const [sel, setSel] = useState<{ id: string; x: number; y: number } | null>(
    null
  );
  const [pendingFrom, setPendingFrom] = useState<{
    widgetId: string;
    side: Side;
    anchor: Anchor;
  } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  // Sair do modo conectar cancela a origem pendente (ajuste de estado no
  // render, mesmo padrão seedKey do shell — sem useEffect).
  const [seenConnectMode, setSeenConnectMode] = useState(connectMode);
  if (seenConnectMode !== connectMode) {
    setSeenConnectMode(connectMode);
    if (!connectMode) {
      setPendingFrom(null);
      setCursor(null);
    }
  }

  // Linha elástica: segue o cursor (coords relativas ao SVG); Escape ou clique
  // fora de uma âncora cancela.
  useEffect(() => {
    if (!pendingFrom) return;
    const move = (e: PointerEvent) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest?.("[data-conn-ui]")) return;
      setPendingFrom(null);
      setCursor(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPendingFrom(null);
        setCursor(null);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key);
    };
  }, [pendingFrom]);

  // Retângulos em px por widget visível (layout transitório do gesto, quando há).
  const effLayout = live ?? layout;
  const rectById = new Map<string, PxRect>();
  for (const l of effLayout) rectById.set(l.i, itemRect(l, metrics));

  // Conectores da aba ativa com as duas pontas presentes.
  const tabIds = new Set((tabs ?? []).map((t) => t.id));
  const firstTabId = tabs?.[0]?.id ?? "";
  const visible = connectors.filter((c) => {
    if ((tabs?.length ?? 0) > 0 && connectorTab(c, tabIds, firstTabId) !== activeTabId)
      return false;
    return rectById.has(c.from.widgetId) && rectById.has(c.to.widgetId);
  });

  const patch = (id: string, changes: Partial<Connector>) =>
    onChange(connectors.map((c) => (c.id === id ? { ...c, ...changes } : c)));
  const remove = (id: string) => {
    setSel(null);
    onChange(connectors.filter((c) => c.id !== id));
  };

  // Clique numa âncora: 1º define a origem; 2º (noutro widget) cria o conector.
  const onAnchorClick = (widgetId: string, side: Side, anchor: Anchor) => {
    if (!pendingFrom || pendingFrom.widgetId === widgetId) {
      setPendingFrom({ widgetId, side, anchor });
      return;
    }
    onChange([
      ...connectors,
      {
        id: newConnectorId(),
        tab: activeTabId || undefined,
        from: { widgetId: pendingFrom.widgetId, side: pendingFrom.side },
        to: { widgetId, side },
        shape: "curva",
        arrowEnd: true,
      },
    ]);
    setPendingFrom(null);
    setCursor(null);
  };

  const selConn = sel ? connectors.find((c) => c.id === sel.id) : undefined;

  return (
    <>
      <svg
        ref={svgRef}
        className="absolute inset-0 h-full w-full"
        style={{ pointerEvents: "none" }}
        aria-hidden
      >
        <defs>
          {visible.map((c) => (
            <marker
              key={c.id}
              id={`conn-arrow-${c.id}`}
              orient="auto"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
            >
              <path d="M0 0 L8 4 L0 8 z" fill={c.color ?? DEFAULT_COLOR} />
            </marker>
          ))}
        </defs>
        {visible.map((c) => {
          const a = rectById.get(c.from.widgetId)!;
          const b = rectById.get(c.to.widgetId)!;
          const sides = resolveSides(a, b, c.from.side, c.to.side);
          const p1 = anchorPoint(a, sides.from);
          const p2 = anchorPoint(b, sides.to);
          const shape = c.shape ?? "curva";
          const d = connectorPath(p1, p2, shape);
          const mid = connectorMidpoint(p1, p2, shape);
          const color = c.color ?? DEFAULT_COLOR;
          const selected = sel?.id === c.id;
          return (
            <g key={c.id}>
              {/* Path invisível de clique (área generosa) — só em edição. */}
              <path
                d={d}
                data-conn-ui
                fill="none"
                stroke="transparent"
                strokeWidth={12}
                style={{
                  pointerEvents: editMode ? "stroke" : "none",
                  cursor: "pointer",
                }}
                onClick={(e) => setSel({ id: c.id, x: e.clientX, y: e.clientY })}
              />
              <path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={(c.width ?? 2) + (selected ? 1 : 0)}
                strokeDasharray={c.dash ? "6 6" : undefined}
                markerEnd={
                  c.arrowEnd !== false ? `url(#conn-arrow-${c.id})` : undefined
                }
                opacity={selected ? 1 : 0.9}
              />
              {c.label ? (
                <text
                  x={mid.x}
                  y={mid.y - 6}
                  textAnchor="middle"
                  className="text-xs"
                  fill={color}
                  stroke="var(--color-background)"
                  strokeWidth={3}
                  style={{ paintOrder: "stroke" }}
                >
                  {c.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {/* Linha elástica da criação (origem → cursor). */}
        {pendingFrom && cursor ? (
          <path
            d={`M ${pendingFrom.anchor.x} ${pendingFrom.anchor.y} L ${cursor.x} ${cursor.y}`}
            fill="none"
            stroke={DEFAULT_COLOR}
            strokeWidth={2}
            strokeDasharray="4 4"
          />
        ) : null}
      </svg>

      {/* Âncoras de criação: 4 pontos por widget, acima dos cards (z-30). */}
      {connectMode ? (
        <div className="absolute inset-0 z-30" style={{ pointerEvents: "none" }}>
          {widgets.map((w) => {
            const r = rectById.get(w.id);
            if (!r) return null;
            return SIDES.map((side) => {
              const a = anchorPoint(r, side);
              const active =
                pendingFrom?.widgetId === w.id && pendingFrom.side === side;
              return (
                <button
                  key={`${w.id}-${side}`}
                  type="button"
                  data-conn-ui
                  title={
                    pendingFrom && pendingFrom.widgetId !== w.id
                      ? "Concluir conexão aqui"
                      : "Iniciar conexão"
                  }
                  aria-label={`Âncora ${side} do widget`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAnchorClick(w.id, side, a);
                  }}
                  className={
                    "absolute size-3 rounded-full border-2 transition-transform hover:scale-125 " +
                    (active
                      ? "border-background bg-foreground"
                      : "border-background bg-primary")
                  }
                  style={{
                    left: a.x - 6,
                    top: a.y - 6,
                    pointerEvents: "auto",
                  }}
                />
              );
            });
          })}
        </div>
      ) : null}

      {/* Painel de edição do conector selecionado. */}
      {editMode && sel && selConn ? (
        <div data-conn-ui>
          <FloatingPanel x={sel.x} y={sel.y} onClose={() => setSel(null)} className="w-60">
            <div className="flex flex-col gap-2 p-1">
              <div className="flex items-center gap-2">
                <Label className="w-16 text-xs">Forma</Label>
                <div className="flex gap-1">
                  {(["reta", "curva"] as const).map((s) => (
                    <Button
                      key={s}
                      type="button"
                      size="sm"
                      variant={(selConn.shape ?? "curva") === s ? "default" : "outline"}
                      className="h-7 px-2 text-xs"
                      onClick={() => patch(selConn.id, { shape: s })}
                    >
                      {s === "reta" ? "Reta" : "Curva"}
                    </Button>
                  ))}
                </div>
              </div>
              <ColorField
                label="Cor"
                value={selConn.color}
                onChange={(v) => patch(selConn.id, { color: v })}
                onClear={() => patch(selConn.id, { color: undefined })}
              />
              <div className="flex items-center gap-2">
                <Label className="w-16 text-xs">Espessura</Label>
                <Input
                  type="number"
                  min={1}
                  max={8}
                  value={selConn.width ?? 2}
                  onChange={(e) =>
                    patch(selConn.id, {
                      width: Math.min(8, Math.max(1, Number(e.target.value) || 2)),
                    })
                  }
                  className="h-7 w-16 text-xs"
                />
              </div>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={selConn.dash ?? false}
                  onCheckedChange={(v) => patch(selConn.id, { dash: v === true })}
                />
                Tracejada
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={selConn.arrowEnd !== false}
                  onCheckedChange={(v) =>
                    patch(selConn.id, { arrowEnd: v === true })
                  }
                />
                Seta no destino
              </label>
              <div className="flex items-center gap-2">
                <Label className="w-16 text-xs">Rótulo</Label>
                <Input
                  value={selConn.label ?? ""}
                  placeholder="—"
                  onChange={(e) =>
                    patch(selConn.id, { label: e.target.value || undefined })
                  }
                  className="h-7 text-xs"
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive h-7 justify-start text-xs"
                onClick={() => remove(selConn.id)}
              >
                <Trash2 className="size-3.5" /> Excluir conexão
              </Button>
            </div>
          </FloatingPanel>
        </div>
      ) : null}
    </>
  );
}
