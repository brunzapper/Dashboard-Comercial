// Versão: 1.11 | Data: 01/10/2026
// v1.11 (01/10/2026): `convertTreeNote` — a branch nasce como ANOTAÇÃO e o
//   clique direito a converte em comentário ou tarefa. Cada item nasce pelo
//   choke point dono dele (`createComment`/`createTask` — invariante 25), herda
//   o pai e a geometria da anotação, leva os FILHOS junto e só então a
//   anotação é apagada (último passo: falha no meio não perde nada).
// v1.10 (30/09/2026): visualização ROOT e mapa LIVRE.
//   (a) `loadRecordTree` devolve também a GEOMETRIA da Root, e `loadMapTree`
//       carrega o mapa livre (escopo `livre`, sem registro) — a fonte que a
//       0133 previa e nenhum loader lia;
//   (b) `createTreeNote`/`updateTreeNote` — a ANOTAÇÃO da Tree (texto livre,
//       etapa checável ou Resultado esperado), pendurada em qualquer nó;
//   (c) `setTreeNodeParent` é o dono ÚNICO do re-pendurar, roteado pelo
//       prefixo do nó: anotação e tarefa de mapa mudam a PRÓPRIA linha; fato
//       derivado grava a exceção `node_ref`. `setTreeParent` virou casca dele;
//   (d) `setTreeNodeGeometry` — o arrasto para o vazio e a direção do galho,
//       mesmo roteamento, gravando SÓ as colunas de geometria (o pai escolhido
//       antes sobrevive);
//   (e) `attachTaskToMap` — a tarefa criada pelo editor de sempre (TaskSheet →
//       createTask) pendurada num mapa livre.
// v1.9 (11/09/2026): `runCommentThread` SAIU. Turno de IA não pode ser Server
//   Action: o Next as despacha uma de cada vez por cliente, e um turno de até
//   240s segurava a fila — com a análise rodando, `loadRecordTree` ficava atrás
//   dela e a Tree não carregava outro registro. O turno agora entra por
//   `/api/tree/ai-turn`, que roda o MESMO núcleo. As outras três continuam
//   actions: são curtas, e aplicar/descartar são mutações.
// Versão: 1.8 | Data: 11/09/2026
// v1.8 (11/09/2026): o "Salvar e analisar" virou CONVERSA — as actions agora
//   abrem/rodam/aplicam/descartam um fio de `tree_ai_threads` (0139). São
//   cascas finas, como antes: gate, turnos e prévia moram no núcleo
//   (lib/ai/analyze-comment.ts). `analyzeComment`/`applyCommentTask` saíram:
//   a primeira não tinha onde guardar o que respondeu, e a segunda recebia o
//   JSON do CLIENTE — agora ele sai da linha (precedente da 0098).
// v1.7 | Data: 10/09/2026
// v1.7 (10/09/2026): (a) a árvore devolve VÁRIAS séries (uma por regra que
//   gerou tarefa para o registro, e não só a que concedeu o atributo) mais a
//   Base do registro, para o editor de automação abrir dentro da Tree;
//   (b) encerrar/retomar a sequência de um registro mora em
//   `lib/tasks/actions.ts` (`endRecordSeries`/`resumeRecordSeries`), ao lado do
//   `completeTask`/`deleteTask` que a lista de tarefas já usa: a pergunta "e as
//   demais da sequência?" não é da árvore, é de toda tela que fecha uma
//   ocorrência;
//   (c) `analyzeComment`/`applyCommentTask` — o "Salvar e analisar" do
//   comentário (núcleo em lib/ai/analyze-comment.ts; estas são casca fina, como
//   toda action de IA do §4.17);
//   (d) `addTreeNote` aceita o nó em que a pessoa clicou: "Comentar aqui" na 3ª
//   ocorrência gravava o comentário com `created_at = now()`, e ele pendurava
//   na ocorrência de HOJE — o botão do nó era idêntico ao do cabeçalho. Agora a
//   EXCEÇÃO de parentesco é gravada logo depois (`setTreeParent`, que existia
//   desde a 0133 e não tinha um chamador sequer).
// v1.6 (10/09/2026): `deleteTreeNodesBulk` — a seleção múltipla da Tree apaga
// vários nós livres de uma vez. Mesmo `.is("node_ref", null)` do unitário: a
// EXCEÇÃO de parentesco não é um nó, e apagá-la aqui desfaria em silêncio um
// re-pendurar que o usuário fez de propósito.
// v1.5 (10/09/2026): (a) `deleteTreeNode` — o nó LIVRE (nota/mapa mental) não
//   tinha como ser apagado: `tree_nodes` só ganhava linha, nunca perdia;
//   (b) `addTreeNote` passa a chamar `createComment`, o choke point de 0066.
//   Ela inseria em `comments` por fora e NÃO emitia `comment.created`, então
//   nenhum webhook via a anotação feita pela árvore — o mesmo motivo pelo qual
//   `addTreeTask` saiu na v1.3.
// v1.4 (10/09/2026): só vocabulário — o substantivo da ocorrência
//   da série saiu do código e virou dado (SeriesConfig.noun, e
//   tasks.occurrence_noun por tarefa).
// v1.3 (09/09/2026): a árvore devolve as TAREFAS do registro (TaskRow) e os
//   responsáveis, para o nó abrir o editor de tarefa que o resto do app já usa
//   (components/tarefas/task-sheet.tsx) em vez de um formulário só de título.
//   Antes um nó de tarefa mostrava o título e mais nada, e não havia como
//   editar prazo, hora, descrição ou responsável de dentro da Tree.
// v1.2 (09/09/2026): o registro e o atributo são buscados EM PARALELO. Eram
//   dois awaits em série sem dependência entre eles — e cada ida ao banco
//   entra inteira no tempo que o usuário espera depois de clicar na linha.
// v1.1 (09/09/2026): a árvore vem em JANELA (ordem + quantas ocorrências), com
//   "carregar mais". Ver lib/tree/load.ts — o corte é por ocorrência.
// Server Actions da Tree (0133): carregar a árvore de um registro e as ações
// que se faz DENTRO dela.
//
// Todas com o client RLS do usuário — as policies de records/tasks/comments, a
// da 0131 (atributo) e a da 0133 (nós) já recortam. Nada de service role: o
// único caminho de sistema é o executor da automação.
//
// As ações são as do pedido, e cada uma vai pelo choke point que já existe:
// anotar grava em `comments` (0066), agendar tarefa manual grava em `tasks`,
// pausar mexe no STATUS do atributo (nunca o exclui) e mudar a cadência grava
// uma exceção em `series_settings` — nunca na definição da regra.
"use server";

