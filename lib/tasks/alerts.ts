// Versão: 1.0 | Data: 16/07/2026
// Alertas de prazo DERIVADOS (D8 do plano — sem tabela de notificações):
// atrasada = due_date < hoje (dia civil de Brasília) e não concluída;
// "vence em breve" = até dueSoonDays dias à frente (default 3). Usado pelos
// destaques dos cards/listas/agenda e pelo sino do AppShell.
import { todayBrasiliaIso } from "@/lib/date/today";

export const DEFAULT_DUE_SOON_DAYS = 3;

export type DueStatus = "atrasada" | "em_breve" | null;

// Soma dias a um ISO YYYY-MM-DD (aritmética UTC — sem drift de fuso).
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Status de prazo de uma tarefa (null = sem prazo/concluída/no prazo). */
export function classifyDue(
  task: { due_date: string | null; completed_at: string | null },
  dueSoonDays: number = DEFAULT_DUE_SOON_DAYS,
  todayIso: string = todayBrasiliaIso()
): DueStatus {
  if (!task.due_date || task.completed_at) return null;
  const due = task.due_date.slice(0, 10);
  if (due < todayIso) return "atrasada";
  if (due <= addDaysIso(todayIso, Math.max(0, dueSoonDays))) return "em_breve";
  return null;
}

export const DUE_STATUS_LABELS: Record<Exclude<DueStatus, null>, string> = {
  atrasada: "Atrasada",
  em_breve: "Vence em breve",
};
