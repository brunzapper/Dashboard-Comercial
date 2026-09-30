// Versão: 1.0 | Data: 30/09/2026
// v1.0 (30/09/2026): o LAYOUT da visualização Root — onde cada nó fica no
//   canvas. Puro, sem React e sem medir o DOM: o cartão da Root tem tamanho
//   FIXO, e é isso que deixa o desenho determinístico (a mesma árvore sai no
//   mesmo lugar em qualquer tela, e o teste consegue pinar sobreposição).
//
// Como funciona:
//  - cada galho tem uma DIREÇÃO: `h` (os filhos empilham à direita do pai) ou
//    `v` (os filhos enfileiram abaixo). A direção é POR GALHO, então as duas se
//    misturam — uma rotina desce, uma de suas etapas se abre para o lado.
//  - a posição é calculada por CAIXA DE SUBÁRVORE: primeiro o tamanho que cada
//    galho ocupa, depois o lugar dele dentro da caixa do pai. O pai fica
//    centrado sobre o bloco dos filhos.
//  - o OFFSET gravado (o arrasto para o vazio) é relativo ao slot e se SOMA ao
//    dos ancestrais: arrastar um galho leva os subgalhos junto, e desfazer é
//    apagar a linha — o nó volta ao slot.
//  - galho COLAPSADO não ocupa espaço com os filhos; a caixa diz quantos estão
//    escondidos, para o cartão mostrar "+N".
import type { TreeDirection, TreeNode } from "./model";

export const ROOT_NODE_WIDTH = 224;
export const ROOT_NODE_HEIGHT = 92;
/** Distância entre o pai e o bloco dos filhos (eixo em que o galho cresce). */
export const ROOT_GAP_MAIN = 56;
/** Distância entre irmãos (eixo transversal). */
export const ROOT_GAP_CROSS = 16;
/** Distância entre árvores-raiz. */
export const ROOT_GAP_ROOTS = 40;

export interface RootLayoutOptions {
  /** Direção de quem não escolheu uma (o padrão do widget). */
  defaultDirection: TreeDirection;
  /** A direção gravada do nó; null/undefined = o padrão. */
  directionOf?: (id: string) => TreeDirection | null | undefined;
  /** Galhos recolhidos (preferência de quem olha). */
  collapsed?: ReadonlySet<string>;
  /** Offset gravado por nó (relativo ao slot). */
  offsetOf?: (id: string) => { x: number; y: number } | null | undefined;
}

export interface RootBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  parentId: string | null;
  /** Direção em que ESTE galho abre os filhos. */
  direction: TreeDirection;
  /** Descendentes escondidos pelo colapso (0 = aberto ou folha). */
  hiddenCount: number;
  /** Tem filhos (abertos ou não). */
  hasChildren: boolean;
}

export interface RootEdge {
  from: string;
  to: string;
  /** A direção do PAI decide as âncoras do conector. */
  direction: TreeDirection;
}

