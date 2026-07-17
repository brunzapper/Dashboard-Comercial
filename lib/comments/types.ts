// Versão: 1.0 | Data: 17/07/2026
// Tipos de COMENTÁRIOS (tabela comments, 0066): vinculados a UM registro OU
// UMA tarefa (feed dos cards do kanban). Visibilidade transitiva ao pai via
// RLS; editar/fixar/excluir = autor ou admin/gestor. `position` é ordenação
// fracionária no feed (novo = -Date.now(), topo) e `pinned` fixa no topo.

export interface CommentRow {
  id: string;
  record_id: string | null;
  task_id: string | null;
  body: string;
  pinned: boolean;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Resolvido no fetch (responsibles.user_id → display); null = "Usuário".
  author_label?: string | null;
  // true = o usuário logado é o autor (edição/exclusão no client).
  own?: boolean;
}

export const COMMENT_COLS =
  "id, record_id, task_id, body, pinned, position, created_by, created_at, updated_at";

/** Alvo de um feed: registro ou tarefa. */
export type FeedTarget = { recordId: string } | { taskId: string };

/** Item do feed mesclado (tarefas/subtarefas + comentários). */
export type FeedItem =
  | {
      kind: "task";
      id: string;
      pinned: boolean;
      position: number;
      createdAt: string;
      task: import("@/lib/tasks/types").TaskRow;
      authorLabel: string | null;
    }
  | {
      kind: "comment";
      id: string;
      pinned: boolean;
      position: number;
      createdAt: string;
      comment: CommentRow;
      authorLabel: string | null;
      own: boolean;
    };
