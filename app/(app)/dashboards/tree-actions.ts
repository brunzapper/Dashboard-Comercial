// Versão: 1.0 | Data: 09/09/2026
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
import { deriveTree } from "@/lib/tree/derive";
import { loadRecordTreeFacts } from "@/lib/tree/load";
import type { TreeLayout, TreeNode } from "@/lib/tree/model";

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
  message?: string;
}

const EMPTY: TreeData = {
  nodes: [],
  series: null,
  attribute: null,
  recordTitle: "",
};

/** A árvore de um registro, já derivada na forma pedida. */
export async function loadRecordTree(
  recordId: string,
  layout: TreeLayout = "por_ocorrencia"
): Promise<TreeData> {
  const session = await getSessionInfo();
  if (!session) return { ...EMPTY, message: "Sessão expirada." };
  const orgId = await getActiveOrgId();
  const supabase = await createClient();

  const { data: record } = await supabase
    .from("records")
    .select("id, title, responsible_id, source_created_at, field_modified_at, custom_fields, record_type, stage")
    .eq("id", recordId)
    .maybeSingle();
  if (!record) {
    // Pode ser RLS (o registro existe e o usuário não o vê) — dizer "não
    // encontrado" é o mesmo dos dois lados, e é o certo: não revelamos a
    // existência de um registro que a pessoa não pode ver.
    return { ...EMPTY, message: "Registro não encontrado." };
  }

  const { data: attr } = await supabase
    .from("record_attributes")
    .select("id, status, granted_by_rule_id")
    .eq("record_id", recordId)
    .eq("attribute_key", "tree")
    .maybeSingle();

  const facts = await loadRecordTreeFacts(supabase, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    record: record as any,
    fieldModifiedAt:
      (record.field_modified_at as Record<string, string> | null) ?? null,
    orgId,
    ruleId: (attr?.granted_by_rule_id as string | null) ?? null,
    todayIso: todayBrasiliaIso(),
  });

  return {
    nodes: deriveTree({ facts: facts.facts, layout, overrides: facts.overrides }),
    series: facts.series,
    attribute: attr
      ? { id: attr.id as string, status: attr.status as "ativo" | "pausado" }
      : null,
    recordTitle: (record.title as string) ?? "",
  };
}

/** Anota na árvore — grava em `comments`, o feed que já existe (0066). */
export async function addTreeNote(
  recordId: string,
  body: string,
  opts: { revalidate?: boolean } = {}
): Promise<TreeActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const text = body.trim();
  if (text === "") return { ok: false, message: "Escreva a anotação." };

  const supabase = await createClient();
  const { error } = await supabase.from("comments").insert({
    record_id: recordId,
    body: text,
    created_by: session.user.id,
    position: -Date.now(),
  });
  if (error) return { ok: false, message: `Falha ao anotar: ${error.message}` };
  if (opts.revalidate !== false) revalidatePath("/dashboards");
  return { ok: true };
}

/**
 * Agenda uma tarefa manual dentro da árvore. Sem `series_occurrence`: ela é
 * uma ação do vendedor, não uma cobrança da automação — e é justamente a
 * diferença entre as duas que a árvore mostra.
 */
export async function addTreeTask(
  recordId: string,
  input: { title: string; dueDate?: string | null },
  opts: { revalidate?: boolean } = {}
): Promise<TreeActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const title = input.title.trim();
  if (title === "") return { ok: false, message: "Dê um título à tarefa." };
  const orgId = await getActiveOrgId();

  const supabase = await createClient();
  // O responsável é o DO REGISTRO: a tarefa nasce com quem conduz o
  // acompanhamento, não com quem clicou.
  const { data: record } = await supabase
    .from("records")
    .select("responsible_id")
    .eq("id", recordId)
    .maybeSingle();

  const row: Record<string, unknown> = {
    title,
    record_id: recordId,
    due_date: input.dueDate || null,
    responsible_id: (record?.responsible_id as string | null) ?? null,
    created_by: session.user.id,
  };
  if (orgId) row.organization_id = orgId;

  const { error } = await supabase.from("tasks").insert(row);
  if (error) return { ok: false, message: `Falha ao agendar: ${error.message}` };
  if (opts.revalidate !== false) revalidatePath("/dashboards");
  return { ok: true };
}

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
    // A RLS da 0132 é admin/gestor: mudar a cadência de uma cobrança é decisão
    // de quem conduz o acompanhamento, não de quem é cobrado.
    return {
      ok: false,
      message: `Não foi possível alterar a cadência: ${error.message}`,
    };
  }
  if (opts.revalidate !== false) revalidatePath("/dashboards");
  return { ok: true };
}
