// Versão: 1.0 | Data: 16/07/2026
// Grade do calendário — helpers PUROS hand-rolled (sem lib de datas, como
// lib/widgets/date-buckets.ts): matriz de semanas (segunda→domingo) que cobre
// o mês, semana de uma data e navegação por mês/semana em ISO YYYY-MM-DD.
const DAY_MS = 86_400_000;

function parseYmd(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

function toIso(utc: number): string {
  return new Date(utc).toISOString().slice(0, 10);
}

function utcOf(iso: string): number {
  const { y, m, d } = parseYmd(iso);
  return Date.UTC(y, m - 1, d);
}

/** Segunda-feira da semana ISO que contém a data. */
export function mondayOfIso(iso: string): string {
  const t = utcOf(iso);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // segunda = 0
  return toIso(t - dow * DAY_MS);
}

/** Soma dias a um ISO. */
export function addDays(iso: string, days: number): string {
  return toIso(utcOf(iso) + days * DAY_MS);
}

/** Mês (YYYY-MM) de uma data ISO. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** Navega meses mantendo o dia 1 (âncoras de calendário usam o dia 1). */
export function addMonths(iso: string, delta: number): string {
  const { y, m } = parseYmd(iso);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

/** Semana (7 dias ISO, segunda→domingo) que contém a data. */
export function weekOf(iso: string): string[] {
  const mon = mondayOfIso(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

/**
 * Matriz de semanas que cobre o mês da âncora (linhas de segunda→domingo,
 * incluindo dias dos meses vizinhos nas bordas).
 */
export function monthGrid(anchorIso: string): string[][] {
  const { y, m } = parseYmd(anchorIso);
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const start = mondayOfIso(first);
  const end = addDays(mondayOfIso(last), 6);
  const weeks: string[][] = [];
  for (let day = start; day <= end; day = addDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
  }
  return weeks;
}

const MONTHS_PT = [
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

/** "Julho de 2026" a partir de qualquer ISO do mês. */
export function monthLabel(iso: string): string {
  const { y, m } = parseYmd(iso);
  return `${MONTHS_PT[m - 1]} de ${y}`;
}

export const WEEKDAY_SHORT_PT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
