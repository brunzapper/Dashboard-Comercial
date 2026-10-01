// Versão: 1.4 | Data: 01/10/2026
// v1.4 (01/10/2026): rótulos de grupo dos nós operacionais (0149) na forma
//   por tipo — no mapa livre (a única casa deles) a forma não se aplica.
// Versão: 1.3 | Data: 30/09/2026
// v1.3 (30/09/2026): GUARDA DE CICLO. Com a Root, qualquer nó vira pai de
//   qualquer outro por arrasto — e duas exceções cruzadas (A sob B, B sob A),
//   ou uma exceção contra o parentesco DERIVADO (a ocorrência pendurada no
//   comentário que caiu nela), faziam os dois sumirem: ninguém do ciclo chega
//   à raiz. O parentesco agora é decidido INTEIRO antes de montar os filhos, e
//   o ciclo é quebrado soltando na raiz o membro cuja exceção o fechou. A
//   árvore sem ciclo sai byte-idêntica (o teste de série única segue pinado).
//   Junto, o rótulo dos ramos de `por_tipo`: comentário é "Comentários" e a
//   anotação da Tree é "Anotações" (antes os comentários saíam "Anotações").
// Versão: 1.2 | Data: 10/09/2026
// v1.2 (10/09/2026): VÁRIOS TRONCOS. Um registro pode participar de mais de uma
//   série, e até aqui a árvore desenhava um só. Com duas ou mais, cada uma
//   ganha um nó SINTÉTICO `series:<key>` por cima das ocorrências dela — do
//   mesmo jeito que `por_tipo` já fabrica `kind:<k>`. Com UMA série (o caso de
//   todo registro que existe hoje) a saída é BYTE-IDÊNTICA à v1.1, e é isso que
//   o teste pina: o agrupador só aparece quando há o que separar.
//
//   Os fatos que não são de série (tarefa avulsa, comentário, alteração)
//   seguem pendurando na OCORRÊNCIA em cuja janela caíram — a da série
//   PRIMÁRIA, a que concedeu o atributo. Reparti-los entre os troncos exigiria
//   inventar a qual sequência um comentário "pertence", e não pertence a
//   nenhuma: ele aconteceu num dia, e o dia cai na janela de todas.
// v1.1 (10/09/2026): só vocabulário (o agrupamento de `por_tipo`).
//
// Três formas, porque as três respondem perguntas diferentes:
//  - `por_ocorrencia`: o tronco são as OCORRÊNCIAS da série e cada coisa
//    pendura naquela em cuja janela caiu. De cima a baixo: "na 3ª ele ligou e
//    anotou; na 4ª não fez nada". É o que responde "como o vendedor está
//    conduzindo este lead".
//  - `por_tipo`: um ramo por tipo. Responde "o que existe", não "o que
//    aconteceu em cada uma".
//  - `livre`: só o parentesco explícito — o mapa mental.
//
// E as formas se misturam, como pedido: a forma dá o parentesco DERIVADO, e um
// nó arrastado à mão (`TreeParentOverride`) vence a derivação em qualquer uma
// delas. É o "opção 1 por padrão, mas editável livremente depois".
import type {
  TreeFact,
  TreeLayout,
  TreeNode,
  TreeNodeKind,
  TreeParentOverride,
} from "./model";

/** Ordem dos ramos na forma "por tipo" — do mais acionável ao mais passivo. */
const KIND_ORDER: TreeNodeKind[] = [
  "series",
  "occurrence",
  "task",
  "comment",
  "change",
  "note",
  "record",
  "field",
];

function byDate(a: TreeFact, b: TreeFact): number {
  return a.at === b.at ? a.id.localeCompare(b.id) : a.at.localeCompare(b.at);
}

function toNode(fact: TreeFact, depth: number): TreeNode {
  return { ...fact, children: [], depth };
}

/**
 * Em qual ocorrência este fato caiu.
 *
 * A janela da ocorrência N vai do dia dela até a véspera da seguinte. Fato
 * ANTERIOR à primeira pendura na primeira — ele aconteceu durante o
 * primeiro ciclo, e sumir com ele seria perder justamente o começo do
 * acompanhamento.
 */