import { revalidatePath } from "next/cache";

import { getActiveOrgId } from "@/lib/auth/org";
import { getSessionInfo } from "@/lib/auth/session";
import { todayBrasiliaIso } from "@/lib/date/today";
import { createClient } from "@/lib/supabase/server";
import { createComment } from "@/lib/comments/actions";
import { createTask } from "@/lib/tasks/actions";
import {
  applyCommentThreadCore,
  dismissCommentThreadCore,
  listCommentThreadsCore,
  openCommentThreadCore,
  type ApplyCommentTaskState,
  type CommentThread,
} from "@/lib/ai/analyze-comment";
import { loadSources } from "@/lib/config/sources";
import { rootSources } from "@/lib/sources";
import {
  BULK_MAX_ITEMS,
  chunk,
  fanOut,
  resultsFromReturned,
  type BulkActionState,
  type BulkItemResult,
} from "@/lib/kanban/bulk-helpers";
import { deriveTree } from "@/lib/tree/derive";
import { loadMapTreeFacts, loadRecordTreeFacts } from "@/lib/tree/load";
import { TREE_WINDOW_STEP, type TreeWindow } from "@/lib/tree/load";
import type { TreeSeriesInfo } from "@/lib/tree/load";
import {
  branchKindDisabledReason,
  isTreeNodeRef,
  normalizeMapKey,
  parseTreeScope,
  refUuid,
  type TreeDirection,
  type TreeLayout,
  type TreeNode,
  type TreeNodeGeometry,
  type TreeScope,
} from "@/lib/tree/model";
import { TASK_COLS_WITH_RECORD, type TaskRow } from "@/lib/tasks/types";
import type { OptionItem } from "@/lib/records/types";

export interface TreeActionState {
  ok?: boolean;
  message?: string;
}

export interface TreeData {
  nodes: TreeNode[];
  /**
   * v1.7: as séries do registro, a PRIMÁRIA (a que concedeu o atributo)
   * primeiro. Era uma só — e por isso a segunda série de um registro não tinha
   * tronco na árvore. Ver lib/tree/load.ts v1.5.
   */
  series: TreeSeriesInfo[];
  /** Atributo que sustenta a árvore (para pausar/retomar sem excluir). */
  attribute: { id: string; status: "ativo" | "pausado" } | null;
  recordTitle: string;
  /** Há ocorrência fora da janela na direção corrente ("carregar mais"). */
  hasMore: boolean;
  /**
   * As tarefas do registro, inteiras. O nó carrega só o `refId`; é por aqui
   * que o editor recebe a linha REAL para editar (v1.3).
   */
  tasks: TaskRow[];
  /** Responsáveis ativos — o `TaskFormContext` do editor (padrão da agenda). */
  responsibles: OptionItem[];
  /**
   * v1.7: a Base RAIZ do registro — o dono das automações de série que a Tree
   * cria e edita (`AutomationOwner {kind:"source"}`). Resolvida pelo CATÁLOGO,
   * nunca por `toSourceKey` (identidade não serve com sub-fontes na jogada).
   */
  sourceKey: string | null;
  /** v1.7: o usuário pode configurar automação de Base? (o gate é admin.) */
  canConfigureSeries: boolean;
  /** v1.10: a geometria da Root (offset e direção por nó). */
  geometry: TreeNodeGeometry[];
  message?: string;
}

const EMPTY: TreeData = {
  nodes: [],
  series: [],
  attribute: null,
  recordTitle: "",
  hasMore: false,
  tasks: [],
  responsibles: [],
  sourceKey: null,
  canConfigureSeries: false,
  geometry: [],
};

