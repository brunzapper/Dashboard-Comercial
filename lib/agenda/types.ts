// Versão: 2.0 | Data: 28/07/2026
// Tipos da AGENDA (calendário): registros alocados no dia pelo campo de data
// escolhido + tarefas pelo vencimento + anotações do dia (agenda_notes, 0111).
// Sem imports de lib/widgets (o types.ts de widgets importa daqui — mesmo
// arranjo do kanban).
// v2.0 (28/07/2026): AgendaItem ganha kind "note" e `time` (HH:MM p/ ordenação
//   cronológica intra-dia); AgendaSettings ganha showNotes e appearance
//   (gestor de aparência — molde do KanbanAppearance); AgendaNoteRow +
//   NOTE_COLORS (paleta de post-it).
import type { RecordRow } from "@/lib/records/types";
import type { TaskRow } from "@/lib/tasks/types";

/** Aparência do calendário (settings.agenda.appearance — editor no sheet de
 *  Aparência do card, espelho do KanbanAppearance). Cores de STATUS de tarefa
 *  (atrasada/em breve) e a cor individual da anotação têm precedência sobre as
 *  cores estéticas daqui (semântica > estética). */
export interface AgendaAppearance {
  // Faixa Seg–Dom.
  header?: { bg?: string; color?: string };
  // Fundo/grade/raio das células.
  cell?: { bg?: string; border?: string; radius?: number };
  // Destaque do dia de hoje (fundo da célula).
  todayBg?: string;
  // Tint de sábado/domingo (leitura da semana útil).
  weekendBg?: string;
  // Esmaecer dias fora do mês exibido (default true).
  dimOutsideMonth?: boolean;
  // Altura de linha (preset seguro — px livre quebraria a grade de 6 semanas).
  density?: "compacta" | "normal" | "espacosa";
  chip?: {
    fontSize?: number; // px (telão pede maior)
    radius?: number;
    task?: { bg?: string; text?: string; border?: string };
    record?: { bg?: string; text?: string; border?: string };
    note?: { bg?: string; text?: string; border?: string };
  };
}

/** Config do widget/visão de agenda (widgets.settings.agenda). */
export interface AgendaSettings {
  // Fonte dos registros exibidos (ausente = só tarefas/anotações).
  source?: string;
  // Campo de data que aloca o registro no dia ('closed_at' | 'custom:<key>').
  dateField?: string;
  // Exibe tarefas por vencimento (default true).
  showTasks?: boolean;
  // Exibe anotações do dia (default true).
  showNotes?: boolean;
  // Visão inicial (default 'month').
  defaultView?: "month" | "week";
  // Aparência do calendário (editor no sheet de Aparência).
  appearance?: AgendaAppearance;
}

/** Linha de agenda_notes (0111) — anotação livre ancorada a um dia civil. */
export interface AgendaNoteRow {
  id: string;
  note_date: string; // YYYY-MM-DD
  body: string;
  color: string | null; // token de NOTE_COLORS (null = amarelo default)
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const AGENDA_NOTE_COLS =
  "id, note_date, body, color, created_by, created_at, updated_at";

/** Paleta de post-it das anotações (token gravado em agenda_notes.color;
 *  o mapa token → classes visuais fica na UI). */
export const NOTE_COLORS = [
  "amarelo",
  "rosa",
  "verde",
  "azul",
  "laranja",
  "roxo",
] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export interface AgendaItem {
  id: string;
  kind: "record" | "task" | "note";
  date: string; // YYYY-MM-DD (dia da célula)
  // HH:MM p/ ordenação cronológica intra-dia (null = sem hora; registros:
  // prefixo naive do valor bruto — 00:00 conta como "só data").
  time?: string | null;
  title: string;
  record?: RecordRow;
  task?: TaskRow & { responsible_label?: string | null };
  note?: AgendaNoteRow;
}

export interface AgendaData {
  from: string;
  to: string;
  items: AgendaItem[];
}
