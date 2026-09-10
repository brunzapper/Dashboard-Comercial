// Versão: 1.5 | Data: 10/09/2026
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
import { deriveTree } from "@/lib/tree/derive";
import { loadRecordTreeFacts } from "@/lib/tree/load";
import { TREE_WINDOW_STEP, type TreeWindow } from "@/lib/tree/load";
import type { TreeLayout, TreeNode } from "@/lib/tree/model";
import { TASK_COLS_WITH_RECORD, type TaskRow } from "@/lib/tasks/types";
import type { OptionItem } from "@/lib/records/types";

export interface TreeActionState {
  ok?: boolean;
  message?: string;
}

export interface TreeData {
  nodes: TreeNode[];
  series: {
    key: string;
    cadenceDays: number;
    active: boolean;
    anchorDate: string | null;
  } | null;
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
  message?: string;
}

const EMPTY: TreeData = {
  nodes: [],
  series: null,
  attribute: null,
  recordTitle: "",
  hasMore: false,
  tasks: [],
  responsibles: [],
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

  const [{ data: record }, { data: attr }, { data: taskRows }, { data: resps }] =
    await Promise.all([
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
    ]);
  if (!record) {
    // Pode ser RLS (o registro existe e o usuário não o vê) — dizer "não
    // encontrado" é o mesmo dos dois lados, e é o certo: não revelamos a
    // existência de um registro que a pessoa não pode ver.
    return { ...EMPTY, message: "Registro não encontrado." };
  }

  const facts = await loadRecordTreeFacts(supabase, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    record: record as any,
    fieldModifiedAt:
      (record.field_modified_at as Record<string, string> | null) ?? null,
    orgId,
    ruleId: (attr?.granted_by_rule_id as string | null) ?? null,
    todayIso: todayBrasiliaIso(),
    window,
  });

  return {
    nodes: deriveTree({ facts: facts.facts, layout, overrides: facts.overrides }),
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
  opts: { revalidate?: boolean } = {}
): Promise<TreeActionState> {
  const res = await createComment({ recordId }, body);
  if (!res.ok) {
    return { ok: false, message: res.message ?? "Falha ao anotar." };
  }
  if (opts.revalidate !== false) revalidatePath("/dashboards");
  return { ok: true };
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
 * Re-pendura um nó (ou o solta na raiz). Grava a EXCEÇÃO, não a árvore inteira:
 * o resto continua derivado, e desfazer é apagar a linha.
 */
export async function setTreeParent(
  recordId: string,
  nodeRef: string,
  parentRef: string | null,
  opts: { revalidate?: boolean } = {}
): Promise<TreeActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const orgId = await getActiveOrgId();
  if (!orgId) return { ok: false, message: "Organização ativa não identificada." };

  const supabase = await createClient();
  const { error } = await supabase.from("tree_nodes").upsert(
    {
      organization_id: orgId,
      scope_kind: "record",
      scope_id: recordId,
      kind: "note",
      node_ref: nodeRef,
      // "-" é o soltar na raiz; null seria "sem exceção".
      parent_ref: parentRef ?? "-",
      created_by: session.user.id,
    },
    { onConflict: "scope_kind,scope_id,node_ref" }
  );
  if (error) return { ok: false, message: `Falha ao mover: ${error.message}` };
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