/** A árvore de um registro, já derivada na forma pedida. */
export async function loadRecordTree(
  recordId: string,
  layout: TreeLayout = "por_ocorrencia",
  window: TreeWindow = { order: "desc", limit: TREE_WINDOW_STEP }
): Promise<TreeData> {
  const session = await getSessionInfo();
  if (!session) return { ...EMPTY, message: "Sessão expirada." };
  const orgId = await getActiveOrgId();
  const supabase = await createClient();

  const [
    { data: record },
    { data: attr },
    { data: taskRows },
    { data: resps },
    sources,
  ] = await Promise.all([
    supabase
      .from("records")
      .select(
        "id, title, responsible_id, source_created_at, field_modified_at, custom_fields, record_type, stage"
      )
      .eq("id", recordId)
      .maybeSingle(),
    // Não depende do registro: pedir em paralelo tira uma ida inteira da
    // espera. Se a RLS esconder o registro, o atributo vem e é descartado.
    supabase
      .from("record_attributes")
      .select("id, status, granted_by_rule_id")
      .eq("record_id", recordId)
      .eq("attribute_key", "tree")
      .maybeSingle(),
    // v1.3: as tarefas INTEIRAS do registro. O nó guarda só o id; sem a linha
    // completa o editor não teria prazo, hora, descrição nem responsável para
    // mostrar. Mesmo recorte de `listRecordTasks` — a RLS de tasks recorta.
    supabase
      .from("tasks")
      .select(TASK_COLS_WITH_RECORD)
      .eq("record_id", recordId)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(200),
    // Precedente da agenda (lib/agenda/actions.ts): o combobox de responsável
    // do editor precisa da lista, e ela cabe nesta mesma rodada de consultas.
    supabase
      .from("responsibles")
      .select("id, display_name")
      .is("canonical_id", null)
      .eq("active", true)
      .order("display_name"),
    // v1.7: o catálogo de Bases. É dele que sai a source-key do registro — a
    // resolução por identidade (`toSourceKey`) não serve com sub-fontes na
    // jogada, e é o catálogo que sabe qual raiz tem este `record_type`.
    loadSources(supabase, orgId),
  ]);
  if (!record) {
    // Pode ser RLS (o registro existe e o usuário não o vê) — dizer "não
    // encontrado" é o mesmo dos dois lados, e é o certo: não revelamos a
    // existência de um registro que a pessoa não pode ver.
    return { ...EMPTY, message: "Registro não encontrado." };
  }

  // v1.7: as regras de série do registro. A PRIMEIRA é a que concedeu o
  // atributo (a primária, dona da janela dos fatos avulsos); as demais saem
  // das PRÓPRIAS tarefas — `record_attributes` é único por registro, então uma
  // segunda série nunca chega a ser `granted_by_rule_id`.
  const primaryRuleId = (attr?.granted_by_rule_id as string | null) ?? null;
  const ruleIds: string[] = primaryRuleId ? [primaryRuleId] : [];
  for (const t of taskRows ?? []) {
    const rid = (t as { automation_rule_id?: string | null }).automation_rule_id;
    const occ = (t as { series_occurrence?: number | null }).series_occurrence;
    if (rid && occ != null && !ruleIds.includes(rid)) ruleIds.push(rid);
  }

  const facts = await loadRecordTreeFacts(supabase, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    record: record as any,
    fieldModifiedAt:
      (record.field_modified_at as Record<string, string> | null) ?? null,
    orgId,
    ruleIds,
    todayIso: todayBrasiliaIso(),
    window,
  });

  const seriesLabels: Record<string, string> = {};
  for (const s of facts.series) seriesLabels[s.key] = s.ruleName;

  return {
    nodes: deriveTree({
      facts: facts.facts,
      layout,
      overrides: facts.overrides,
      primarySeriesKey: facts.series.find((s) => s.primary)?.key ?? null,
      seriesLabels,
    }),
    series: facts.series,
    attribute: attr
      ? { id: attr.id as string, status: attr.status as "ativo" | "pausado" }
      : null,
    recordTitle: (record.title as string) ?? "",
    hasMore: facts.hasMore,
    tasks: (taskRows ?? []) as unknown as TaskRow[],
    responsibles: (resps ?? []).map((r) => ({
      id: r.id as string,
      label: (r.display_name as string) ?? "",
    })),
    sourceKey:
      rootSources(sources).find(
        (s) => s.recordType === (record.record_type as string)
      )?.key ?? null,
    // Espelho do gate de `saveAutomation` para dono de Base (a RLS da 0127
    // segue sendo a muralha). Esconder o botão é melhor que deixá-lo falhar.
    canConfigureSeries: session.roles.includes("admin"),
    geometry: facts.geometry,
  };
}

/**
 * v1.10: um MAPA livre (escopo `livre`) — anotações e tarefas penduradas, sem
 * registro. É onde um planejamento ou uma rotina mora. Sempre na forma
 * `livre`: só o parentesco que alguém desenhou.
 */
export async function loadMapTree(mapKey: string): Promise<TreeData> {
  const session = await getSessionInfo();
  if (!session) return { ...EMPTY, message: "Sessão expirada." };
  const key = normalizeMapKey(mapKey);
  if (!key || key !== mapKey) {
    return { ...EMPTY, message: "Chave de mapa inválida." };
  }
  const orgId = await getActiveOrgId();
  const supabase = await createClient();

  const [facts, { data: resps }] = await Promise.all([
    loadMapTreeFacts(supabase, { mapKey: key, orgId }),
    supabase
      .from("responsibles")
      .select("id, display_name")
      .is("canonical_id", null)
      .eq("active", true)
      .order("display_name"),
  ]);
  const { data: taskRows } =
    facts.taskIds.length > 0
      ? await supabase
          .from("tasks")
          .select(TASK_COLS_WITH_RECORD)
          .in("id", facts.taskIds)
      : { data: [] };

  return {
    ...EMPTY,
    nodes: deriveTree({
      facts: facts.facts,
      layout: "livre",
      overrides: facts.overrides,
    }),
    tasks: (taskRows ?? []) as unknown as TaskRow[],
    responsibles: (resps ?? []).map((r) => ({
      id: r.id as string,
      label: (r.display_name as string) ?? "",
    })),
    geometry: facts.geometry,
  };
}

