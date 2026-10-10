// Versão: 1.0 | Data: 10/10/2026
// v1.0 (10/10/2026): o filtro "Tem tarefa" — dono ÚNICO da representação e do
// predicado.
//
// O filtro recorta REGISTROS pelas TAREFAS deles: só passa o registro que tem
// ao menos uma tarefa no ESTADO pedido com PRAZO dentro de uma janela relativa
// a hoje (N dias atrás, M dias à frente, até 180 cada). Ele aparece em quatro
// superfícies — filtros do widget, filtro rápido do card, /registros e
// condição de automação — e todas leem daqui:
//   - a REPRESENTAÇÃO como `WidgetFilter`: `field = "task:<estado>"`,
//     `op = "eq"`, `value = "<atrás>,<à frente>"` (lado vazio = sem limite);
//   - a JANELA (`taskFilterWindow`): o predicado sobre `tasks` que a consulta
//     do servidor (ids p/ o RPC, embutido p/ o modo lista) e o casamento em
//     memória das automações (`taskMatchesFilter`) aplicam IGUAL.
//
// Atrasada = pendente com prazo ANTES de hoje (dia de Brasília) — a mesma regra
// do kanban (lib/kanban/data.ts) e do `classifyDue` (lib/tasks/alerts.ts).
// Com janela definida, tarefa SEM prazo fica de fora (não há como dizer que ela
// cai na janela). Sem janela nenhuma, o estado sozinho decide.
//
// Puro e client-safe: o editor de UI e o validador da IA o importam.
import { addDaysIso } from "@/lib/date/days";

export const TASK_FILTER_PREFIX = "task:";

/** Teto de cada lado da janela, em dias (pedido do usuário). */
export const MAX_TASK_FILTER_DAYS = 180;

export type TaskFilterStatus = "pendentes" | "atrasadas" | "concluidas" | "todas";

/** Rótulos dos estados — os MESMOS que a UI e o SPEC da IA exibem. */
export const TASK_FILTER_STATUS_LABELS = {
  pendentes: "Pendentes",
  atrasadas: "Atrasadas",
  concluidas: "Concluídas",
  todas: "Pendentes e concluídas",
} satisfies Record<TaskFilterStatus, string>;

export const TASK_FILTER_STATUSES = Object.keys(
  TASK_FILTER_STATUS_LABELS
) as TaskFilterStatus[];

export interface TaskFilterSpec {
  status: TaskFilterStatus;
  /** Dias para trás (0–180); null = sem limite inferior. */
  back: number | null;
  /** Dias para frente (0–180); null = sem limite superior. */
  ahead: number | null;
}

/** O predicado sobre `tasks` — o que toda consulta e o casamento aplicam. */
export interface TaskFilterWindow {
  completed: "open" | "done" | "any";
  /** Prazo mínimo (YYYY-MM-DD, inclusivo). */
  dueFrom?: string;
  /** Prazo máximo (YYYY-MM-DD, inclusivo). */
  dueTo?: string;
}

export function isTaskFilterField(field: unknown): field is string {
  return typeof field === "string" && field.startsWith(TASK_FILTER_PREFIX);
}

function isStatus(v: unknown): v is TaskFilterStatus {
  return typeof v === "string" && v in TASK_FILTER_STATUS_LABELS;
}

/**
 * Um lado da janela: inteiro de 0 a 180, ou null (vazio). Valor fora da faixa
 * é INVÁLIDO (undefined) — nunca é cortado em silêncio para 180, que mudaria o
 * que a pessoa pediu sem ela saber.
 */
export function parseTaskFilterDays(raw: unknown): number | null | undefined {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > MAX_TASK_FILTER_DAYS) return undefined;
  return n;
}

/** `WidgetFilter` → spec; null = não é filtro de tarefa ou é inválido. */
export function parseTaskFilter(f: {
  field: string;
  op?: string;
  value?: unknown;
}): TaskFilterSpec | null {
  if (!isTaskFilterField(f.field)) return null;
  const status = f.field.slice(TASK_FILTER_PREFIX.length);
  if (!isStatus(status)) return null;
  if (f.op !== undefined && f.op !== "eq") return null;
  const raw = f.value == null ? "" : String(f.value);
  const [b = "", a = ""] = raw.split(",");
  const back = parseTaskFilterDays(b);
  const ahead = parseTaskFilterDays(a);
  if (back === undefined || ahead === undefined) return null;
  return { status, back, ahead };
}