function occurrenceFor(at: string, trunk: TreeFact[]): TreeFact | null {
  if (trunk.length === 0) return null;
  let hit: TreeFact | null = null;
  for (const occ of trunk) {
    if (occ.at <= at) hit = occ;
    else break;
  }
  return hit ?? trunk[0];
}

export interface DeriveInput {
  facts: TreeFact[];
  layout: TreeLayout;
  overrides?: TreeParentOverride[];
  /**
   * v1.2: a série cujas ocorrências recebem os fatos avulsos quando há mais de
   * um tronco. Ausente = a primeira que aparecer nos fatos. É a série que
   * CONCEDEU o atributo — a que estava sozinha na árvore antes desta versão.
   */
  primarySeriesKey?: string | null;
  /** v1.2: rótulo de cada tronco (o nome da regra). Sem entrada, um genérico. */
  seriesLabels?: Record<string, string>;
}

/**
 * Monta a árvore. Nenhum fato se perde: o que não encontra pai derivado fica na
 * raiz, e o que aponta para um pai inexistente (nó apagado, ocorrência que sumiu
 * quando a cadência mudou) também — árvore não é lugar de esconder dado.
 */
export function deriveTree(input: DeriveInput): TreeNode[] {
  const facts = [...input.facts].sort(byDate);
  const byId = new Map(facts.map((f) => [f.id, f]));
  const nodes = new Map<string, TreeNode>();
  for (const f of facts) nodes.set(f.id, toNode(f, 0));

  // O parentesco explícito vence a derivação — em qualquer forma.
  const override = new Map<string, string | null>();
  for (const o of input.overrides ?? []) {
    // Pai que não existe mais é ignorado (o nó cai na derivação/raiz), e o
    // auto-pai é recusado: um nó pendurado em si mesmo some da árvore.
    if (o.parentRef && (!byId.has(o.parentRef) || o.parentRef === o.nodeRef)) {
      continue;
    }
    override.set(o.nodeRef, o.parentRef);
  }

  const trunk = facts.filter((f) => f.kind === "occurrence");
  // As séries presentes, na ordem em que os troncos aparecem. Sem chave (o
  // formato de antes da v1.2) tudo cai num balde só e nada muda.
  const seriesKeys: string[] = [];
  for (const occ of trunk) {
    const key = occ.seriesKey ?? "";
    if (key !== "" && !seriesKeys.includes(key)) seriesKeys.push(key);
  }
  // O agrupador só existe quando há o que separar: com uma série (ou nenhuma)
  // a árvore é a de sempre.
  const grouped = input.layout === "por_ocorrencia" && seriesKeys.length > 1;
  const primaryKey =
    (input.primarySeriesKey && seriesKeys.includes(input.primarySeriesKey)
      ? input.primarySeriesKey
      : seriesKeys[0]) ?? null;
  // Os fatos avulsos caem na janela do tronco PRIMÁRIO. Sem agrupamento, o
  // tronco é o conjunto inteiro — exatamente como na v1.1.
  const primaryTrunk = grouped
    ? trunk.filter((f) => (f.seriesKey ?? "") === primaryKey)
    : trunk;
  const roots: TreeNode[] = [];
  const kindRoots = new Map<TreeNodeKind, TreeNode>();
  const seriesRoots = new Map<string, TreeNode>();

  /** O nó sintético de uma série, criado na primeira ocorrência dela. */
  const seriesBranch = (key: string, at: string): TreeNode => {
    let branch = seriesRoots.get(key);
    if (!branch) {
      branch = toNode(
        {
          id: `series:${key}`,
          kind: "series",
          at,
          label: input.seriesLabels?.[key] ?? SERIES_FALLBACK_LABEL,
          seriesKey: key,
        },
        0
      );
      seriesRoots.set(key, branch);
      roots.push(branch);
    }
    return branch;
  };

  // v1.3: o parentesco é decidido INTEIRO antes de pendurar alguém — só assim
  // dá para enxergar um ciclo. `parentOf` guarda o pai de cada fato (null =
  // raiz); os nós sintéticos (sequência, tipo) são sempre raiz e nunca fecham
  // ciclo, porque não recebem exceção.
  const parentOf = new Map<string, string | null>();
  const syntheticChildren = new Map<TreeNode, TreeNode[]>();
  const order: TreeNode[] = [];

  const toSynthetic = (branch: TreeNode, node: TreeNode) => {
    const list = syntheticChildren.get(branch) ?? [];
    list.push(node);
    syntheticChildren.set(branch, list);
  };

  for (const fact of facts) {
    const node = nodes.get(fact.id)!;
    order.push(node);

    if (override.has(fact.id)) {
      const parentId = override.get(fact.id) ?? null;
      parentOf.set(fact.id, parentId && nodes.has(parentId) ? parentId : null);
      continue;
    }

    if (input.layout === "livre") {
      // Sem parentesco explícito, tudo é raiz — quem desenha é o usuário.
      parentOf.set(fact.id, null);
      continue;
    }

    if (input.layout === "por_tipo") {
      if (fact.kind === "occurrence") {
        parentOf.set(fact.id, null);
        continue;
      }
      let branch = kindRoots.get(fact.kind);
      if (!branch) {
        branch = toNode(
          {
            id: `kind:${fact.kind}`,
            kind: fact.kind,
            at: fact.at,
            label: KIND_LABEL[fact.kind],
          },
          0
        );
        kindRoots.set(fact.kind, branch);
        roots.push(branch);
      }
      toSynthetic(branch, node);
      continue;
    }

    // por_ocorrencia
    if (fact.kind === "occurrence") {
      const key = fact.seriesKey ?? "";
      if (grouped && key !== "") toSynthetic(seriesBranch(key, fact.at), node);
      else parentOf.set(fact.id, null);
      continue;
    }
    const occ = occurrenceFor(fact.at, primaryTrunk);
    parentOf.set(fact.id, occ ? occ.id : null);
  }

  // v1.3: quebra de ciclo. Subindo do nó, voltar a ele é ciclo; quem é solto
  // na raiz é o PRIMEIRO membro (em ordem de fato) que tem EXCEÇÃO — foi uma
  // escolha manual que fechou o laço, e o parentesco derivado dos demais
  // continua valendo. Sem exceção no ciclo (impossível hoje), o primeiro.
  for (const node of order) {
    const seen: string[] = [];
    let cur: string | null | undefined = node.id;
    while (cur != null && parentOf.has(cur) && !seen.includes(cur)) {
      seen.push(cur);
      cur = parentOf.get(cur);
    }
    if (cur == null || !seen.includes(cur)) continue;
    const cycle = seen.slice(seen.indexOf(cur));
    const breakAt =
      order.find((n) => cycle.includes(n.id) && override.has(n.id)) ??
      order.find((n) => cycle.includes(n.id))!;
    parentOf.set(breakAt.id, null);
  }

  // Sintéticos entram com a raiz na ordem em que nasceram; os fatos seguem a
  // ordem de data — a mesma sequência de inserção da v1.2.
  for (const node of order) {
    if (!parentOf.has(node.id)) continue;
    const parentId = parentOf.get(node.id) ?? null;
    const parent = parentId ? nodes.get(parentId) : null;
    if (!parent || parent.id === node.id) roots.push(node);
    else parent.children.push(node);
  }
  for (const [branch, list] of syntheticChildren) branch.children.push(...list);

  // Profundidade e ordem interna, já com os arrastados no lugar.
  const walk = (list: TreeNode[], depth: number) => {
    list.sort(byDate);
    for (const n of list) {
      n.depth = depth;
      walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  // Na forma por tipo os ramos seguem a ordem do catálogo, não a data.
  if (input.layout === "por_tipo") {
    roots.sort(
      (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    );
  }
  return roots;
}

/** Tronco cuja regra sumiu (excluída) ou cujo nome ninguém deu. */
const SERIES_FALLBACK_LABEL = "Sequência";

const KIND_LABEL: Record<TreeNodeKind, string> = {
  series: "Sequências",
  occurrence: "Tarefas da série",
  task: "Tarefas",
  comment: "Comentários",
  change: "Alterações",
  note: "Anotações",
  record: "Registros",
  field: "Campos",
  indicator: "Indicadores",
  plan: "Planos de ação",
  ritual: "Rituais",
};

/** Total de nós (o cabeçalho do widget diz o tamanho da árvore). */
export function countNodes(nodes: TreeNode[]): number {
  return nodes.reduce((acc, n) => acc + 1 + countNodes(n.children), 0);
}
