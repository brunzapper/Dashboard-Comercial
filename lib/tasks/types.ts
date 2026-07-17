// Versão: 1.1 | Data: 17/07/2026
// Tipos de TAREFAS (tabela tasks, 0063). Uma tarefa pode ser standalone,
// vinculada a um registro (record_id) e/ou a um kanban de tarefas (board_id;
// `phase` é a key da coluna). Visibilidade via RLS: view_all_records OU
// criador OU responsável vinculado ao usuário (vendedor só vê as suas).
// v1.1 (17/07/2026, 0066): parent_task_id (subtarefa — vive no feed do pai,
//   não vira card), pinned/feed_position (feed dos cards; `position` segue
//   sendo a ordenação no quadro), is_global (visível/notifica a todos; só
//   admin/gestor define) e assigned_at (reatribuição → seção "Novas" do sino).

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  record_id: string | null;
  board_id: string | null;
  phase: string;
  due_date: string | null; // YYYY-MM-DD (dia civil)
  due_time: string | null; // HH:MM[:SS] (opcional, exibicional)
  completed_at: string | null;
  completed_by: string | null;
  responsible_id: string | null;
  created_by: string | null;
  position: number;
  locked: boolean;
  parent_task_id: string | null;
  pinned: boolean;
  feed_position: number;
  is_global: boolean;
  assigned_at: string | null;
  created_at: string;
  updated_at: string;
  // Join records(title) — null quando sem vínculo ou registro invisível (RLS).
  record?: { title: string | null } | null;
}

export const TASK_COLS =
  "id, title, description, record_id, board_id, phase, due_date, due_time, completed_at, completed_by, responsible_id, created_by, position, locked, parent_task_id, pinned, feed_position, is_global, assigned_at, created_at, updated_at";

// Mesmo select com o título do registro vinculado (join FK record_id).
export const TASK_COLS_WITH_RECORD = `${TASK_COLS}, record:records(title)`;
