// Versão: 1.0 | Data: 17/07/2026
// Server Actions de COMENTÁRIOS (tabela comments, 0066) e do FEED dos cards.
// Gravação com o client do usuário — a RLS decide visibilidade (transitiva ao
// registro/tarefa pai) e edição/exclusão (autor ou admin/gestor). `.select`
// vazio após update/delete = negado por RLS (mesmo padrão de lib/tasks).
// O feed mescla comentários + tarefas do registro (ou subtarefas + comentários
// da tarefa): fixados no topo, depois posição fracionária, depois mais novo.
"use server";

import { getSessionInfo } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/auth/org";
import { createClient } from "@/lib/supabase/server";
import { emitWebhookEvent } from "@/lib/webhooks/emit";
import { TASK_COLS_WITH_RECORD, type TaskRow } from "@/lib/tasks/types";
import {
  COMMENT_COLS,
  type CommentRow,
  type FeedItem,
  type FeedTarget,
} from "./types";

export interface CommentActionState {
  ok?: boolean;
  message?: string;
  id?: string;
}

function cleanBody(v: string): string {
  return v.trim().slice(0, 4000);
}

/** Cria um comentário no registro ou na tarefa (nasce no topo do feed). */
export async function createComment(
  target: FeedTarget,
  body: string
): Promise<CommentActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const text = cleanBody(body);
  if (!text) return { ok: false, message: "Escreva o comentário." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("comments")
    .insert({
      record_id: "recordId" in target ? target.recordId : null,
      task_id: "taskId" in target ? target.taskId : null,
      body: text,
      created_by: session.user.id,
      // Fracionária: novos no topo (ordenamos por position ASC).
      position: -Date.now(),
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: `Falha ao comentar: ${error.message}` };
  await emitWebhookEvent(
    "comment.created",
    {
      commentId: data.id as string,
      recordId: "recordId" in target ? target.recordId : null,
      taskId: "taskId" in target ? target.taskId : null,
    },
    await getActiveOrgId()
  );
  return { ok: true, id: data.id as string };
}

/** Edita o corpo (autor ou admin/gestor — RLS). */
export async function updateComment(
  id: string,
  body: string
): Promise<CommentActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const text = cleanBody(body);
  if (!text) return { ok: false, message: "Escreva o comentário." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("comments")
    .update({ body: text })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) {
    return { ok: false, message: "Sem permissão para editar este comentário." };
  }
  await emitWebhookEvent("comment.updated", { commentId: id }, await getActiveOrgId());
  return { ok: true };
}

export async function deleteComment(id: string): Promise<CommentActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("comments")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) {
    return { ok: false, message: "Sem permissão para excluir este comentário." };
  }
  await emitWebhookEvent("comment.deleted", { commentId: id }, await getActiveOrgId());
  return { ok: true };
}

export async function setCommentPinned(
  id: string,
  pinned: boolean
): Promise<CommentActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("comments")
    .update({ pinned })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) {
    return { ok: false, message: "Sem permissão para fixar este comentário." };
  }
  return { ok: true };
}

/** Reordena no feed (posição fracionária calculada no client). */
export async function setCommentPosition(
  id: string,
  position: number
): Promise<CommentActionState> {
  const session = await getSessionInfo();
  if (!session) return { ok: false, message: "Sessão expirada." };
  if (!Number.isFinite(position)) return { ok: false, message: "Posição inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("comments")
    .update({ position })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) {
    return { ok: false, message: "Sem permissão para mover este comentário." };
  }
  return { ok: true };
}

// Posição efetiva no feed: tarefas usam feed_position (0 = nunca reordenada →
// cai na ordem de criação, mais novas primeiro, igual aos comentários novos).
function taskFeedPosition(t: TaskRow): number {
  if (t.feed_position !== 0) return t.feed_position;
  const ts = Date.parse(t.created_at);
  return Number.isFinite(ts) ? -ts : 0;
}

function sortFeed(items: FeedItem[]): FeedItem[] {
  return items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.position !== b.position) return a.position - b.position;
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  });
}

/**
 * Feed de um card: registro → tarefas diretas (sem subtarefas) + comentários;
 * tarefa → subtarefas + comentários. RLS escopa os dois lados.
 */
export async function fetchFeed(target: FeedTarget): Promise<FeedItem[]> {
  const session = await getSessionInfo();
  if (!session) return [];
  const supabase = await createClient();

  let tasksQuery = supabase.from("tasks").select(TASK_COLS_WITH_RECORD);
  tasksQuery =
    "recordId" in target
      ? tasksQuery.eq("record_id", target.recordId).is("parent_task_id", null)
      : tasksQuery.eq("parent_task_id", target.taskId);

  let commentsQuery = supabase.from("comments").select(COMMENT_COLS);
  commentsQuery =
    "recordId" in target
      ? commentsQuery.eq("record_id", target.recordId)
      : commentsQuery.eq("task_id", target.taskId);

  const [{ data: tasks }, { data: comments }] = await Promise.all([
    tasksQuery.limit(200),
    commentsQuery.limit(200),
  ]);

  const taskRows = (tasks ?? []) as unknown as TaskRow[];
  const commentRows = (comments ?? []) as unknown as CommentRow[];

  // Autores: created_by → display_name do responsável vinculado ao usuário.
  const userIds = [
    ...new Set(
      [...taskRows, ...commentRows]
        .map((r) => r.created_by)
        .filter((v): v is string => Boolean(v))
    ),
  ];
  const authorByUser = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: authors } = await supabase
      .from("responsibles")
      .select("user_id, display_name")
      .in("user_id", userIds);
    for (const a of authors ?? []) {
      if (a.user_id) authorByUser.set(a.user_id as string, a.display_name as string);
    }
  }
  const label = (userId: string | null) =>
    (userId ? authorByUser.get(userId) : null) ?? null;

  const items: FeedItem[] = [
    ...taskRows.map(
      (t): FeedItem => ({
        kind: "task",
        id: t.id,
        pinned: t.pinned,
        position: taskFeedPosition(t),
        createdAt: t.created_at,
        task: t,
        authorLabel: label(t.created_by),
      })
    ),
    ...commentRows.map(
      (c): FeedItem => ({
        kind: "comment",
        id: c.id,
        pinned: c.pinned,
        position: c.position,
        createdAt: c.created_at,
        comment: c,
        authorLabel: label(c.created_by),
        own: c.created_by === session.user.id,
      })
    ),
  ];
  return sortFeed(items);
}
