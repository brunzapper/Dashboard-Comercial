// Versão: 1.4 | Data: 10/09/2026
// v1.4 (10/09/2026): `automation_rule_id` — qual regra abriu a tarefa (0129).
// A coluna existe desde a 0129 e nunca subia ao cliente; a Tree precisa dela
// para saber de QUAL série a ocorrência é (um registro pode seguir mais de
// uma), e o diálogo de "encerrar a sequência" para mirar a série certa.
// Tipos de TAREFAS (tabela tasks, 0063). Uma tarefa pode ser standalone,
// vinculada a um registro (record_id) e/ou a um kanban de tarefas (board_id;
// `phase` é a key da coluna). Visibilidade via RLS: view_all_records OU
// criador OU responsável vinculado ao usuário (vendedor só vê as suas).
// v1.1 (17/07/2026, 0066): parent_task_id (subtarefa — vive no feed do pai,
//   não vira card), pinned/feed_position (feed dos cards; `position` segue
//   sendo a ordenação no quadro), is_global (visível/notifica a todos; só
//   admin/gestor define) e assigned_at (reatribuição → seção "Novas" do sino).
// v1.2 (28/07/2026, 0111): due_time_end — hora FINAL opcional do agendamento
//   ("14:00–15:30"); exige due_time (CHECK no banco + regra na action).
// v1.3 (10/09/2026, 0132/0137): series_key/series_occurrence (a identidade da
//   ocorrência, que a Tree já lia direto do banco) e occurrence_noun — como
//   ESTA ocorrência se chama na árvore. Rótulo de exibição: null herda o da
//   série, e na falta dela o padrão do sistema (lib/series/types.ts).

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  record_id: string | null;
  board_id: string | null;
  phase: string;
  due_date: string | null; // YYYY-MM-DD (dia civil)
  due_time: string | null; // HH:MM[:SS] (opcional, exibicional)
  due_time_end: string | null; // HH:MM[:SS] (opcional; exige due_time)
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
  /** Regra de automação que abriu a tarefa (0129). null = criada à mão. */
  automation_rule_id: string | null;
  /** Série que gerou a tarefa (0132). null = tarefa avulsa. */
  series_key: string | null;
  /** N-ésima ocorrência DERIVADA da série — nunca um contador. */
  series_occurrence: number | null;
  /** v1.3: substantivo desta ocorrência na Tree. null = herda a série. */
  occurrence_noun: string | null;
  created_at: string;
  updated_at: string;
  // Join records(title) — null quando sem vínculo ou registro invisível (RLS).
  record?: { title: string | null } | null;
}

export const TASK_COLS =
  "id, title, description, record_id, board_id, phase, due_date, due_time, due_time_end, completed_at, completed_by, responsible_id, created_by, position, locked, parent_task_id, pinned, feed_position, is_global, assigned_at, automation_rule_id, series_key, series_occurrence, occurrence_noun, created_at, updated_at";

// Mesmo select com o título do registro vinculado (join FK record_id).
export const TASK_COLS_WITH_RECORD = `${TASK_COLS}, record:records(title)`;
