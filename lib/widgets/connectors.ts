// Versão: 1.0 | Data: 15/07/2026
// Geometria dos conectores (linhas entre widgets, estilo n8n/Make). Converte
// posições do grid (unidades RGL {x,y,w,h}) em px usando as MESMAS fórmulas do
// react-grid-layout com margin = containerPadding = [mx,my] (ver
// components/dashboards/dashboard-grid.tsx: cellW na linha ~409, MX/MY/ROW_H).
// Puro (sem IO/DOM): usado pela camada SVG (connector-layer.tsx).
import type { Connector, ConnectorSide } from "./types";

export interface GridMetrics {
  cellW: number;
  rowH: number;
  mx: number;
  my: number;
}

export interface PxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type Side = "top" | "right" | "bottom" | "left";

// Ponto de ancoragem: posição + normal para fora (direção dos controles da
// curva e da folga da seta).
export interface Anchor {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/** Retângulo em px de um item do grid (fórmula do RGL). */
export function itemRect(
  l: { x: number; y: number; w: number; h: number },
  m: GridMetrics
): PxRect {
  return {
    left: Math.round((m.cellW + m.mx) * l.x + m.mx),
    top: Math.round((m.rowH + m.my) * l.y + m.my),
    width: Math.round(m.cellW * l.w + Math.max(0, l.w - 1) * m.mx),
    height: Math.round(m.rowH * l.h + Math.max(0, l.h - 1) * m.my),
  };
}

const NORMALS: Record<Side, [number, number]> = {
  top: [0, -1],
  right: [1, 0],
  bottom: [0, 1],
  left: [-1, 0],
};

/** Centro de um lado do retângulo + normal para fora. */
export function anchorPoint(r: PxRect, side: Side): Anchor {
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const [nx, ny] = NORMALS[side];
  switch (side) {
    case "top":
      return { x: cx, y: r.top, nx, ny };
    case "bottom":
      return { x: cx, y: r.top + r.height, nx, ny };
    case "left":
      return { x: r.left, y: cy, nx, ny };
    case "right":
      return { x: r.left + r.width, y: cy, nx, ny };
  }
}

/**
 * Resolve os lados efetivos das pontas: explícito quando configurado; "auto"
 * compara os centros (|dx| >= |dy| → esquerda/direita; senão cima/baixo).
 */
export function resolveSides(
  a: PxRect,
  b: PxRect,
  from?: ConnectorSide,
  to?: ConnectorSide
): { from: Side; to: Side } {
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const autoFrom: Side = horizontal
    ? dx >= 0
      ? "right"
      : "left"
    : dy >= 0
      ? "bottom"
      : "top";
  const autoTo: Side = horizontal
    ? dx >= 0
      ? "left"
      : "right"
    : dy >= 0
      ? "top"
      : "bottom";
  return {
    from: !from || from === "auto" ? autoFrom : from,
    to: !to || to === "auto" ? autoTo : to,
  };
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * Path SVG entre duas âncoras: "reta" = segmento; "curva" = cúbica estilo n8n
 * com controles ao longo das normais (comprimento proporcional à distância).
 */
export function connectorPath(
  p1: Anchor,
  p2: Anchor,
  shape: "reta" | "curva"
): string {
  if (shape === "reta") return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
  const k = clamp(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2, 40, 160);
  const c1x = p1.x + p1.nx * k;
  const c1y = p1.y + p1.ny * k;
  const c2x = p2.x + p2.nx * k;
  const c2y = p2.y + p2.ny * k;
  return `M ${p1.x} ${p1.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
}

/** Ponto médio aproximado do conector (posição do rótulo). */
export function connectorMidpoint(
  p1: Anchor,
  p2: Anchor,
  shape: "reta" | "curva"
): { x: number; y: number } {
  if (shape === "reta") {
    return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  }
  // Bézier cúbica em t=0.5 com os mesmos controles de connectorPath.
  const k = clamp(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2, 40, 160);
  const c1x = p1.x + p1.nx * k;
  const c1y = p1.y + p1.ny * k;
  const c2x = p2.x + p2.nx * k;
  const c2y = p2.y + p2.ny * k;
  return {
    x: (p1.x + 3 * c1x + 3 * c2x + p2.x) / 8,
    y: (p1.y + 3 * c1y + 3 * c2y + p2.y) / 8,
  };
}

/**
 * Aba efetiva de um conector: a configurada, se ainda existir; senão a
 * primeira (mesmo fallback de widgetTab em dashboard-client/page).
 */
export function connectorTab(
  c: Connector,
  tabIds: Set<string>,
  firstTabId: string
): string {
  const t = c.tab;
  return t && tabIds.has(t) ? t : firstTabId;
}