/**
 * Anota na árvore — pelo `createComment` de 0066, que é o dono da escrita.
 *
 * v1.5 (10/09/2026): antes esta action inseria em `comments` direto. Fazia a
 * mesma coisa, menos o `emitWebhookEvent("comment.created")` — então anotação
 * feita pela Tree não chegava a nenhum webhook, em silêncio. Dois escritores
 * para a mesma tabela é a régua paralela da invariante 25.
 */
export async function addTreeNote(
  recordId: string,
  body: string,
  opts: { revalidate?: boolean; parentRef?: string | null } = {}
): Promise<TreeActionState & { commentId?: string }> {
  const res = await createComment({ recordId }, body);
  if (!res.ok || !res.id) {
    return { ok: false, message: res.message ?? "Falha ao comentar." };
  }
  // v1.7: comentário feito EM CIMA de um nó fica pendurado nele. Sem isto, ele
  // caía na ocorrência de hoje — que é onde ele nasce, não onde foi escrito.
  // Falha aqui não desfaz o comentário: ele existe, só ficou no lugar derivado.
  if (opts.parentRef) {
    await setTreeParent(recordId, `comment:${res.id}`, opts.parentRef, {
      revalidate: false,
    });
  }
  if (opts.revalidate !== false) revalidatePath("/dashboards");
  return { ok: true, commentId: res.id };
}

/**
 * "Salvar e analisar", parte 1: abre o fio. RÁPIDO de propósito — o dock
 * precisa de algo para mostrar antes de a IA responder.
 *
 * Cascas finas, como toda action de IA do §4.17: gate, turnos, validação e
 * prévia vivem em lib/ai/analyze-comment.ts.
 */
export async function openCommentThread(
  recordId: string,
  recordTitle: string,
  comment: string
): Promise<{ ok: boolean; message?: string; thread?: CommentThread }> {
  return openCommentThreadCore({ recordId, recordTitle, comment });
}

// Parte 2 (o turno) NÃO mora aqui: é a rota `/api/tree/ai-turn`. Ver o
// cabeçalho — Server Action de 240s congela todas as outras do cliente.

/** As conversas abertas deste usuário — o dock as reencontra depois de um F5. */
export async function listCommentThreads(): Promise<CommentThread[]> {
  return listCommentThreadsCore();
}

/** Aplica a proposta da conversa. RE-VALIDA e grava pelos choke points. */
export async function applyCommentThread(
  threadId: string,
  opts: { revalidate?: boolean } = {}
): Promise<ApplyCommentTaskState> {
  const res = await applyCommentThreadCore(threadId);
  if (res.ok && opts.revalidate !== false) revalidatePath("/dashboards");
  return res;
}

/** Fecha a conversa sem aplicar nada. */
export async function dismissCommentThread(
  threadId: string
): Promise<{ ok: boolean; message?: string }> {
  return dismissCommentThreadCore(threadId);
}

/**
 * Exclui um nó LIVRE da árvore (a nota do mapa mental).
 *
 * Só nó livre: tarefa se exclui pelo `deleteTask` e anotação pelo
 * `deleteComment` — os dois já existem e já têm a RLS certa. Aqui a linha de
 * `tree_nodes` É o nó, então apagá-la é a exclusão inteira.
 *
 * O `node_ref` (a EXCEÇÃO de parentesco) NÃO é apagado por aqui: ele não é um
 * nó, é um ajuste sobre um fato que continua existindo.
 */
export async function deleteTreeNode(
  nodeId: string,
  opts: { revalidate?: boolean } = {}
): Promise<TreeActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };

  const supabase = await createClient();
  // `.select()` no delete: sem linha devolvida = a RLS da 0133 barrou.
  const { data, error } = await supabase
    .from("tree_nodes")
    .delete()
    .eq("id", nodeId)
    .is("node_ref", null)
    .select("id");
  if (error) return { ok: false, message: `Falha ao excluir: ${error.message}` };
  if (!data || data.length === 0) {
    return { ok: false, message: "Sem permissão para excluir este nó." };
  }
  if (opts.revalidate !== false) revalidatePath("/dashboards");
  return { ok: true };
}

// v1.3 (09/09/2026): `addTreeTask` SAIU. Ela inseria em `tasks` por fora do
// choke point, e por isso só sabia gravar título, prazo e responsável — nem
// hora, nem descrição, nem fase. A Tree passou a abrir o editor de tarefa do
// app (TaskSheet → createTask), que é o dono único da criação; manter as duas
// seria a régua paralela que a invariante 25 proíbe.

/**
 * Exclui vários nós LIVRES de uma vez.
 *
 * Só nó livre, como no unitário: tarefa sai por `deleteTasksBulk` e anotação
 * por `deleteCommentsBulk`. O `.is("node_ref", null)` mantém a exceção de
 * parentesco fora do alcance — ela é um ajuste sobre um fato que continua
 * existindo, não um nó que alguém criou.
 */
