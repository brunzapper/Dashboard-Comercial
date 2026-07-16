// Versão: 1.0 | Data: 16/07/2026
// Tipos do Kanban — compartilhados entre a PÁGINA dedicada (dashboards.kind
// 'kanban', config em dashboards.settings.kanban) e o WIDGET de dashboard
// (widgets.settings.kanban). Sem imports de lib/widgets p/ evitar ciclos (o
// types.ts de widgets importa daqui).

/** Overrides de uma coluna (ordem do array = ordem das colunas). */
export interface KanbanColumnOverride {
  key: string; // chave estável (valor do campo, key do bucket ou fase)
  label?: string;
  color?: string; // cor do cabeçalho/da faixa
  hidden?: boolean;
  wipLimit?: number;
  // Modo tarefas: soltar o card nesta coluna CONCLUI a tarefa.
  completesTask?: boolean;
}

export type KanbanMode = "registros" | "tarefas";

/** Buckets de data suportados como colunas (mover realoca a data — D9). */
export type KanbanDateBucket = "weekday" | "month_name" | "month_year";

export interface KanbanCardSettings {
  // Ref do título (default 'title'). Core ou 'custom:<key>'.
  titleField?: string;
  // Até ~4 refs extras exibidos no corpo do card.
  extraFields?: string[];
  // Campo cujo valor pinta a faixa lateral do card (categórico).
  colorField?: string;
}

export interface KanbanTasksSettings {
  // Tarefas criadas neste board nascem travadas (só admin/gestor exclui).
  lockByDefault?: boolean;
  // Dias de antecedência p/ "vence em breve" (default 3).
  dueSoonDays?: number;
}

/** Config completa de um kanban (página ou widget). */
export interface KanbanSettings {
  mode: KanbanMode;
  // ---- modo registros ----
  source?: string; // key da fonte (data_sources)
  // Agrupar por VALOR de campo: 'stage' | 'pipeline' | ... | 'custom:<key>'.
  groupField?: string;
  // OU agrupar por BUCKET de data de um campo: dateField + dateBucket.
  dateField?: string; // 'closed_at' | 'opened_at' | 'source_created_at' | 'custom:<key>'
  dateBucket?: KanbanDateBucket;
  // Métrica somada no cabeçalho da coluna ('value' | 'mrr' | 'custom:<key>').
  metric?: string;
  card?: KanbanCardSettings;
  // ---- ambos os modos ----
  columns?: KanbanColumnOverride[];
  // ---- modo tarefas ----
  tasks?: KanbanTasksSettings;
}

// Chaves ESPECIAIS de coluna.
export const KANBAN_NO_VALUE_KEY = "__sem__"; // sem valor / sem data
export const KANBAN_OVERFLOW_KEY = "__outros__"; // estouro do teto de colunas

// Teto de colunas derivadas de valores distintos (texto livre, ex.: stage).
export const KANBAN_MAX_COLUMNS = 30;

/** Fases default de um kanban de tarefas (seed de settings.columns). */
export const DEFAULT_TASK_PHASES: KanbanColumnOverride[] = [
  { key: "a_fazer", label: "A fazer" },
  { key: "em_andamento", label: "Em andamento" },
  { key: "concluida", label: "Concluída", completesTask: true },
];

/** Coluna já derivada/resolvida (colunas visíveis do quadro). */
export interface KanbanColumn {
  key: string;
  label: string;
  color?: string;
  wipLimit?: number;
  completesTask?: boolean;
  // Coluna que não aceita drop (ex.: "Outros" do estouro).
  noDrop?: boolean;
}
