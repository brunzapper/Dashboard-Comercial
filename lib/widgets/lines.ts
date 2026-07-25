// Versão: 1.0 | Data: 25/07/2026
// Geometria da forma "Linha" (ShapeKind "linha"): um widget de Forma cujo
// traçado vive em settings.shape.line como extremidades em unidades de grid
// FRACIONÁRIAS (coordenadas do canvas — floats), sempre horizontal ou vertical.
// A linha é renderizada/manipulada FORA do react-grid-layout (line-layer.tsx),
// então o movimento não se prende às colunas; o grid_position permanece como o
// bounding box inteiro derivado (lineGridBBox) para paste/import/ocupação
// continuarem funcionando. Conversão para px pela MESMA fórmula contínua dos
// conectores (lib/widgets/connectors.ts: itemRect) — responsividade horizontal
// preservada (cellW varia com a viewport). Puro (sem IO/DOM).
import type { GridMetrics } from "./connectors";
import type { GridPosition, ShapeLine, Widget } from "./types";

/** O widget é uma Forma do tipo "linha"? */
export function isLineShapeWidget(
  w: Pick<Widget, "visual_type" | "settings">
): boolean {
  return w.visual_type === "forma" && w.settings?.shape?.kind === "linha";
}

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * Linha média de um retângulo do grid: horizontal quando ele é mais largo que
 * alto (senão vertical). É o traçado de uma linha recém-criada (sem
 * settings.shape.line) — derivação preguiçosa, nunca gravada no create.
 */
export function lineFromRect(p: GridPosition): ShapeLine {
  if (p.w >= p.h) {
    const y = p.y + p.h / 2;
    return { x1: p.x, y1: y, x2: p.x + p.w, y2: y };
  }
  const x = p.x + p.w / 2;
  return { x1: x, y1: p.y, x2: x, y2: p.y + p.h };
}

/** Traçado efetivo: o persistido quando íntegro; senão a linha média do rect. */
export function lineOf(
  w: Pick<Widget, "settings">,
  pos: GridPosition
): ShapeLine {
  const l = w.settings?.shape?.line;
  if (l && finite(l.x1) && finite(l.y1) && finite(l.x2) && finite(l.y2)) {
    return l;
  }
  return lineFromRect(pos);
}

/**
 * Bounding box INTEIRO do traçado (floor/ceil, mínimo 1×1, preso a ≥ 0) — é o
 * grid_position gravado junto da linha, para ocupação/paste/import/extensão do
 * canvas seguirem enxergando um retângulo válido.
 */
export function lineGridBBox(line: ShapeLine): GridPosition {
  const x = Math.max(0, Math.floor(Math.min(line.x1, line.x2)));
  const y = Math.max(0, Math.floor(Math.min(line.y1, line.y2)));
  return {
    x,
    y,
    w: Math.max(1, Math.ceil(Math.max(line.x1, line.x2)) - x),
    h: Math.max(1, Math.ceil(Math.max(line.y1, line.y2)) - y),
  };
}

export function translateLine(
  line: ShapeLine,
  dx: number,
  dy: number
): ShapeLine {
  return {
    x1: line.x1 + dx,
    y1: line.y1 + dy,
    x2: line.x2 + dx,
    y2: line.y2 + dy,
  };
}

/**
 * Traçado transladado para que o canto mínimo aterrisse na célula (gx, gy) —
 * usado no "Colar widget" (a cópia preserva o desenho, só muda de lugar).
 */
export function lineAtCell(
  line: ShapeLine,
  gx: number,
  gy: number
): ShapeLine {
  return translateLine(
    line,
    gx - Math.min(line.x1, line.x2),
    gy - Math.min(line.y1, line.y2)
  );
}

/**
 * Ponto do grid (fracionário) → px do canvas. Mesma fórmula do itemRect dos
 * conectores no canto do item: left = (cellW+mx)*x + mx (idem vertical).
 */
export function gridPtToPx(
  pt: { x: number; y: number },
  m: GridMetrics
): { x: number; y: number } {
  return {
    x: (m.cellW + m.mx) * pt.x + m.mx,
    y: (m.rowH + m.my) * pt.y + m.my,
  };
}

/** Delta em px → delta em unidades de grid (sem o offset da margem). */
export function pxDeltaToGrid(
  dx: number,
  dy: number,
  m: GridMetrics
): { dx: number; dy: number } {
  const ux = m.cellW + m.mx;
  const uy = m.rowH + m.my;
  return { dx: ux > 0 ? dx / ux : 0, dy: uy > 0 ? dy / uy : 0 };
}

/**
 * Projeta o traçado ao eixo dominante: |Δx| ≥ |Δy| vira horizontal exata (y =
 * ponto médio), senão vertical. A linha é SEMPRE H ou V (decisão de produto);
 * arrastar uma ponta troca o eixo quando o gesto vertical passa a dominar.
 */
export function axisLock(line: ShapeLine): ShapeLine {
  if (Math.abs(line.x2 - line.x1) >= Math.abs(line.y2 - line.y1)) {
    const y = (line.y1 + line.y2) / 2;
    return { x1: line.x1, y1: y, x2: line.x2, y2: y };
  }
  const x = (line.x1 + line.x2) / 2;
  return { x1: x, y1: line.y1, x2: x, y2: line.y2 };
}

// Translada o intervalo [min,max] para dentro de [0,limit]; maior que o limite
// encosta em 0 (o clamp por ponto abaixo encurta o excedente).
function fitAxis(a: number, b: number, limit: number): number {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  if (min < 0) return -min;
  if (max > limit) return Math.max(-min, limit - max);
  return 0;
}

/**
 * Prende o traçado ao canvas [0..cols]×[0..maxRows] SEM encurtar (translada de
 * volta o que passou da borda); só encurta se a linha for maior que o canvas.
 */
export function clampLine(
  line: ShapeLine,
  cols: number,
  maxRows: number
): ShapeLine {
  const moved = translateLine(
    line,
    fitAxis(line.x1, line.x2, cols),
    fitAxis(line.y1, line.y2, maxRows)
  );
  const cx = (v: number) => Math.min(cols, Math.max(0, v));
  const cy = (v: number) => Math.min(maxRows, Math.max(0, v));
  return { x1: cx(moved.x1), y1: cy(moved.y1), x2: cx(moved.x2), y2: cy(moved.y2) };
}

/**
 * Arredonda as coordenadas (2 casas por padrão) — gravação determinística: o
 * valor otimista e o persistido ficam byte-iguais (o reseed vira no-op) e o
 * histórico de undo (comparado por JSON.stringify) não ganha entradas de ruído
 * de float.
 */
export function roundLine(line: ShapeLine, decimals = 2): ShapeLine {
  const f = 10 ** decimals;
  const r = (v: number) => Math.round(v * f) / f;
  return { x1: r(line.x1), y1: r(line.y1), x2: r(line.x2), y2: r(line.y2) };
}
