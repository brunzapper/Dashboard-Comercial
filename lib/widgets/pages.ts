// Versão: 1.0 | Data: 25/07/2026
// PÁGINAS de widget (mescla): dois ou mais widgets dividindo o MESMO espaço do
// grid, alternados por setinhas acima do card. O vínculo vive em
// `settings.pages` do widget HOSPEDEIRO (ids dos membros; host = página 1);
// membros são linhas normais de `widgets` ocultadas da renderização
// (dashboard-grid filtra por collectPageMembers). Este módulo é PURO (sem
// IO/DOM): predicados de elegibilidade + a detecção de "soltou quase em cima"
// que dispara o diálogo "Adicionar página?" no drop (findMergeTarget).
// Unidades: espaço FINO do grid (base 120 — lib/widgets/grid-space).

import type { GridPosition, VisualType, Widget } from "./types";
import { isLineShapeWidget } from "./lines";

// Tipos que não podem virar página (nem hospedar): filtros agem sobre o board
// inteiro (escondê-los atrás de uma página os "desligaria" visualmente sem
// desligar o efeito), forma/imagem/linha são decorativos. Mesmo recorte do
// `targetable` do builder (widget-builder.tsx).
export const PAGE_INELIGIBLE: ReadonlySet<VisualType> = new Set([
  "filtro",
  "filtro_campo",
  "forma",
  "imagem",
  "linha_divisoria",
]);

// Tolerâncias da detecção no drop (unidades finas): sobreposição mínima da
// área do MENOR retângulo + folga de tamanho relativa (25%) com piso absoluto
// (~60×~40px @1200 — tamanhos "aproximados" contam, idênticos não é exigido).
export const MERGE_MIN_OVERLAP = 0.65;
export const MERGE_SIZE_TOL = 0.25;
export const MERGE_SLACK_W = 6;
export const MERGE_SLACK_H = 4;

/** Ids dos widgets-membro deste widget (vazio quando não é host). */
export function pageMembersOf(
  w: Pick<Widget, "settings"> | null | undefined
): string[] {
  const pages = w?.settings?.pages;
  return Array.isArray(pages) ? pages.filter((id) => typeof id === "string" && id) : [];
}

export function isPageHost(w: Pick<Widget, "settings">): boolean {
  return pageMembersOf(w).length > 0;
}

/** Conjunto de TODOS os ids de membro do dashboard (para ocultar do grid). */
export function collectPageMembers(
  widgets: readonly Pick<Widget, "settings">[]
): Set<string> {
  const out = new Set<string>();
  for (const w of widgets) for (const id of pageMembersOf(w)) out.add(id);
  return out;
}

/** O widget pode participar de uma mescla (como host OU membro)? */
export function canBePage(
  w: Pick<Widget, "visual_type" | "settings">
): boolean {
  return !PAGE_INELIGIBLE.has(w.visual_type) && !isLineShapeWidget(w);
}

function overlapArea(a: GridPosition, b: GridPosition): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export interface MergeCandidate {
  widget: Pick<Widget, "id" | "visual_type" | "settings">;
  pos: GridPosition;
}

/**
 * Alvo de mescla de um DROP: o widget sob o retângulo solto quando os dois têm
 * tamanho aproximado e a sobreposição é grande. Devolve o id do melhor alvo
 * (maior sobreposição) ou null. O arrastado precisa ser elegível e NÃO pode já
 * ser host (mesclar um host dissolveria as páginas dele em silêncio — o menu ⋮
 * cobre composições); o alvo pode já ser host (vira "adicionar página").
 * Membros nunca aparecem aqui: ocultos, não são arrastáveis nem candidatos.
 */
export function findMergeTarget(
  dropped: GridPosition,
  dragged: Pick<Widget, "id" | "visual_type" | "settings">,
  candidates: readonly MergeCandidate[]
): string | null {
  if (!canBePage(dragged) || isPageHost(dragged)) return null;
  let bestId: string | null = null;
  let bestOverlap = 0;
  for (const c of candidates) {
    if (c.widget.id === dragged.id) continue;
    if (!canBePage(c.widget)) continue;
    const dw = Math.abs(c.pos.w - dropped.w);
    const dh = Math.abs(c.pos.h - dropped.h);
    const tolW = Math.max(MERGE_SLACK_W, MERGE_SIZE_TOL * Math.max(c.pos.w, dropped.w));
    const tolH = Math.max(MERGE_SLACK_H, MERGE_SIZE_TOL * Math.max(c.pos.h, dropped.h));
    if (dw > tolW || dh > tolH) continue;
    const minArea = Math.min(c.pos.w * c.pos.h, dropped.w * dropped.h);
    if (minArea <= 0) continue;
    const frac = overlapArea(c.pos, dropped) / minArea;
    if (frac < MERGE_MIN_OVERLAP) continue;
    if (frac > bestOverlap) {
      bestOverlap = frac;
      bestId = c.widget.id;
    }
  }
  return bestId;
}
