// Versão: 1.2 | Data: 10/09/2026
// v1.2 (10/09/2026): (a) o tipo `series` — o nó SINTÉTICO que agrupa as
//   ocorrências de uma série quando o registro tem mais de uma. Antes a Tree
//   desenhava um tronco só (o da regra que concedeu o atributo, e
//   `record_attributes` é único por registro): a segunda série virava tarefas
//   soltas, sem tronco e sem a ocorrência que ninguém abriu — justamente o que
//   a árvore existe para mostrar. Ele não é fato de ninguém, então não é
//   filtrável nem selecionável. (b) `TreeFact.seriesKey`, que diz de qual
//   tronco o fato é. (c) vocabulário: "Anotação" virou "Comentário" (a
//   organização não usa a primeira palavra; o rótulo é dado de exibição e vive
//   aqui, não espalhado em literais pelas telas).
// v1.1 (10/09/2026): vocabulário. O rótulo do tronco deixou de ter substantivo
// fixo no código — ele é dado agora (série ou tarefa), e o padrão é "Tarefa".
//
// A decisão central: a árvore é DERIVADA dos fatos que já existem (as ocorrências
// da série, as tarefas manuais, os comentários, as alterações de campo). O
// banco (`tree_nodes`, 0133) guarda só duas coisas: os nós que não são fato de
// ninguém (a anotação digitada no mapa mental) e as EXCEÇÕES de parentesco (o
// nó que alguém arrastou para outro lugar).
//
// Por que assim: uma tabela que copiasse cada tarefa como nó teria de ser
// mantida em sincronia com `tasks` para sempre — e ficaria errada na primeira
// tarefa criada por fora. Derivar mantém a árvore verdadeira de graça, e ainda
// deixa aparecer a ocorrência que NUNCA virou tarefa (a rodada perdida), que é
// justamente o que se quer ver ao analisar a conduta.
//
// Módulo PURO e client-safe: o widget é um componente client.

/** O que um nó é. `occurrence` é o tronco da série; `note` é digitado. */
export type TreeNodeKind =
  | "series"
  | "occurrence"
  | "task"
  | "comment"
  | "change"
  | "note"
  | "record"
  | "field";

/**
 * Os tipos que o widget deixa FILTRAR (`TreeSettings.showKinds`).
 *
 * v1.1 (09/09/2026): `record` e `field` ficam de fora — eles são peças do mapa
 * livre, não fatos do histórico, e oferecê-los como filtro do acompanhamento
 * seria oferecer um botão que nunca muda nada. `TreeFilterableKind` é a fonte
 * do tipo em `TreeSettings`, para as duas listas não poderem divergir.
 *
 * v1.2 (10/09/2026): `series` também fica de fora, e pelo mesmo motivo: ele é
 * o agrupador das ocorrências, não um fato. Esconder o agrupador entregaria os
 * troncos ao pai (a regra do `filterKinds`) e desfaria a separação — quem quer
 * menos árvore desliga "Tarefa", não a sequência.
 */
export const TREE_FILTERABLE_KINDS = [
  "occurrence",
  "task",
  "comment",
  "change",
  "note",
] as const satisfies readonly TreeNodeKind[];

export type TreeFilterableKind = (typeof TREE_FILTERABLE_KINDS)[number];

/**
 * Quantas ocorrências a janela da árvore traz por vez (e quantas o "carregar
 * mais" acrescenta). Mora aqui, não no loader: o widget é um Client Component,
 * e importá-la de lá arrastaria o loader inteiro para o bundle do navegador.
 */
export const TREE_WINDOW_STEP = 12;

export const TREE_NODE_KIND_LABELS: Record<TreeNodeKind, string> = {
  series: "Sequência",
  occurrence: "Tarefa",
  task: "Tarefa",
  // v1.2: "Comentário". Dono ÚNICO do rótulo — nenhuma tela escreve a palavra
  // à mão (foi assim que o termo errado se espalhou por 37 arquivos na 0137).
  comment: "Comentário",
  change: "Alteração",
  note: "Nota",
  record: "Registro",
  field: "Campo",
};

/**
 * O VERBO do comentário ("Comentar"), separado do substantivo.
 *
 * Dono único, ao lado do rótulo: o botão precisa de uma ação, o nó precisa de
 * um nome, e derivar um do outro em cada tela é como a palavra errada se
 * espalhou por 37 arquivos na 0137.
 */
export const TREE_COMMENT_VERB = "Comentar";

/** Um fato já normalizado, antes de virar árvore. */
export interface TreeFact {
  /** Identidade estável: "task:<id>", "comment:<id>", "occ:3"… */
  id: string;
  kind: TreeNodeKind;
  /** Dia do fato (YYYY-MM-DD). É por ele que a árvore se organiza. */
  at: string;
  label: string;
  body?: string | null;
  /** Só no tronco: qual ocorrência da série este nó é. */
  occurrence?: number | null;
  /** Estado exibível (tarefa concluída, ocorrência sem tarefa…). */
  status?: string | null;
  /** Id da entidade original, para as ações do nó. */
  refId?: string | null;
  /**
   * v1.2: de qual série o fato é. Preenchido nas OCORRÊNCIAS (e no nó
   * sintético que as agrupa); ausente no resto — tarefa avulsa, comentário e
   * alteração não pertencem a tronco nenhum, eles CAEM na janela de um.
   */
  seriesKey?: string | null;
}

export interface TreeNode extends TreeFact {
  children: TreeNode[];
  depth: number;
}

/** Como a árvore se organiza. As três formas do pedido, configuráveis. */
export type TreeLayout = "por_ocorrencia" | "por_tipo" | "livre";

export const TREE_LAYOUT_LABELS: Record<TreeLayout, string> = {
  por_ocorrencia: "Por ocorrência (linha do tempo do acompanhamento)",
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
