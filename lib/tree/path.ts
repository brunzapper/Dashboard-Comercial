// Versão: 1.1 | Data: 01/10/2026
// v1.1 (01/10/2026): `insertNode` — o rascunho da branch nova entra no layout.
// Versão: 1.0 | Data: 30/09/2026
// v1.0 (30/09/2026): a LEITURA DO CAMINHO na Root — o que torna a árvore um
//   planejamento, e não só um desenho.
//
// A convenção: um galho DEPENDE dos filhos. O Resultado esperado fica no alto,
// o que precisa acontecer antes dele pendura embaixo, e as folhas são os
// primeiros passos. Então:
//  - o PROGRESSO de um galho são os itens checáveis ABAIXO dele (tarefas e
//    anotações-etapa) — o que falta para ele se cumprir;
//  - o CAMINHO de um nó é a subida até o Resultado mais próximo (ou até a
//    raiz): "isto serve a quê";
//  - os DESCENDENTES são "do que isto depende".
//
// Puro e client-safe.
import type { TreeNode } from "./model";

/** Um item conta no progresso quando tem estado de conclusão. */
export function isCheckable(node: TreeNode): boolean {
  return node.status === "aberta" || node.status === "concluída";
}

export function isDone(node: TreeNode): boolean {
  return node.status === "concluída";
}

export interface TreeProgress {
  done: number;
  total: number;
}

/** Checáveis ABAIXO do nó (ele mesmo não conta: é o que eles sustentam). */
export function progressOf(node: TreeNode): TreeProgress {
  let done = 0;
  let total = 0;
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      if (isCheckable(n)) {
        total += 1;
        if (isDone(n)) done += 1;
      }
      walk(n.children);
    }
  };
  walk(node.children);
  return { done, total };
}

/** Índice pai-de-cada-nó da árvore inteira. */
export function parentIndex(roots: TreeNode[]): Map<string, TreeNode | null> {
  const out = new Map<string, TreeNode | null>();
  const walk = (list: TreeNode[], parent: TreeNode | null) => {
    for (const n of list) {
      out.set(n.id, parent);
      walk(n.children, n);
    }
  };
  walk(roots, null);
  return out;
}

/**
 * Ids do caminho do nó até o Resultado mais próximo acima dele (incluso), ou
 * até a raiz quando não há Resultado no caminho. O próprio nó abre a lista.
 */
export function pathToGoal(roots: TreeNode[], id: string): string[] {
  const parents = parentIndex(roots);
  if (!parents.has(id)) return [];
  const path = [id];
  let cur = parents.get(id) ?? null;
  while (cur) {
    path.push(cur.id);
    if (cur.goal) break;
    cur = parents.get(cur.id) ?? null;
  }
  return path;
}

/** O nó pelo id (busca em profundidade). */
export function findNode(roots: TreeNode[], id: string): TreeNode | null {
  for (const n of roots) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

/** Todos os ids abaixo do nó — "do que isto depende". */
export function descendantIds(node: TreeNode): string[] {
  const out: string[] = [];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      out.push(n.id);
      walk(n.children);
    }
  };
  walk(node.children);
  return out;
}

/**
 * Quantos checáveis ainda ABERTOS há abaixo do nó — o "faltam N" do cartão
 * selecionado.
 */
export function remainingOf(node: TreeNode): number {
  const p = progressOf(node);
  return p.total - p.done;
}

/**
 * A árvore com o galho `id` pendurado em `parentId` (null = raiz) — o otimista
 * do arrasto, antes de o servidor responder. Pura: devolve uma cópia. Pai que
 * não existe, ou que é descendente do próprio galho (ciclo), devolve a árvore
 * como estava.
 */
export function moveSubtree(
  roots: TreeNode[],
  id: string,
  parentId: string | null
): TreeNode[] {
  const clone = (list: TreeNode[]): TreeNode[] =>
    list.map((n) => ({ ...n, children: clone(n.children) }));
  const next = clone(roots);
  const moving = findNode(next, id);
  if (!moving || id === parentId) return roots;
  if (parentId && (parentId === id || descendantIds(moving).includes(parentId))) {
    return roots;
  }
  const target = parentId ? findNode(next, parentId) : null;
  if (parentId && !target) return roots;

  const detach = (list: TreeNode[]): TreeNode[] =>
    list
      .filter((n) => n.id !== id)
      .map((n) => ({ ...n, children: detach(n.children) }));
  const pruned = detach(next);
  // Profundidade recalculada pela POSIÇÃO — nunca confiada ao que veio.
  const fixDepth = (n: TreeNode, depth: number): TreeNode => ({
    ...n,
    depth,
    children: n.children.map((c) => fixDepth(c, depth + 1)),
  });
  if (!parentId) return [...pruned, moving].map((r) => fixDepth(r, 0));
  const host = findNode(pruned, parentId)!;
  host.children = [...host.children, moving];
  return pruned.map((r) => fixDepth(r, 0));
}

/**
 * v1.1 (01/10/2026): a árvore com `node` pendurado em `parentId` (null = mais
 * uma raiz, no fim). É o RASCUNHO da Root: a prévia da branch nova entra no
 * layout como um nó de verdade, e por isso aparece exatamente onde vai ficar.
 * Pai inexistente = raiz. Pura: devolve uma cópia.
 */
export function insertNode(
  roots: TreeNode[],
  parentId: string | null,
  node: TreeNode
): TreeNode[] {
  if (!parentId || !findNode(roots, parentId)) {
    return [...roots, { ...node, depth: 0 }];
  }
  const walk = (list: TreeNode[], depth: number): TreeNode[] =>
    list.map((n) =>
      n.id === parentId
        ? {
            ...n,
            children: [...n.children, { ...node, depth: depth + 1, children: [] }],
          }
        : { ...n, children: walk(n.children, depth + 1) }
    );
  return walk(roots, 0);
}
