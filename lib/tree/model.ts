// Versão: 1.0 | Data: 09/09/2026
// Modelo da TREE — a árvore de acompanhamento de um registro, e o mapa mental.
//
// A decisão central: a árvore é DERIVADA dos fatos que já existem (as cobranças
// da série, as tarefas manuais, os comentários, as alterações de campo). O
// banco (`tree_nodes`, 0133) guarda só duas coisas: os nós que não são fato de
// ninguém (a anotação digitada no mapa mental) e as EXCEÇÕES de parentesco (o
// nó que alguém arrastou para outro lugar).
//
// Por que assim: uma tabela que copiasse cada tarefa como nó teria de ser
// mantida em sincronia com `tasks` para sempre — e ficaria errada na primeira
// tarefa criada por fora. Derivar mantém a árvore verdadeira de graça, e ainda
// deixa aparecer a cobrança que NUNCA virou tarefa (a rodada perdida), que é
// justamente o que se quer ver ao analisar a conduta.
//
// Módulo PURO e client-safe: o widget é um componente client.

/** O que um nó é. `occurrence` é o tronco da série; `note` é digitado. */
export type TreeNodeKind =
  | "occurrence"
  | "task"
  | "comment"
  | "change"
  | "note"
  | "record"
  | "field";

export const TREE_NODE_KIND_LABELS: Record<TreeNodeKind, string> = {
  occurrence: "Cobrança",
  task: "Tarefa",
  comment: "Anotação",
  change: "Alteração",
  note: "Nota",
  record: "Registro",
  field: "Campo",
};

/** Um fato já normalizado, antes de virar árvore. */
export interface TreeFact {
  /** Identidade estável: "task:<id>", "comment:<id>", "occ:3"… */
  id: string;
  kind: TreeNodeKind;
  /** Dia do fato (YYYY-MM-DD). É por ele que a árvore se organiza. */
  at: string;
  label: string;
  body?: string | null;
  /** Só no tronco: qual cobrança este nó é. */
  occurrence?: number | null;
  /** Estado exibível (tarefa concluída, cobrança sem tarefa…). */
  status?: string | null;
  /** Id da entidade original, para as ações do nó. */
  refId?: string | null;
}

export interface TreeNode extends TreeFact {
  children: TreeNode[];
  depth: number;
}

/** Como a árvore se organiza. As três formas do pedido, configuráveis. */
export type TreeLayout = "por_ocorrencia" | "por_tipo" | "livre";

export const TREE_LAYOUT_LABELS: Record<TreeLayout, string> = {
  por_ocorrencia: "Por cobrança (linha do tempo do acompanhamento)",
  por_tipo: "Por tipo (tarefas, anotações, alterações)",
  livre: "Livre (mapa mental)",
};

/**
 * Uma exceção de parentesco: o nó que alguém arrastou. Vence a derivação em
 * QUALQUER forma — foi o pedido ("a opção 1 por padrão, mas sendo possível
 * editar livremente depois").
 */
export interface TreeParentOverride {
  /** Id do fato (o mesmo `TreeFact.id`). */
  nodeRef: string;
  /** Id do fato-pai, ou null para soltar na raiz. */
  parentRef: string | null;
  position?: number | null;
}
