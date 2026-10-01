// Versão: 1.5 | Data: 01/10/2026
// v1.5 (01/10/2026): nós OPERACIONAIS (0149) — `indicator` (meta × realizado
//   de um indicador, com o operador dos filhos), `plan` (plano de ação 5W2H) e
//   `ritual` (rotina de acompanhamento que vira tarefa). Linhas PRÓPRIAS de
//   `tree_nodes`, endereçadas como `note:<uuid>` (como a anotação: arrastar,
//   geometria e excluir funcionam sem roteamento novo); payload em
//   lib/tree/payload.ts. Só no mapa LIVRE — no registro ficam desabilitados
//   com motivo. Nunca escondidos pelo filtro (são estrutura desenhada).
// v1.4 (01/10/2026): (a) a ANOTAÇÃO saiu de `TREE_FILTERABLE_KINDS`. Ela não é
//   fato do histórico — é a estrutura que a pessoa desenha — e o filtro "O que
//   exibir" a escondia: a branch era criada e sumia na hora (era o "+ Galho na
//   raiz não faz nada"). Um "note" já gravado em showKinds é inofensivo; o
//   filtro a mantém sempre. (b) Vocabulário: "branch" no lugar de "galho" nos
//   rótulos de tela.
// Versão: 1.3 | Data: 30/09/2026
// v1.3 (30/09/2026): visualização ROOT. (a) `TreeView` ("lista" | "root") —
//   a Root é a mesma árvore desenhada num canvas de galhos arrastáveis, que
//   expandem para o lado ou para baixo; (b) `TreeNodeGeometry` — a posição
//   livre é EXCEÇÃO relativa ao slot automático (offset), gravada em
//   `tree_nodes` como o re-pendurar; (c) a NOTA (anotação da Tree) pode ser
//   ETAPA (checável) e RESULTADO esperado (`TreeFact.goal`); (d) `TreeScope`:
//   a fonte Livre (mapa por chave, sem registro) passou a existir de verdade;
//   (e) os TIPOS de galho que se puxam de um nó e o motivo de um estar
//   desabilitado — comentário é do feed de um REGISTRO, não existe em mapa.
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
  | "field"
  // v1.5 (01/10/2026): nós operacionais (0149).
  | "indicator"
  | "plan"
  | "ritual";

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
] as const satisfies readonly TreeNodeKind[];

/**
 * v1.4 (01/10/2026): os tipos que o filtro NUNCA esconde — o que a pessoa
 * desenha na própria árvore. Esconder a anotação fazia a branch recém-criada
 * sumir no mesmo instante.
 */
export const TREE_ALWAYS_VISIBLE_KINDS: readonly TreeNodeKind[] = [
  "note",
  // v1.5: estrutura desenhada, como a anotação.
  "indicator",
  "plan",
  "ritual",
];

/**
 * v1.5 (01/10/2026): tipos que são linha PRÓPRIA de `tree_nodes` (id lógico
 * `note:<uuid>`). O servidor roteia escrita/geometria por este conjunto.
 */
export const TREE_OWN_ROW_KINDS = ["note", "indicator", "plan", "ritual"] as const;

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
  // v1.3 (30/09/2026): "Anotação" — o texto que pertence à própria Tree (o
  // comentário vai para o feed do registro; a anotação, não).
  note: "Anotação",
  record: "Registro",
  field: "Campo",
  // v1.5 (01/10/2026)
  indicator: "Indicador",
  plan: "Plano de ação",
  ritual: "Ritual",
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
  /**
   * v1.3 (30/09/2026): o nó é o RESULTADO esperado (só nota). A Root destaca o
   * caminho de qualquer nó até ele — "o que isto serve" — e o progresso do
   * galho dele.
   */
  goal?: boolean;
  /**
   * v1.5 (01/10/2026): o payload CRU do nó operacional (indicador/plano/
   * ritual) — o card o parseia por `parseNodePayload` (fail-closed).
   */
  payload?: unknown;
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

/**
 * v1.3 (30/09/2026): COMO a árvore é desenhada — independente de COMO ela se
 * organiza (`TreeLayout`). Ausente = "lista" (o widget de sempre, byte-idêntico).
 */
export type TreeView = "lista" | "root";

export const TREE_VIEW_LABELS: Record<TreeView, string> = {
  lista: "Lista (branches recuadas)",
  root: "Root (canvas de branches arrastáveis)",
};

