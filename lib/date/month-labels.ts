// Versão: 1.0 | Data: 31/07/2026
// Rótulos de mês em pt-BR + aritmética pura de mês, compartilhados pelas
// telas com navegação/seleção mensal (Remuneração admin/vendedor; a lista era
// duplicada em remuneracao-manager e goals-manager). Client-safe (sem I/O).

export const MONTH_LABELS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

/** Soma `delta` meses (mês 1-12) com rollover de ano — sem Date/fuso. */
export function addMonths(
  year: number,
  month: number,
  delta: number
): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (((total % 12) + 12) % 12) + 1 };
}