export async function deleteTreeNodesBulk(
  nodeIds: string[],
  opts: { revalidate?: boolean } = {}
): Promise<BulkActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const ids = [...new Set(nodeIds)].filter(Boolean);
  if (ids.length === 0) return { ok: true, results: [] };
  if (ids.length > BULK_MAX_ITEMS) {
    return { ok: false, message: `Máximo de ${BULK_MAX_ITEMS} por chamada.` };
  }

  const supabase = await createClient();
  const results: BulkItemResult[] = [];
  for (const slice of chunk(ids, BULK_MAX_ITEMS)) {
    const { data, error } = await supabase
      .from("tree_nodes")
      .delete()
      .in("id", slice)
      .is("node_ref", null)
      .select("id");
    if (error) {
      results.push(...fanOut(slice, false, error.message));
      continue;
    }
    results.push(
      ...resultsFromReturned(
        slice,
        (data ?? []).map((n) => n.id as string),
        "Sem permissão para excluir este nó."
      )
    );
  }
  if (opts.revalidate !== false) revalidatePath("/dashboards");
  return { ok: true, results };
}

/**
 * Re-pendura um nó (ou o solta na raiz). Grava a EXCEÇÃO, não a árvore inteira:
 * o resto continua derivado, e desfazer é apagar a linha.
 *
 * v1.10: casca de `setTreeNodeParent` no escopo de registro — quem já chamava
 * esta (o "Comentar aqui") segue igual.
 */
export async function setTreeParent(
  recordId: string,
  nodeRef: string,
  parentRef: string | null,
  opts: { revalidate?: boolean } = {}
): Promise<TreeActionState> {
  return setTreeNodeParent({ kind: "record", recordId }, nodeRef, parentRef, opts);
}

/** Limites de texto da anotação. */
const NOTE_LABEL_MAX = 200;
const NOTE_BODY_MAX = 4000;
/** Teto do offset gravado — muito além de qualquer canvas real. */
const OFFSET_MAX = 100_000;

/**
 * O contexto comum das escritas em `tree_nodes`: sessão, org e o escopo
 * validado. No escopo de REGISTRO confere que a pessoa VÊ o registro — o WITH
 * CHECK da 0133 aceita `created_by = uid` em qualquer `scope_id`, e sem isto
 * daria para pendurar nó na árvore de um registro invisível.
 */
async function treeWriteContext(scopeRaw: unknown): Promise<
  | {
      ok: true;
      userId: string;
      orgId: string;
      scope: TreeScope;
      supabase: Awaited<ReturnType<typeof createClient>>;
    }
  | { ok: false; message: string }
> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, message: "Organização ativa não identificada." };
  const scope = parseTreeScope(scopeRaw);
  if (!scope) return { ok: false, message: "Árvore inválida." };
  const supabase = await createClient();
  if (scope.kind === "record") {
    const { data } = await supabase
      .from("records")
      .select("id")
      .eq("id", scope.recordId)
      .maybeSingle();
    if (!data) return { ok: false, message: "Registro não encontrado." };
  }
  return { ok: true, userId: session.user.id, orgId, scope, supabase };
}

function scopeColumns(scope: TreeScope): { scope_kind: string; scope_id: string } {
  return scope.kind === "record"
    ? { scope_kind: "record", scope_id: scope.recordId }
    : { scope_kind: "livre", scope_id: scope.mapKey };
}

/**
 * Onde mora a linha de um nó: a PRÓPRIA (anotação; tarefa de mapa) ou a
 * EXCEÇÃO `node_ref` (fato derivado — só no escopo de registro).
 */
type NodeRowTarget =
  | { kind: "note"; id: string }
  | { kind: "map_task"; taskId: string }
  | { kind: "override" }
  | { kind: "invalid"; message: string };

function nodeRowTarget(scope: TreeScope, nodeRef: string): NodeRowTarget {
  const noteId = refUuid(nodeRef, "note");
  if (noteId) return { kind: "note", id: noteId };
  if (scope.kind === "livre") {
    const taskId = refUuid(nodeRef, "task");
    if (taskId) return { kind: "map_task", taskId };
    return { kind: "invalid", message: "Este nó não pertence ao mapa." };
  }
  if (nodeRef.startsWith("series:") || nodeRef.startsWith("kind:")) {
    // O agrupador é sintético: não é fato de ninguém, e pendurá-lo sob outro
    // nó mudaria o desenho de todos os troncos de uma vez.
    return { kind: "invalid", message: "O agrupador não pode ser movido." };
  }
  return { kind: "override" };
}

/**
 * Aplica colunas à linha do nó. Na exceção, ATUALIZA quando existe e INSERE
 * quando não — um upsert sobrescreveria o `created_by` de quem a criou (e a
 * RLS do escopo livre é por autor). Sem linha devolvida = a RLS barrou.
 */