/** Para onde um galho expande os filhos na Root. */
export type TreeDirection = "h" | "v";

export const TREE_DIRECTION_LABELS: Record<TreeDirection, string> = {
  h: "Para o lado",
  v: "Para baixo",
};

/**
 * A geometria de UM nó na Root — exceção, como o re-pendurar: sem linha, o nó
 * fica no slot que o layout calcula. O offset é RELATIVO ao slot e se soma ao
 * dos ancestrais, então arrastar um galho leva os subgalhos junto.
 */
export interface TreeNodeGeometry {
  nodeRef: string;
  offsetX: number;
  offsetY: number;
  /** null = herda o padrão do widget. */
  direction: TreeDirection | null;
}

/** De qual árvore se fala: a de um registro ou um mapa livre. */
export type TreeScope =
  | { kind: "record"; recordId: string }
  | { kind: "livre"; mapKey: string };

/** Os tipos de galho que se puxam de um nó (Root e lista). */
export type TreeBranchKind =
  | "note"
  | "task"
  | "comment"
  // v1.5 (01/10/2026): nós operacionais (só mapa livre).
  | "indicator"
  | "plan"
  | "ritual";

export const TREE_BRANCH_KINDS: readonly TreeBranchKind[] = [
  "note",
  "task",
  "comment",
  "indicator",
  "plan",
  "ritual",
];

/** Rótulo do galho novo. "Anotação" é da Tree; "Comentário" é do feed. */
export const TREE_BRANCH_LABELS: Record<TreeBranchKind, string> = {
  note: "Anotação",
  task: TREE_NODE_KIND_LABELS.task,
  comment: TREE_NODE_KIND_LABELS.comment,
  indicator: TREE_NODE_KIND_LABELS.indicator,
  plan: TREE_NODE_KIND_LABELS.plan,
  ritual: TREE_NODE_KIND_LABELS.ritual,
};

/**
 * Por que um tipo de galho não pode ser criado aqui (null = pode). O item fica
 * DESABILITADO com o motivo, nunca escondido: sumir com a opção faria parecer
 * que ela não existe.
 */
export function branchKindDisabledReason(
  kind: TreeBranchKind,
  scope: TreeScope["kind"]
): string | null {
  if (kind === "comment" && scope === "livre") {
    return "Comentário pertence ao feed de um registro — num mapa livre use uma anotação.";
  }
  // v1.5: o desdobramento de metas mora num mapa livre (o planejamento), não
  // no acompanhamento de um registro.
  if ((kind === "indicator" || kind === "plan" || kind === "ritual") && scope === "record") {
    return "Indicador, plano e ritual moram num mapa livre (Tree com fonte “Mapa livre”).";
  }
  return null;
}

/**
 * A chave de um mapa livre: minúsculas, dígitos, hífen e sublinhado, até 80.
 * O servidor valida pela MESMA função — a chave é dado do usuário e vira
 * `scope_id`.
 */
export function normalizeMapKey(raw: string | null | undefined): string | null {
  const key = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return key === "" ? null : key;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O escopo que chega do cliente, validado. Fail-closed: formato estranho é
 * null — o servidor nunca grava `scope_id` que não seja um uuid de registro ou
 * uma chave de mapa normalizada.
 */
export function parseTreeScope(raw: unknown): TreeScope | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "record") {
    return typeof r.recordId === "string" && UUID_RE.test(r.recordId)
      ? { kind: "record", recordId: r.recordId }
      : null;
  }
  if (r.kind === "livre") {
    const key = normalizeMapKey(typeof r.mapKey === "string" ? r.mapKey : null);
    return key && key === r.mapKey ? { kind: "livre", mapKey: key } : null;
  }
  return null;
}

/**
 * Um id lógico de nó ("note:<uuid>", "occ:<rule>:<n>", "task:<uuid>"…) em
 * formato aceitável. Não prova que o nó existe — só que o texto é um id.
 */
export function isTreeNodeRef(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length <= 200 &&
    /^(occ|task|comment|change|note|series|kind):[\w:.-]+$/.test(v)
  );
}

/** O uuid depois do prefixo, quando o ref é daquele tipo. */
export function refUuid(ref: string, prefix: string): string | null {
  if (!ref.startsWith(`${prefix}:`)) return null;
  const id = ref.slice(prefix.length + 1);
  return UUID_RE.test(id) ? id : null;
}
