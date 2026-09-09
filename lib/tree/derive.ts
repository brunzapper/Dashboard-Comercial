// Versão: 1.0 | Data: 09/09/2026
// A DERIVAÇÃO da árvore — pura. Dados os fatos e a forma, o parentesco.
//
// Três formas, porque as três respondem perguntas diferentes:
//  - `por_ocorrencia`: o tronco são as COBRANÇAS e cada coisa pendura naquela
//    em cuja janela caiu. Lendo de cima a baixo: "na 3ª cobrança ele ligou e
//    anotou; na 4ª não fez nada". É o que responde "como o vendedor está
//    conduzindo este lead".
//  - `por_tipo`: um ramo por tipo. Responde "o que existe", não "o que
//    aconteceu em cada cobrança".
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
 * Em qual cobrança este fato caiu.
 *
 * A janela da cobrança N vai do dia dela até a véspera da seguinte. Fato
 * ANTERIOR à primeira cobrança pendura na primeira — ele aconteceu durante o
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
}

/**
 * Monta a árvore. Nenhum fato se perde: o que não encontra pai derivado fica na
 * raiz, e o que aponta para um pai inexistente (nó apagado, cobrança que sumiu
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
  const roots: TreeNode[] = [];
  const kindRoots = new Map<TreeNodeKind, TreeNode>();

  const attach = (child: TreeNode, parentId: string | null) => {
    const parent = parentId ? nodes.get(parentId) : null;
    if (!parent || parent.id === child.id) {
      roots.push(child);
      return;
    }
    parent.children.push(child);
  };

  for (const fact of facts) {
    const node = nodes.get(fact.id)!;

    if (override.has(fact.id)) {
      attach(node, override.get(fact.id) ?? null);
      continue;
    }

    if (input.layout === "livre") {
      // Sem parentesco explícito, tudo é raiz — quem desenha é o usuário.
      roots.push(node);
      continue;
    }

    if (input.layout === "por_tipo") {
      if (fact.kind === "occurrence") {
        roots.push(node);
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
      branch.children.push(node);
      continue;
    }

    // por_ocorrencia
    if (fact.kind === "occurrence") {
      roots.push(node);
      continue;
    }
    const occ = occurrenceFor(fact.at, trunk);
    attach(node, occ ? occ.id : null);
  }

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

const KIND_LABEL: Record<TreeNodeKind, string> = {
  occurrence: "Cobranças",
  task: "Tarefas",
  comment: "Anotações",
  change: "Alterações",
  note: "Notas",
  record: "Registros",
  field: "Campos",
};

/** Total de nós (o cabeçalho do widget diz o tamanho da árvore). */
export function countNodes(nodes: TreeNode[]): number {
  return nodes.reduce((acc, n) => acc + 1 + countNodes(n.children), 0);
}
