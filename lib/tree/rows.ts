// Versão: 1.1 | Data: 01/10/2026
// v1.1 (01/10/2026): nós OPERACIONAIS (0149). Linha própria de `kind`
//   indicator/plan/ritual vira fato do MESMO jeito que a anotação (id
//   `note:<uuid>`, pai e geometria na própria linha), carregando o `payload`
//   cru; e `preset_key` alimenta `presetRefs` — é o que resolve o
//   `rootRef: "preset:<chave>"` do widget (mostrar só um galho).
// Versão: 1.0 | Data: 30/09/2026
// v1.0 (30/09/2026): o PARSE das linhas de `tree_nodes`, extraído do loader
//   para ser puro e testável — e porque agora há dois loaders (registro e mapa
//   livre) que leem a mesma tabela.
//
// Uma linha de `tree_nodes` é UMA de três coisas:
//  1. EXCEÇÃO sobre um fato derivado (`node_ref` preenchido): o pai que alguém
//     escolheu e/ou a geometria na Root. `parent_ref` null = SEM exceção de
//     pai (só geometria) — o comentário da 0133 sempre disse isso; até a v1.0
//     o loader lia null como "soltar na raiz", mas nenhum escritor gravava
//     null (o `setTreeParent` sempre mandou '-' ou um ref), então nada muda
//     para as linhas que existem. '-' continua sendo "soltar na raiz".
//  2. ANOTAÇÃO (`kind='note'`, sem `node_ref`): o nó que pertence à própria
//     Tree. O pai e a geometria moram NA PRÓPRIA linha.
//  3. TAREFA DE MAPA (`kind='task'` + `ref_id`, sem `node_ref`, escopo livre):
//     a tarefa pendurada num mapa livre — no registro a tarefa já é fato
//     derivado, e a linha seria redundante.
//
// Módulo PURO e client-safe.
import { TREE_NODE_KIND_LABELS, TREE_OWN_ROW_KINDS } from "./model";
import type {
  TreeDirection,
  TreeFact,
  TreeNodeGeometry,
  TreeParentOverride,
} from "./model";

/** O que o loader seleciona de `tree_nodes`. */
export interface TreeNodeRow {
  id: string;
  kind: string;
  ref_id: string | null;
  node_ref: string | null;
  parent_ref: string | null;
  label: string | null;
  body: string | null;
  position: number | null;
  created_at: string | null;
  offset_x?: number | null;
  offset_y?: number | null;
  direction?: string | null;
  status?: string | null;
  is_goal?: boolean | null;
  /** v1.1 (0149): payload do nó operacional e identidade do seed. */
  payload?: unknown;
  preset_key?: string | null;
}

/** As colunas que os loaders pedem — um lugar só, para as duas leituras. */
export const TREE_NODE_COLUMNS =
  "id, kind, ref_id, node_ref, parent_ref, label, body, position, created_at, offset_x, offset_y, direction, status, is_goal, payload, preset_key";

/** Uma tarefa que a linha pendura num mapa (hidratada pelo loader). */
export interface TreeMapTaskRef {
  /** Id da linha em `tree_nodes`. */
  rowId: string;
  taskId: string;
  /** Pai lógico (`note:<id>`, `task:<id>`), ou null na raiz. */
  parentRef: string | null;
}

export interface ParsedTreeRows {
  /** Anotações — já como fatos. */
  facts: TreeFact[];
  overrides: TreeParentOverride[];
  geometry: TreeNodeGeometry[];
  /** Tarefas de mapa a hidratar (só no escopo livre). */
  mapTasks: TreeMapTaskRef[];
  /** v1.1: `preset_key` → id lógico do nó (`note:<uuid>`). */
  presetRefs: Record<string, string>;
}

const day = (v: unknown): string =>
  typeof v === "string" ? v.slice(0, 10) : "";

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

function direction(v: unknown): TreeDirection | null {
  return v === "h" || v === "v" ? v : null;
}

/** '-' = raiz; null/vazio = sem exceção; o resto é o ref do pai. */
function parentOf(v: unknown): string | null | undefined {
  if (v === "-") return null;
  if (typeof v !== "string" || v === "") return undefined;
  return v;
}

function geometryOf(nodeRef: string, row: TreeNodeRow): TreeNodeGeometry | null {
  const dir = direction(row.direction);
  const x = num(row.offset_x);
  const y = num(row.offset_y);
  if (dir == null && x === 0 && y === 0) return null;
  return { nodeRef, offsetX: x, offsetY: y, direction: dir };
}

/**
 * As linhas de `tree_nodes` viram fatos (anotações), exceções de pai,
 * geometria e as tarefas de mapa a hidratar. `allowMapTasks` = escopo livre:
 * no registro uma linha `task` sem `node_ref` não tem significado e é ignorada.
 */
export function parseTreeNodeRows(
  rows: TreeNodeRow[],
  opts: { allowMapTasks?: boolean } = {}
): ParsedTreeRows {
  const out: ParsedTreeRows = {
    facts: [],
    overrides: [],
    geometry: [],
    mapTasks: [],
    presetRefs: {},
  };
  for (const row of rows) {
    const parent = parentOf(row.parent_ref);

    if (row.node_ref) {
      if (parent !== undefined) {
        out.overrides.push({
          nodeRef: row.node_ref,
          parentRef: parent,
          position: row.position ?? null,
        });
      }
      const geo = geometryOf(row.node_ref, row);
      if (geo) out.geometry.push(geo);
      continue;
    }

    if (row.kind === "task") {
      if (!opts.allowMapTasks || !row.ref_id) continue;
      out.mapTasks.push({
        rowId: row.id,
        taskId: row.ref_id,
        parentRef: parent ?? null,
      });
      const geo = geometryOf(`task:${row.ref_id}`, row);
      if (geo) out.geometry.push(geo);
      continue;
    }

    if (!(TREE_OWN_ROW_KINDS as readonly string[]).includes(row.kind)) continue;
    const kind = row.kind as (typeof TREE_OWN_ROW_KINDS)[number];
    const id = `note:${row.id}`;
    if (row.preset_key) out.presetRefs[row.preset_key] = id;
    const checkable =
      kind === "note" && (row.status === "pendente" || row.status === "concluida");
    out.facts.push({
      id,
      kind,
      at: day(row.created_at),
      label: row.label?.trim() || TREE_NODE_KIND_LABELS[kind],
      body: row.body ?? null,
      refId: row.id,
      // Mesmo vocabulário das tarefas: a Root soma as duas no progresso.
      status: checkable
        ? row.status === "concluida"
          ? "concluída"
          : "aberta"
        : null,
      goal: row.is_goal === true,
      // v1.1: o payload cru — o card parseia (fail-closed) pelo tipo.
      ...(kind !== "note" && row.payload != null ? { payload: row.payload } : {}),
    });
    // O pai da anotação mora na própria linha. '-' = raiz explícita (criada
    // na raiz da Root); vazio = segue a forma (no acompanhamento, pendura na
    // ocorrência em cuja janela caiu, como sempre).
    if (parent !== undefined) {
      out.overrides.push({ nodeRef: id, parentRef: parent });
    }
    const geo = geometryOf(id, row);
    if (geo) out.geometry.push(geo);
  }
  return out;
}
