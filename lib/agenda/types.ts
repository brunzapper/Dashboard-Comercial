// Versão: 1.0 | Data: 16/07/2026
// Tipos da AGENDA (calendário): registros alocados no dia pelo campo de data
// escolhido + tarefas pelo vencimento. Sem imports de lib/widgets (o types.ts
// de widgets importa daqui — mesmo arranjo do kanban).
import type { RecordRow } from "@/lib/records/types";
import type { TaskRow } from "@/lib/tasks/types";

/** Config do widget/visão de agenda (widgets.settings.agenda). */
export interface AgendaSettings {
  // Fonte dos registros exibidos (ausente = só tarefas).
  source?: string;
  // Campo de data que aloca o registro no dia ('closed_at' | 'custom:<key>').
  dateField?: string;
  // Exibe tarefas por vencimento (default true).
  showTasks?: boolean;
  // Visão inicial (default 'month').
  defaultView?: "month" | "week";
}

export interface AgendaItem {
  id: string;
  kind: "record" | "task";
  date: string; // YYYY-MM-DD (dia da célula)
  title: string;
  record?: RecordRow;
  task?: TaskRow & { responsible_label?: string | null };
}

export interface AgendaData {
  from: string;
  to: string;
  items: AgendaItem[];
}
