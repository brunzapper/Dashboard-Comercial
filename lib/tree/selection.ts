// Versão: 1.0 | Data: 10/09/2026
// SELEÇÃO NA ÁRVORE — puro, para ser testado sem React.
//
// A decisão do usuário: marcar um nó-pai marca o galho POR PADRÃO, mas cada
// filho continua desmarcável e marcável sozinho. Isso é o tri-estado clássico
// de árvore, e ele só funciona se a fonte da verdade for o conjunto de FOLHAS
// selecionadas — nunca "o pai está marcado". Guardar o pai daria um estado
// impossível de desfazer: desmarcar um filho de um pai marcado teria de
// decidir se o pai continua marcado, e as duas respostas estão erradas.
//
// Aqui o pai não é guardado: ele é DERIVADO dos descendentes selecionáveis
// (todos ⇒ marcado, alguns ⇒ parcial, nenhum ⇒ vazio), e é isso que faz
// desmarcar UM filho deixar o pai parcial sem perder os irmãos.
//
// O que é SELECIONÁVEL: o nó precisa de `refId` (a entidade real por trás) e
// de um tipo que se possa concluir ou excluir. Nó de ALTERAÇÃO fica de fora —
// é fato do `audit_log`, não algo que alguém criou; `record`/`field` idem.
import type { TreeNode, TreeNodeKind } from "./model";

/** O que a ação em massa sabe fazer com um nó selecionado. */
export type TreeSelectableKind = "task" | "comment" | "note";

/** Um nó selecionado, já resolvido no que a ação precisa saber. */
export interface TreeSelectableRef {
  /** Id do NÓ (a chave da seleção): "task:<id>", "occ:3", "comment:<id>"… */
  nodeId: string;
  /** Id da ENTIDADE (tasks.id, comments.id, tree_nodes.id). */
  refId: string;
  kind: TreeSelectableKind;
}

/**
 * O tipo de ação de um nó, ou null se ele não entra em seleção.
 *
 * A ocorrência da série só é selecionável quando JÁ virou tarefa — o `refId`
 * dela é o `tasks.id` fundido pelo `load.ts`. Ocorrência prevista que ninguém
 * abriu não tem o que concluir nem o que excluir: ela é um galho vazio, e
 * marcá-la seria prometer uma ação que não existe.
 */
export function selectableKind(node: {
  kind: TreeNodeKind;
  refId?: string | null;
}): TreeSelectableKind | null {
  if (!node.refId) return null;
  if (node.kind === "task" || node.kind === "occurrence") return "task";
  if (node.kind === "comment") return "comment";
  if (node.kind === "note") return "note";
  return null;
}

/** O nó e TODOS os descendentes selecionáveis, em ordem de leitura. */
export function selectableRefs(node: TreeNode): TreeSelectableRef[] {
  const out: TreeSelectableRef[] = [];
  const walk = (n: TreeNode) => {
    const kind = selectableKind(n);
    if (kind) out.push({ nodeId: n.id, refId: n.refId as string, kind });
    for (const child of n.children) walk(child);
  };
  walk(node);
  return out;
}

/** Todos os selecionáveis de uma floresta — o universo do "selecionar todas". */
export function allSelectableRefs(nodes: TreeNode[]): TreeSelectableRef[] {
  return nodes.flatMap((n) => selectableRefs(n));
}

/**
 * Estado do checkbox de UM nó, derivado dos descendentes.
 *
 * `true` = ele e todo o galho estão marcados; `"indeterminate"` = parte;
 * `false` = nada. Um nó-folha selecionável responde só por si.
 */
export function nodeCheckState(
  selected: Set<string>,
  node: TreeNode
): boolean | "indeterminate" {
  const refs = selectableRefs(node);
  if (refs.length === 0) return false;
  let marked = 0;
  for (const r of refs) if (selected.has(r.nodeId)) marked += 1;
  if (marked === 0) return false;
  return marked === refs.length ? true : "indeterminate";
}

/**
 * Os nodeIds que um clique no checkbox do nó deve marcar/desmarcar.
 *
 * É a cascata: o galho inteiro acompanha. Quem aplica é o `setMany` do
 * `useBulkSelection` — este módulo não guarda estado.
 */
export function cascadeIds(node: TreeNode): string[] {
  return selectableRefs(node).map((r) => r.nodeId);
}

/**
 * Clicar num nó parcialmente marcado MARCA o galho (não desmarca).
 *
 * É o que a pessoa espera: o gesto num estado ambíguo resolve para "tudo",
 * porque "nada" já é alcançável clicando duas vezes.
 */
export function nextCascadeValue(state: boolean | "indeterminate"): boolean {
  return state !== true;
}

/** Reparte a seleção por tipo — cada um vai para a action que é dona dele. */
export function partitionSelection(
  refs: TreeSelectableRef[],
  selected: Set<string>
): { taskIds: string[]; commentIds: string[]; noteIds: string[] } {
  const taskIds: string[] = [];
  const commentIds: string[] = [];
  const noteIds: string[] = [];
  for (const r of refs) {
    if (!selected.has(r.nodeId)) continue;
    if (r.kind === "task") taskIds.push(r.refId);
    else if (r.kind === "comment") commentIds.push(r.refId);
    else noteIds.push(r.refId);
  }
  return { taskIds, commentIds, noteIds };
}

/** "2 tarefas · 4 anotações" — a barra diz o que vai acontecer com o quê. */
export function selectionSummary(counts: {
  taskIds: string[];
  commentIds: string[];
  noteIds: string[];
}): string {
  const parts: string[] = [];
  const push = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  push(counts.taskIds.length, "tarefa", "tarefas");
  push(counts.commentIds.length, "anotação", "anotações");
  push(counts.noteIds.length, "nó", "nós");
  return parts.join(" · ");
}