async function writeNodeRow(
  ctx: {
    userId: string;
    orgId: string;
    scope: TreeScope;
    supabase: Awaited<ReturnType<typeof createClient>>;
  },
  nodeRef: string,
  cols: Record<string, unknown>
): Promise<TreeActionState> {
  const target = nodeRowTarget(ctx.scope, nodeRef);
  if (target.kind === "invalid") return { ok: false, message: target.message };
  const where = scopeColumns(ctx.scope);
  const denied = { ok: false, message: "Sem permissão para alterar este nó." };

  if (target.kind === "note" || target.kind === "map_task") {
    let q = ctx.supabase
      .from("tree_nodes")
      .update(cols)
      .eq("scope_kind", where.scope_kind)
      .eq("scope_id", where.scope_id)
      .is("node_ref", null);
    q =
      target.kind === "note"
        ? q.eq("id", target.id).eq("kind", "note")
        : q.eq("ref_id", target.taskId).eq("kind", "task");
    const { data, error } = await q.select("id");
    if (error) return { ok: false, message: `Falha ao salvar: ${error.message}` };
    return data && data.length > 0 ? { ok: true } : denied;
  }

  const { data: updated, error: updError } = await ctx.supabase
    .from("tree_nodes")
    .update(cols)
    .eq("scope_kind", where.scope_kind)
    .eq("scope_id", where.scope_id)
    .eq("node_ref", nodeRef)
    .select("id");
  if (updError) return { ok: false, message: `Falha ao salvar: ${updError.message}` };
  if (updated && updated.length > 0) return { ok: true };
  const { error } = await ctx.supabase.from("tree_nodes").insert({
    organization_id: ctx.orgId,
    ...where,
    kind: "note",
    node_ref: nodeRef,
    created_by: ctx.userId,
    ...cols,
  });
  if (error) {
    // 23505: a exceção existe e a RLS escondeu a linha do UPDATE acima.
    return error.code === "23505"
      ? denied
      : { ok: false, message: `Falha ao salvar: ${error.message}` };
  }
  return { ok: true };
}

/**
 * v1.10: re-pendura um nó — dono ÚNICO, nas duas árvores. Zera o offset: o
 * slot mudou, e o deslocamento que fazia sentido no pai antigo jogaria o nó
 * num lugar aleatório do novo.
 */
export async function setTreeNodeParent(
  scopeRaw: TreeScope,
  nodeRef: string,
  parentRef: string | null,
  opts: { revalidate?: boolean } = {}
): Promise<TreeActionState> {
  if (!isTreeNodeRef(nodeRef) || (parentRef != null && !isTreeNodeRef(parentRef))) {
    return { ok: false, message: "Nó inválido." };
  }
  if (parentRef === nodeRef) {
    return { ok: false, message: "Um nó não pode pender de si mesmo." };
  }
  if (parentRef?.startsWith("series:") || parentRef?.startsWith("kind:")) {
    return { ok: false, message: "O agrupador não recebe galhos." };
  }
  const ctx = await treeWriteContext(scopeRaw);
  if (!ctx.ok) return { ok: false, message: ctx.message };
  const res = await writeNodeRow(ctx, nodeRef, {
    parent_ref: parentRef ?? "-",
    offset_x: null,
    offset_y: null,
  });
  if (res.ok && opts.revalidate !== false) revalidatePath("/dashboards");
  return res;
}

/**
 * v1.10: a geometria de um nó na Root — o arrasto para o vazio (offset
 * relativo ao slot) e/ou a direção em que o galho abre. Só as chaves
 * PRESENTES são gravadas: mudar a direção não mexe no offset, e nenhuma das
 * duas mexe no pai.
 */
export async function setTreeNodeGeometry(
  scopeRaw: TreeScope,
  nodeRef: string,
  patch: {
    offsetX?: number | null;
    offsetY?: number | null;
    direction?: TreeDirection | null;
  },
  opts: { revalidate?: boolean } = {}
): Promise<TreeActionState> {
  if (!isTreeNodeRef(nodeRef)) return { ok: false, message: "Nó inválido." };
  const cols: Record<string, unknown> = {};
  const offset = (v: number | null | undefined) => {
    if (v == null) return null;
    if (!Number.isFinite(v)) return undefined;
    return Math.round(Math.max(-OFFSET_MAX, Math.min(OFFSET_MAX, v)) * 10) / 10;
  };
  for (const [key, col] of [
    ["offsetX", "offset_x"],
    ["offsetY", "offset_y"],
  ] as const) {
    if (!(key in patch)) continue;
    const v = offset(patch[key]);
    if (v === undefined) return { ok: false, message: "Posição inválida." };
    cols[col] = v;
  }
  if ("direction" in patch) {
    const d = patch.direction;
    if (d != null && d !== "h" && d !== "v") {
      return { ok: false, message: "Direção inválida." };
    }
    cols.direction = d ?? null;
  }
  if (Object.keys(cols).length === 0) return { ok: true };
  const ctx = await treeWriteContext(scopeRaw);
  if (!ctx.ok) return { ok: false, message: ctx.message };
  const res = await writeNodeRow(ctx, nodeRef, cols);
  if (res.ok && opts.revalidate !== false) revalidatePath("/dashboards");
  return res;
}

/** O estado de uma anotação: texto livre, etapa aberta ou etapa concluída. */
export type TreeNoteStatus = "texto" | "pendente" | "concluida";

/**
 * v1.10: cria uma ANOTAÇÃO — o galho que pertence à própria Tree (o
 * comentário vai para o feed do registro; a anotação, não). `parentRef` null =
 * raiz explícita ('-'), para ela não cair na ocorrência de hoje.
 */
