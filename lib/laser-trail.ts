// Versão: 1.0 | Data: 03/08/2026
// Helpers PUROS do rastro do Ponteiro Laser (modo apresentação do dashboard).
// O overlay (components/dashboards/laser-pointer-overlay.tsx) guarda os traços
// em ref e chama estes helpers no loop de rAF — nada aqui toca DOM/estado.
// Traços são independentes (um por pressionada do botão) e esmaecem por idade.

/** Vida de um ponto do rastro (ms): depois disso ele some por completo. */
export const TRAIL_TTL_MS = 2500;
/** Pausa que desativa o modo (cursor parado sobre espaço vazio). */
export const DWELL_MS = 2000;
/** Deslocamento (px) que conta como "mexeu" e re-arma o timer de pausa. */
export const DWELL_MOVE_PX = 6;

export interface TrailPoint {
  x: number;
  y: number;
  /** performance.now() da captura. */
  t: number;
}

export interface TrailStroke {
  points: TrailPoint[];
}

/**
 * Remove pontos mais velhos que `ttl` e traços que ficaram vazios. Retorna a
 * MESMA referência quando nada mudou (o overlay usa isso para pular render).
 */
export function pruneStrokes(
  strokes: TrailStroke[],
  now: number,
  ttl = TRAIL_TTL_MS
): TrailStroke[] {
  let changed = false;
  const out: TrailStroke[] = [];
  for (const s of strokes) {
    const points = s.points.filter((p) => now - p.t < ttl);
    if (points.length !== s.points.length) changed = true;
    if (points.length > 0) {
      out.push(points.length === s.points.length ? s : { points });
    }
  }
  return changed ? out : strokes;
}

/** Opacidade 1→0 pela idade (ease-out), clampada em [0, 1]. */
export function trailOpacity(ageMs: number, ttl = TRAIL_TTL_MS): number {
  if (ageMs <= 0) return 1;
  if (ageMs >= ttl) return 0;
  return Math.pow(1 - ageMs / ttl, 1.5);
}

/**
 * Acrescenta um ponto ao ÚLTIMO traço, ignorando jitter (< `minDist` px do
 * ponto anterior). Sem traço aberto (pointerdown perdido), abre um. Muta o
 * array recebido — os traços vivem em ref, fora do estado React.
 */
export function appendPoint(
  strokes: TrailStroke[],
  p: TrailPoint,
  minDist = 2
): TrailStroke[] {
  const last = strokes[strokes.length - 1];
  if (!last) return beginStroke(strokes, p);
  const prev = last.points[last.points.length - 1];
  if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < minDist) return strokes;
  last.points.push(p);
  return strokes;
}

/**
 * Abre um traço NOVO (pointerdown) — nunca conecta ao anterior: soltar e
 * pressionar de novo são desenhos separados.
 */
export function beginStroke(
  strokes: TrailStroke[],
  p: TrailPoint
): TrailStroke[] {
  strokes.push({ points: [p] });
  return strokes;
}
