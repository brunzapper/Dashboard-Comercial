// Versão: 1.0 | Data: 11/07/2026
// Transforms de data "por nome" para dimensões de widgets. O RPC agrupa os
// registros por um bucket de data (date_trunc de mês/semana, ou o início do
// segmento restrito de semana), e AQUI transformamos esse bucket ISO no rótulo
// legível em PT-BR — nome do mês (Janeiro), mês/ano (Janeiro/26), semana do ano
// (5ª semana) e semana do mês (1ª semana de Janeiro). Como o rótulo deixa de
// "parecer data", os charts/tabelas o exibem literalmente (sem reformatar).
//
// Semana do mês tem dois modos:
//  - "full" (cheia): semanas de segunda a domingo; a semana pertence ao mês da
//    sua quinta-feira (convenção ISO), então pega dias do mês vizinho para
//    completar a semana. O bucket vindo do SQL é a segunda-feira (date_trunc week).
//  - "restricted" (restrita): a semana é recortada na virada do mês (só os dias
//    do próprio mês). O bucket é greatest(início_da_semana, início_do_mês).
import type { Transform } from "./types";

export type WeekMode = "full" | "restricted";

export const MONTH_NAMES_PT = [
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

// Transforms que produzem um rótulo textual (mês/semana por nome). Para estes o
// engine reordena as linhas pelo bucket cru e substitui o valor pelo rótulo.
export const LABEL_TRANSFORMS = new Set<Transform>([
  "month_name",
  "month_year",
  "week_year",
  "week_month",
]);

export function isLabelTransform(t: Transform | undefined): boolean {
  return t != null && LABEL_TRANSFORMS.has(t);
}

const DAY_MS = 86_400_000;

// Extrai ano/mês/dia do prefixo ISO (YYYY-MM-DD), sem depender de fuso.
function parseYmd(value: unknown): { y: number; m: number; d: number } | null {
  if (value == null) return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

// Número ISO da semana do ano a partir de uma data (usa a quinta-feira da semana).
function isoWeekOfYear(utc: number): number {
  const d = new Date(utc);
  const dayNum = (d.getUTCDay() + 6) % 7; // segunda = 0
  const thursday = new Date(utc + (3 - dayNum) * DAY_MS);
  const firstThursday = Date.UTC(thursday.getUTCFullYear(), 0, 4);
  const ft = new Date(firstThursday);
  const ftDayNum = (ft.getUTCDay() + 6) % 7;
  const firstThursdayOfWeek = firstThursday + (3 - ftDayNum) * DAY_MS;
  return 1 + Math.round((thursday.getTime() - firstThursdayOfWeek) / (7 * DAY_MS));
}

function ordinal(n: number): string {
  return `${n}ª`;
}

/**
 * Rótulo em PT-BR de um bucket de data para um transform "por nome".
 * `value` é o bucket ISO devolvido pelo RPC (início do mês/semana/segmento).
 */
export function formatBucketLabel(
  transform: Transform,
  value: unknown,
  weekMode: WeekMode = "restricted"
): string {
  const p = parseYmd(value);
  if (!p) return value == null || value === "" ? "—" : String(value);
  const { y, m, d } = p;
  const yy = String(y).slice(-2);

  if (transform === "month_name") return MONTH_NAMES_PT[m - 1] ?? String(m);
  if (transform === "month_year") return `${MONTH_NAMES_PT[m - 1] ?? m}/${yy}`;

  if (transform === "week_year") {
    const wk = isoWeekOfYear(Date.UTC(y, m - 1, d));
    return `${ordinal(wk)} semana`;
  }

  // week_month
  if (weekMode === "full") {
    // Bucket = segunda-feira; a semana pertence ao mês da sua quinta-feira.
    const thursday = new Date(Date.UTC(y, m - 1, d) + 3 * DAY_MS);
    const owner = thursday.getUTCMonth();
    const nth = Math.ceil(thursday.getUTCDate() / 7);
    return `${ordinal(nth)} semana de ${MONTH_NAMES_PT[owner]}`;
  }

  // restricted: bucket = greatest(início_semana, início_mês). O mês do bucket é o
  // mês dono; a ordem = 1 (primeiro dia do mês) + nº de segundas após o dia 1º.
  const owner = m - 1;
  let nth: number;
  if (d === 1) {
    nth = 1;
  } else {
    const monthStartDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0=dom
    let daysToFirstMonday = (8 - monthStartDow) % 7; // até a 1ª segunda após o dia 1
    if (daysToFirstMonday === 0) daysToFirstMonday = 7;
    const firstMonday = 1 + daysToFirstMonday;
    nth = 2 + Math.round((d - firstMonday) / 7);
  }
  return `${ordinal(nth)} semana de ${MONTH_NAMES_PT[owner]}`;
}