export interface RootLayout {
  boxes: RootBox[];
  edges: RootEdge[];
  /** Retângulo que contém todos os nós (0 × 0 sem nós). */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

function countDescendants(node: TreeNode): number {
  return node.children.reduce((acc, c) => acc + 1 + countDescendants(c), 0);
}

interface Measured {
  node: TreeNode;
  w: number;
  h: number;
  direction: TreeDirection;
  open: boolean;
  children: Measured[];
}

export function layoutRoot(
  roots: TreeNode[],
  opts: RootLayoutOptions
): RootLayout {
  const collapsed = opts.collapsed ?? new Set<string>();
  const dirOf = (id: string): TreeDirection =>
    opts.directionOf?.(id) ?? opts.defaultDirection;

  const measure = (node: TreeNode): Measured => {
    const direction = dirOf(node.id);
    const open = node.children.length > 0 && !collapsed.has(node.id);
    const children = open ? node.children.map(measure) : [];
    if (children.length === 0) {
      return {
        node,
        w: ROOT_NODE_WIDTH,
        h: ROOT_NODE_HEIGHT,
        direction,
        open,
        children,
      };
    }
    const gaps = ROOT_GAP_CROSS * (children.length - 1);
    if (direction === "h") {
      const block = children.reduce((a, c) => a + c.h, 0) + gaps;
      const wide = Math.max(...children.map((c) => c.w));
      return {
        node,
        w: ROOT_NODE_WIDTH + ROOT_GAP_MAIN + wide,
        h: Math.max(ROOT_NODE_HEIGHT, block),
        direction,
        open,
        children,
      };
    }
    const block = children.reduce((a, c) => a + c.w, 0) + gaps;
    const tall = Math.max(...children.map((c) => c.h));
    return {
      node,
      w: Math.max(ROOT_NODE_WIDTH, block),
      h: ROOT_NODE_HEIGHT + ROOT_GAP_MAIN + tall,
      direction,
      open,
      children,
    };
  };

  const boxes: RootBox[] = [];
  const edges: RootEdge[] = [];

  const place = (
    m: Measured,
    x: number,
    y: number,
    depth: number,
    parentId: string | null,
    acc: { x: number; y: number }
  ) => {
    const own = opts.offsetOf?.(m.node.id) ?? null;
    const shift = { x: acc.x + (own?.x ?? 0), y: acc.y + (own?.y ?? 0) };
    const slotX = m.direction === "h" ? x : x + (m.w - ROOT_NODE_WIDTH) / 2;
    const slotY = m.direction === "h" ? y + (m.h - ROOT_NODE_HEIGHT) / 2 : y;
    boxes.push({
      id: m.node.id,
      x: slotX + shift.x,
      y: slotY + shift.y,
      w: ROOT_NODE_WIDTH,
      h: ROOT_NODE_HEIGHT,
      depth,
      parentId,
      direction: m.direction,
      hiddenCount: m.open ? 0 : countDescendants(m.node),
      hasChildren: m.node.children.length > 0,
    });
    if (m.children.length === 0) return;
    const gaps = ROOT_GAP_CROSS * (m.children.length - 1);
    if (m.direction === "h") {
      const block = m.children.reduce((a, c) => a + c.h, 0) + gaps;
      let cy = y + (m.h - block) / 2;
      const cx = x + ROOT_NODE_WIDTH + ROOT_GAP_MAIN;
      for (const c of m.children) {
        edges.push({ from: m.node.id, to: c.node.id, direction: "h" });
        place(c, cx, cy, depth + 1, m.node.id, shift);
        cy += c.h + ROOT_GAP_CROSS;
      }
      return;
    }
    const block = m.children.reduce((a, c) => a + c.w, 0) + gaps;
    let cx = x + (m.w - block) / 2;
    const cy = y + ROOT_NODE_HEIGHT + ROOT_GAP_MAIN;
    for (const c of m.children) {
      edges.push({ from: m.node.id, to: c.node.id, direction: "v" });
      place(c, cx, cy, depth + 1, m.node.id, shift);
      cx += c.w + ROOT_GAP_CROSS;
    }
  };

  // As árvores-raiz se enfileiram no eixo TRANSVERSAL ao padrão: com galhos
  // para o lado, uma embaixo da outra; com galhos para baixo, lado a lado.
  let cursor = 0;
  for (const root of roots) {
    const m = measure(root);
    if (opts.defaultDirection === "h") {
      place(m, 0, cursor, 0, null, { x: 0, y: 0 });
      cursor += m.h + ROOT_GAP_ROOTS;
    } else {
      place(m, cursor, 0, 0, null, { x: 0, y: 0 });
      cursor += m.w + ROOT_GAP_ROOTS;
    }
  }

  if (boxes.length === 0) {
    return { boxes, edges, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  }
  const bounds = {
    minX: Math.min(...boxes.map((b) => b.x)),
    minY: Math.min(...boxes.map((b) => b.y)),
    maxX: Math.max(...boxes.map((b) => b.x + b.w)),
    maxY: Math.max(...boxes.map((b) => b.y + b.h)),
  };
  return { boxes, edges, bounds };
}

/**
 * Os pontos do conector de um galho: da borda do pai à borda do filho, no eixo
 * em que o galho cresce. Devolve um `d` de SVG com curva suave.
 */
export function edgePath(
  from: { x: number; y: number; w: number; h: number },
  to: { x: number; y: number; w: number; h: number },
  direction: TreeDirection
): string {
  if (direction === "h") {
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    const x2 = to.x;
    const y2 = to.y + to.h / 2;
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  }
  const x1 = from.x + from.w / 2;
  const y1 = from.y + from.h;
  const x2 = to.x + to.w / 2;
  const y2 = to.y;
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
}

/**
 * O nó sob um ponto do canvas (alvo de um "soltar sobre"), ignorando os ids
 * dados — o próprio galho arrastado nunca é alvo de si mesmo.
 */
export function hitTest(
  boxes: readonly RootBox[],
  point: { x: number; y: number },
  ignore: ReadonlySet<string>
): RootBox | null {
  // O último desenhado fica por cima: procura de trás para frente.
  for (let i = boxes.length - 1; i >= 0; i -= 1) {
    const b = boxes[i];
    if (ignore.has(b.id)) continue;
    if (
      point.x >= b.x &&
      point.x <= b.x + b.w &&
      point.y >= b.y &&
      point.y <= b.y + b.h
    ) {
      return b;
    }
  }
  return null;
}
