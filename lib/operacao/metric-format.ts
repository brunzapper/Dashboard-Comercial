// Versão: 1.0 | Data: 10/10/2026
// v1.0 (10/10/2026): parte PURA do número vivo dos cards de Operação — conta
//   de dias até o fechamento e a frase/tom de cada número. Separada de
//   metrics.ts (server-only, faz consultas) para o teste não precisar de banco.
//   As frases moram AQUI (dono único), o loader só entrega contagens.

export type OperacaoMetricTone = "neutral" | "ok" | "warn" | "bad";

export interface OperacaoMetric {
  value: string;
  caption: string;
  tone: OperacaoMetricTone;
}

/** Dias inteiros de `todayIso` (YYYY-MM-DD) até o último dia do mês dele. */
export function daysUntilMonthEnd(todayIso: string): number {
  const [y, m, d] = todayIso.split("-").map(Number);
  if (!y || !m || !d) return 0;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Math.max(0, lastDay - d);
}

const fmt = (n: number) => n.toLocaleString("pt-BR");

export function tasksMetric(dueOrLate: number): OperacaoMetric {
  return {
    value: fmt(dueOrLate),
    caption: dueOrLate === 1 ? "vence até hoje" : "vencem até hoje",
    tone: dueOrLate > 0 ? "warn" : "ok",
  };
}

export function agendaMetric(today: number): OperacaoMetric {
  return { value: fmt(today), caption: "hoje", tone: "neutral" };
}

export function closingMetric(days: number): OperacaoMetric {
  return {
    value: days === 0 ? "hoje" : `${days} d`,
    caption: days === 0 ? "fechamento do mês" : "até o fechamento",
    tone: days <= 3 ? "warn" : "neutral",
  };
}

export function failedRunsMetric(failed: number): OperacaoMetric {
  return {
    value: fmt(failed),
    caption: failed === 1 ? "falhou em 7 dias" : "falharam em 7 dias",
    tone: failed > 0 ? "bad" : "ok",
  };
}

export function mappingsMetric(active: number): OperacaoMetric {
  return {
    value: fmt(active),
    caption: active === 1 ? "mapeamento" : "mapeamentos",
    tone: "neutral",
  };
}
