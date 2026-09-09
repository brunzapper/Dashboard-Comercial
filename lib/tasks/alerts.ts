// Versão: 1.1 | Data: 09/09/2026
// v1.1 (09/09/2026): addDaysIso passou a vir de lib/date/days.ts (era uma
//   cópia; a outra estava no avaliador das automações).
// Alertas de prazo DERIVADOS (D8 do plano — sem tabela de notificações):
// atrasada = due_date < hoje (dia civil de Brasília) e não concluída;
// "vence em breve" = até dueSoonDays dias à frente (default 3). Usado pelos
// destaques dos cards/listas/agenda e pelo sino do AppShell.
import { addDaysIso } from "@/lib/date/days";
import { todayBrasiliaIso } from "@/lib/date/today";

export const DEFAULT_DUE_SOON_DAYS = 3;

export type DueStatus = "atrasada" | "em_breve" | null;

// Soma dias a um ISO YYYY-MM-DD — implementação em lib/date/days.ts (dono
// único desde 09/09/2026); reexportada para os chamadores não mudarem.
export { addDaysIso };

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