export async function createTreeNote(
  scopeRaw: TreeScope,
  input: {
    parentRef: string | null;
    label: string;
    body?: string | null;
    status?: TreeNoteStatus;
    goal?: boolean;
  },
  opts: { revalidate?: boolean } = {}
): Promise<TreeActionState & { nodeId?: string }> {
  const label = String(input.label ?? "").trim().slice(0, NOTE_LABEL_MAX);
  if (!label) return { ok: false, message: "Escreva a anotação." };
  if (input.parentRef != null && !isTreeNodeRef(input.parentRef)) {
    return { ok: false, message: "Nó inválido." };
  }
  if (
    input.parentRef?.startsWith("series:") ||
    input.parentRef?.startsWith("kind:")
  ) {
    return { ok: false, message: "O agrupador não recebe galhos." };
  }
  const ctx = await treeWriteContext(scopeRaw);
  if (!ctx.ok) return { ok: false, message: ctx.message };
  const body = input.body ? String(input.body).slice(0, NOTE_BODY_MAX) : null;
  const { data, error } = await ctx.supabase
    .from("tree_nodes")
    .insert({
      organization_id: ctx.orgId,
      ...scopeColumns(ctx.scope),
      kind: "note",
      parent_ref: input.parentRef ?? "-",
      label,
      body,
      status:
        input.status === "pendente" || input.status === "concluida"
          ? input.status
          : null,
      is_goal: input.goal === true,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, message: `Falha ao criar a anotação: ${error?.message ?? ""}` };
  }
  if (opts.revalidate !== false) revalidatePath("/dashboards");
  return { ok: true, nodeId: `note:${data.id as string}` };
}

/** v1.10: edita a anotação — texto, estado (etapa) e o marcador de Resultado. */
export async function updateTreeNote(
  noteId: string,
  patch: {
    label?: string;
    body?: string | null;
    status?: TreeNoteStatus;
    goal?: boolean;
  },
  opts: { revalidate?: boolean } = {}
): Promise<TreeActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!refUuid(`note:${noteId}`, "note")) {
    return { ok: false, message: "Anotação inválida." };
  }
  const cols: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    const label = String(patch.label).trim().slice(0, NOTE_LABEL_MAX);
    if (!label) return { ok: false, message: "A anotação não pode ficar vazia." };
    cols.label = label;
  }
  if (patch.body !== undefined) {
    cols.body = patch.body ? String(patch.body).slice(0, NOTE_BODY_MAX) : null;
  }
  if (patch.status !== undefined) {
    cols.status = patch.status === "texto" ? null : patch.status;
  }
  if (patch.goal !== undefined) cols.is_goal = patch.goal === true;
  if (Object.keys(cols).length === 0) return { ok: true };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tree_nodes")
    .update(cols)
    .eq("id", noteId)
    .eq("kind", "note")
    .is("node_ref", null)
    .select("id");
  if (error) return { ok: false, message: `Falha ao salvar: ${error.message}` };
  if (!data || data.length === 0) {
    return { ok: false, message: "Sem permissão para alterar esta anotação." };
  }
  if (opts.revalidate !== false) revalidatePath("/dashboards");
  return { ok: true };
}

/**
 * v1.10: pendura num MAPA livre a tarefa que o editor de sempre acabou de
 * criar (TaskSheet → createTask, o choke point). No registro não há o que
 * fazer aqui: a tarefa já é fato dele, e quem a pendura é `setTreeNodeParent`.
 * Repetir é no-op (uma vez por mapa — `uq_tree_nodes_map_task`).
 */
export async function attachTaskToMap(
  mapKey: string,
  taskId: string,
  parentRef: string | null,
  opts: { revalidate?: boolean } = {}
): Promise<TreeActionState> {
  if (!refUuid(`task:${taskId}`, "task")) {
    return { ok: false, message: "Tarefa inválida." };
  }
  if (parentRef != null && !isTreeNodeRef(parentRef)) {
    return { ok: false, message: "Nó inválido." };
  }
  const ctx = await treeWriteContext({ kind: "livre", mapKey });
  if (!ctx.ok) return { ok: false, message: ctx.message };
  const { error } = await ctx.supabase.from("tree_nodes").insert({
    organization_id: ctx.orgId,
    ...scopeColumns(ctx.scope),
    kind: "task",
    ref_id: taskId,
    parent_ref: parentRef ?? "-",
    created_by: ctx.userId,
  });
  if (error && error.code !== "23505") {
    return { ok: false, message: `Falha ao pendurar a tarefa: ${error.message}` };
  }
  if (opts.revalidate !== false) revalidatePath("/dashboards");
  return { ok: true };
}

/**
 * Muda a cadência DESTE registro. Grava uma exceção em `series_settings` — a
 * definição da regra não é tocada, e um gestor faz isso sem abrir o construtor.
 */
