// Versão: 1.1 | Data: 21/07/2026
// v1.1 (21/07/2026): businessDayOrdinalLabel — rótulo único do badge
// "Nº dia útil".
// Utilitários PUROS de dia útil: dia útil = segunda a sexta que NÃO está no
// conjunto de dias não úteis (tabela non_working_days, carregada por
// lib/config/non-working-days.ts). Todas as funções trabalham sobre strings
// ISO "YYYY-MM-DD" (prefix-based, sem conversão de fuso — como o restante do
// read side) e recebem o Set de feriados por parâmetro (client-safe,
// testável, sem I/O). Meses são 1–12.

/** Recorta "YYYY-MM-DD" de uma string ISO (aceita datetime). */
function dayPrefix(iso: string): string {
  return iso.slice(0, 10);
}

function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const m = dayPrefix(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function toIso(y: number, m: number, d: number): string {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/** Dias no mês (m 1–12). Date.UTC é usado só como aritmética de calendário. */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 0=domingo … 6=sábado (aritmética de calendário, sem fuso). */
function weekdayOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Seg–sex e fora do conjunto de dias não úteis. ISO inválido → false. */
export function isBusinessDay(iso: string, holidays: Set<string>): boolean {
  const p = parseIso(iso);
  if (!p) return false;
  const wd = weekdayOf(p.y, p.m, p.d);
  if (wd === 0 || wd === 6) return false;
  return !holidays.has(toIso(p.y, p.m, p.d));
}

/** Total de dias úteis do mês (m 1–12). */
export function businessDaysInMonth(
  y: number,
  m: number,
  holidays: Set<string>
): number {
  let count = 0;
  const total = daysInMonth(y, m);
  for (let d = 1; d <= total; d++) {
    if (isBusinessDay(toIso(y, m, d), holidays)) count++;
  }
  return count;
}

/**
 * Nº do dia útil da data dentro do próprio mês: quantos dias úteis existem do
 * dia 1 até a data, inclusive. Data em dia NÃO útil → índice do último dia
 * útil anterior (0 se ainda não houve dia útil no mês). ISO inválido → 0.
 */
export function businessDayIndexInMonth(
  iso: string,
  holidays: Set<string>
): number {
  const p = parseIso(iso);
  if (!p) return 0;
  let count = 0;
  for (let d = 1; d <= p.d; d++) {
    if (isBusinessDay(toIso(p.y, p.m, d), holidays)) count++;
  }
  return count;
}

/**
 * Rótulo ordinal do dia útil ("14º dia útil") — ponto ÚNICO do texto, usado
 * pelo badge do card (BusinessDayBadge) e por qualquer superfície futura.
 */
export function businessDayOrdinalLabel(n: number): string {
  return `${n}º dia útil`;
}

/**
 * Data (ISO) do N-ésimo dia útil do mês. N maior que o total → clamp no
 * último dia útil; mês sem nenhum dia útil (patológico) → último dia do mês.
 * N < 1 é tratado como 1.
 */
export function nthBusinessDayOfMonth(
  y: number,
  m: number,
  n: number,
  holidays: Set<string>
): string {
  const total = daysInMonth(y, m);
  const target = Math.max(1, n);
  let count = 0;
  let lastBusiness: string | null = null;
  for (let d = 1; d <= total; d++) {
    const iso = toIso(y, m, d);
    if (!isBusinessDay(iso, holidays)) continue;
    count++;
    lastBusiness = iso;
    if (count === target) return iso;
  }
  return lastBusiness ?? toIso(y, m, total);
}

/** Dias úteis no intervalo [fromIso, toIso], inclusivo. Invertido/ inválido → 0. */
export function businessDaysBetween(
  fromIso: string,
  toIso_: string,
  holidays: Set<string>
): number {
  const a = parseIso(fromIso);
  const b = parseIso(toIso_);
  if (!a || !b) return 0;
  const start = Date.UTC(a.y, a.m - 1, a.d);
  const end = Date.UTC(b.y, b.m - 1, b.d);
  if (start > end) return 0;
  let count = 0;
  const DAY = 86400000;
  for (let t = start; t <= end; t += DAY) {
    const dt = new Date(t);
    const iso = toIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    if (isBusinessDay(iso, holidays)) count++;
  }
  return count;
}
