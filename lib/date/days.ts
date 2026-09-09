// Versão: 1.0 | Data: 09/09/2026
// Aritmética de DIA CIVIL sobre `YYYY-MM-DD` — o dono único de "soma dias" e
// "quantos dias entre".
//
// Existia em duas cópias (lib/tasks/alerts.ts desde 16/07/2026 e
// lib/kanban/automations/evaluate.ts desde 27/07/2026), e a série de tarefas
// periódicas seria a terceira. As duas continuam reexportando daqui: os
// chamadores não mudam, e passa a haver um lugar só onde essa conta pode
// estar errada.
//
// Regra do projeto (invariante 11): datas são o PREFIXO literal YYYY-MM-DD.
// A conta é feita em UTC — `Date.UTC` — de propósito: o construtor local
// escorregaria um dia na virada do horário de verão, e o dia civil de Brasília
// já chega resolvido pelo chamador (`todayBrasiliaIso`).

/** `iso` + N dias, no calendário. Nunca converte fuso. */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Dias de calendário entre `iso` e `todayIso` (positivo = `iso` no passado).
 * null quando qualquer um dos dois não é uma data ISO — ausência de data nunca
 * vira zero, que passaria por "hoje".
 */
export function daysSince(
  iso: string | null | undefined,
  todayIso: string
): number | null {
  const d = iso?.slice(0, 10);
  const t = todayIso.slice(0, 10);
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{4}-\d{2}-\d{2}$/.test(t))
    return null;
  const [y1, m1, d1] = d.split("-").map(Number);
  const [y2, m2, d2] = t.split("-").map(Number);
  return Math.round(
    (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000
  );
}