export async function setRecordCadence(
  seriesKey: string,
  recordId: string,
  cadenceDays: number | null,
  opts: { revalidate?: boolean } = {}
): Promise<TreeActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, message: "Organização ativa não identificada." };
  if (cadenceDays != null && (cadenceDays < 1 || cadenceDays > 365)) {
    return { ok: false, message: "A cadência precisa estar entre 1 e 365 dias." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("series_settings").upsert(
    {
      organization_id: orgId,
      series_key: seriesKey,
      scope_kind: "record",
      scope_value: recordId,
      cadence_days: cadenceDays,
      updated_by: session.user.id,
    },
    { onConflict: "organization_id,series_key,scope_kind,scope_value" }
  );
  if (error) {
    // A RLS da 0132 é admin/gestor: mudar a cadência de uma série é decisão
    // de quem conduz o acompanhamento, não de quem executa.
    return {
      ok: false,
      message: `Não foi possível alterar a cadência: ${error.message}`,
    };
  }
  if (opts.revalidate !== false) revalidatePath("/dashboards");
  return { ok: true };
}

/**
 * v1.11 (01/10/2026): converte uma ANOTAÇÃO em comentário (feed do registro) ou
 * tarefa. A branch nasce como anotação e o clique direito decide o que ela é.
 *
 * Ordem deliberada, sem transação:
 *  1. cria o item pelo choke point (`createComment`/`createTask`);
 *  2. pendura o item no MESMO pai, com a mesma geometria;
 *  3. re-pendura os FILHOS da anotação no item novo;
 *  4. apaga a anotação — por último: se algo falhar antes, nada se perde
 *     (no pior caso a anotação fica ao lado do item novo).
 */
export async function convertTreeNote(
  scopeRaw: TreeScope,
  noteId: string,
  to: "comment" | "task",
  opts: { revalidate?: boolean } = {}
): Promise<TreeActionState & { nodeId?: string }> {
  if (!refUuid(`note:${noteId}`, "note")) {
    return { ok: false, message: "Anotação inválida." };
  }
  if (to !== "comment" && to !== "task") {
    return { ok: false, message: "Tipo inválido." };
  }
  const ctx = await treeWriteContext(scopeRaw);
  if (!ctx.ok) return { ok: false, message: ctx.message };
  if (to === "comment") {
    const reason = branchKindDisabledReason("comment", ctx.scope.kind);
    if (reason) return { ok: false, message: reason };
  }
  const where = scopeColumns(ctx.scope);
  const { data: row } = await ctx.supabase
    .from("tree_nodes")
    .select("id, label, body, parent_ref, offset_x, offset_y, direction")
    .eq("id", noteId)
    .eq("kind", "note")
    .is("node_ref", null)
    .eq("scope_kind", where.scope_kind)
    .eq("scope_id", where.scope_id)
    .maybeSingle();
  if (!row) return { ok: false, message: "Anotação não encontrada." };

  const label = String(row.label ?? "").trim();
  const body = String(row.body ?? "").trim();
  const recordId = ctx.scope.kind === "record" ? ctx.scope.recordId : null;

  // 1. o item, pelo dono dele.
  let newRef: string;
  if (to === "comment") {
    const res = await createComment(
      { recordId: recordId! },
      body ? `${label}\n\n${body}` : label
    );
    if (!res.ok || !res.id) {
      return { ok: false, message: res.message ?? "Falha ao criar o comentário." };
    }
    newRef = `comment:${res.id}`;
  } else {
    const fd = new FormData();
    fd.set("title", label || "Tarefa");
    if (body) fd.set("description", body);
    if (recordId) {
      fd.set("record_id", recordId);
      // Responsável padrão = o DO REGISTRO (precedente do create_task, 0129).
      const { data: rec } = await ctx.supabase
        .from("records")
        .select("responsible_id")
        .eq("id", recordId)
        .maybeSingle();
      const resp = (rec?.responsible_id as string | null) ?? null;
      if (resp) fd.set("responsible_id", resp);
    }
    const res = await createTask({}, fd);
    if (!res.ok || !res.id) {
      return { ok: false, message: res.message ?? "Falha ao criar a tarefa." };
    }
    newRef = `task:${res.id}`;
  }

  // 2. no mesmo lugar da anotação.
  const placement: Record<string, unknown> = {
    offset_x: row.offset_x ?? null,
    offset_y: row.offset_y ?? null,
    direction: row.direction ?? null,
  };
  if (ctx.scope.kind === "livre") {
    const { error } = await ctx.supabase.from("tree_nodes").insert({
      organization_id: ctx.orgId,
      ...where,
      kind: "task",
      ref_id: newRef.slice("task:".length),
      parent_ref: row.parent_ref ?? "-",
      created_by: ctx.userId,
      ...placement,
    });
    if (error && error.code !== "23505") {
      return { ok: false, message: `Item criado, mas não foi possível posicioná-lo: ${error.message}` };
    }
  } else {
    const res = await writeNodeRow(ctx, newRef, {
      // null = segue a forma (a anotação também seguia); '-' = raiz explícita.
      parent_ref: row.parent_ref ?? null,
      ...placement,
    });
    if (!res.ok) {
      return { ok: false, message: `Item criado, mas não foi possível posicioná-lo: ${res.message}` };
    }
  }

  // 3. os filhos vão junto — as duas formas de linha (anotação e exceção).
  await ctx.supabase
    .from("tree_nodes")
    .update({ parent_ref: newRef })
    .eq("scope_kind", where.scope_kind)
    .eq("scope_id", where.scope_id)
    .eq("parent_ref", `note:${noteId}`);

  // 4. a anotação sai por último.
  await ctx.supabase
    .from("tree_nodes")
    .delete()
    .eq("id", noteId)
    .is("node_ref", null);

  if (opts.revalidate !== false) revalidatePath("/dashboards");
  return { ok: true, nodeId: newRef };
}