/** Spec → `WidgetFilter` (o formato gravado em `config.filters`). */
export function serializeTaskFilter(spec: TaskFilterSpec): {
  field: string;
  op: "eq";
  value: string;
} {
  return {
    field: `${TASK_FILTER_PREFIX}${spec.status}`,
    op: "eq",
    value: `${spec.back ?? ""},${spec.ahead ?? ""}`,
  };
}

/** A janela concreta de um spec para o dia `todayIso` (Brasília). */
export function taskFilterWindow(
  spec: TaskFilterSpec,
  todayIso: string
): TaskFilterWindow {
  const w: TaskFilterWindow = {
    completed:
      spec.status === "concluidas"
        ? "done"
        : spec.status === "todas"
          ? "any"
          : "open",
  };
  if (spec.back != null) w.dueFrom = addDaysIso(todayIso, -spec.back);
  if (spec.ahead != null) w.dueTo = addDaysIso(todayIso, spec.ahead);
  if (spec.status === "atrasadas") {
    // Atrasada é prazo ANTES de hoje: o teto da janela vira ontem (a parte
    // "à frente" não tem como conter uma tarefa atrasada).
    const yesterday = addDaysIso(todayIso, -1);
    w.dueTo = w.dueTo && w.dueTo < yesterday ? w.dueTo : yesterday;
  }
  return w;
}

/** A janela exige prazo? (com prazo mínimo ou máximo, tarefa sem prazo sai). */
export function windowNeedsDue(w: TaskFilterWindow): boolean {
  return Boolean(w.dueFrom || w.dueTo);
}

/** Casamento em memória de UMA tarefa — o mesmo predicado da consulta. */
export function taskMatchesWindow(
  task: { due_date?: string | null; completed_at?: string | null },
  w: TaskFilterWindow
): boolean {
  const done = Boolean(task.completed_at);
  if (w.completed === "open" && done) return false;
  if (w.completed === "done" && !done) return false;
  if (!windowNeedsDue(w)) return true;
  const due = task.due_date ? String(task.due_date).slice(0, 10) : "";
  if (!due) return false;
  if (w.dueFrom && due < w.dueFrom) return false;
  if (w.dueTo && due > w.dueTo) return false;
  return true;
}

/** O registro tem ALGUMA tarefa que casa com o spec? */
export function taskMatchesFilter(
  tasks: { due_date?: string | null; completed_at?: string | null }[],
  spec: TaskFilterSpec,
  todayIso: string
): boolean {
  const w = taskFilterWindow(spec, todayIso);
  return tasks.some((t) => taskMatchesWindow(t, w));
}

/** Frase curta para chip/resumo: "Tem tarefa: Pendentes · 30d atrás · 60d à frente". */
export function taskFilterSummary(spec: TaskFilterSpec): string {
  const parts: string[] = [TASK_FILTER_STATUS_LABELS[spec.status]];
  if (spec.back != null) parts.push(`${spec.back}d atrás`);
  if (spec.ahead != null && spec.status !== "atrasadas")
    parts.push(`${spec.ahead}d à frente`);
  if (spec.back == null && spec.ahead == null) parts.push("qualquer prazo");
  return `Tem tarefa: ${parts.join(" · ")}`;
}

/**
 * Snapshot (link público): o dataset congelado não guarda tarefas e o adapter
 * é fail-closed para `tasks`, então o filtro "Tem tarefa" é IGNORADO lá —
 * some dos filtros do widget e dos filtros rápidos do card (decisão do
 * usuário, documentada em docs/arquitetura.md). Sem filtro de tarefa, devolve
 * o MESMO objeto.
 */
export function withoutTaskFilters<
  W extends {
    filters?: { field: string }[] | null;
    settings?: { quickFilters?: { field: string }[] } | null;
  },
>(w: W): W {
  const hasF = (w.filters ?? []).some((f) => isTaskFilterField(f.field));
  const qf = w.settings?.quickFilters;
  const hasQ = (qf ?? []).some((e) => isTaskFilterField(e.field));
  if (!hasF && !hasQ) return w;
  return {
    ...w,
    ...(hasF
      ? { filters: (w.filters ?? []).filter((f) => !isTaskFilterField(f.field)) }
      : {}),
    ...(hasQ && w.settings
      ? {
          settings: {
            ...w.settings,
            quickFilters: (qf ?? []).filter((e) => !isTaskFilterField(e.field)),
          },
        }
      : {}),
  };
}
