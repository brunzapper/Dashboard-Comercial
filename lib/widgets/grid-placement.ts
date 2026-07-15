// Versão: 1.0 | Data: 15/07/2026
// Posicionamento no grid: helpers compartilhados entre o grid (dashboard-grid),
// o shell (dashboard-client, estado otimista de layout) e o construtor de
// widgets (posição inicial de um widget novo).

import type { GridPosition, Widget } from "@/lib/widgets/types";

// Posição base persistida de um widget, com fallback determinístico pela ordem
// (grid_position vazio = '{}' do default do banco). Mesma lógica desde sempre
// no dashboard-grid; movida para cá para reutilização.
export function posOf(w: Widget, i: number): GridPosition {
  const p = w.grid_position as GridPosition;
  if (p && typeof p.w === "number") return p;
  return { x: (i % 2) * 6, y: Math.floor(i / 2) * 8, w: 6, h: 8 };
}

// Sobreposição de dois retângulos do grid (bordas estritas: encostar não colide).
function overlaps(a: GridPosition, b: GridPosition): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Primeiro espaço livre w×h varrendo de cima para baixo, esquerda para direita,
// entre as posições ocupadas (só os widgets da MESMA aba importam — abas são
// telas independentes). Sem vaga dentro da área ocupada, cai logo abaixo do
// widget mais fundo ({ x: 0, y: maxBottom }). Grid vazio → topo.
export function findFreePosition(
  occupied: readonly GridPosition[],
  cols: number,
  w: number,
  h: number
): GridPosition {
  const width = Math.min(w, Math.max(1, cols));
  const maxBottom = occupied.reduce((m, p) => Math.max(m, p.y + p.h), 0);
  for (let y = 0; y <= maxBottom; y++) {
    for (let x = 0; x + width <= cols; x++) {
      const cand = { x, y, w: width, h };
      if (!occupied.some((p) => overlaps(cand, p))) return cand;
    }
  }
  return { x: 0, y: maxBottom, w: width, h };
}
