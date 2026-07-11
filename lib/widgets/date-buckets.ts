// Versão: 2.0 | Data: 11/07/2026
// Transforms de data "por nome" para dimensões de widgets. Duas funções:
//  - formatBucketLabel: recebe o BUCKET já calculado pelo RPC (date_trunc/isodow)
//    e devolve o rótulo PT-BR. Usado no engine dos widgets AGREGADOS.
//  - bucketRecordDate: recebe a data CRUA de um registro e devolve {key,label,sort}
//    para agrupar no cliente (widget de "registros individuais"), sem tocar no banco.
//
// Rótulos: nome do mês (Janeiro), mês/ano (Janeiro/26), semana do ano (5ª semana),
// semana do mês (1ª semana de Janeiro), dia da semana (Segunda-feira), trimestre
// (T1/26) e ano (2026). Como o rótulo deixa de "parecer data", os charts/tabelas o
// exibem literalmente.
//
// Semana do mês tem dois modos:
//  - "full" (cheia): semanas de segunda a domingo; a semana pertence ao mês da sua
//    quinta-feira (convenção ISO), pegando dias do mês vizinho. Bucket = a segunda.
//  - "restricted" (restrita): recortada na virada do mês (só dias do próprio mês).
//    Bucket = greatest(início_da_semana, início_do_mês).
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

// Índice = isodow-1 (1=segunda … 7=domingo).
export const WEEKDAY_NAMES_PT = [
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
  "Domingo",
];

// Transforms que produzem um rótulo textual. Para estes o engine reordena as
// linhas pelo bucket cru e substitui o valor pelo rótulo.
export const LABEL_TRANSFORMS = new Set<Transform>([
  "weekday",
  "quarter",
  "year",
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

// Ordinal da semana do mês a partir do bucket (segunda-feira p/ full, início do
// segmento p/ restricted). Devolve { owner (0-11), nth }.
function weekOfMonthParts(
  y: number,
  m: number,
  d: number,
  weekMode: WeekMode
): { owner: number; nth: number } {
  if (weekMode === "full") {
    const thursday = new Date(Date.UTC(y, m - 1, d) + 3 * DAY_MS);
    return {
      owner: thursday.getUTCMonth(),
      nth: Math.ceil(thursday.getUTCDate() / 7),
    };
  }
  const owner = m - 1;
  if (d === 1) return { owner, nth: 1 };
  const monthStartDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0=dom
  let daysToFirstMonday = (8 - monthStartDow) % 7;
  if (daysToFirstMonday === 0) daysToFirstMonday = 7;
  const firstMonday = 1 + daysToFirstMonday;
  return { owner, nth: 2 + Math.round((d - firstMonday) / 7) };
}

/**
 * Rótulo em PT-BR de um bucket já calculado pelo RPC. `value` é o bucket ISO
 * (início do mês/semana/trimestre/ano) ou, p/ weekday, o isodow 1–7.
 */
export function formatBucketLabel(
  transform: Transform,
  value: unknown,
  weekMode: WeekMode = "restricted"
): string {
  if (transform === "weekday") {
    const n = Number(value);
    return n >= 1 && n <= 7 ? WEEKDAY_NAMES_PT[n - 1] : String(value ?? "—");
  }

  const p = parseYmd(value);
  if (!p) return value == null || value === "" ? "—" : String(value);
  const { y, m, d } = p;
  const yy = String(y).slice(-2);

  if (transform === "year") return String(y);
  if (transform === "quarter") {
    const q = Math.floor((m - 1) / 3) + 1;
    return `T${q}/${yy}`;
  }
  if (transform === "month_name") return MONTH_NAMES_PT[m - 1] ?? String(m);
  if (transform === "month_year") return `${MONTH_NAMES_PT[m - 1] ?? m}/${yy}`;
  if (transform === "week_year") {
    const wk = isoWeekOfYear(Date.UTC(y, m - 1, d));
    return `${ordinal(wk)} semana`;
  }
  // week_month
  const { owner, nth } = weekOfMonthParts(y, m, d, weekMode);
  return `${ordinal(nth)} semana de ${MONTH_NAMES_PT[owner]}`;
}

// --- Bucketização a partir da data CRUA (agrupamento no cliente) ---
function isoDate(utc: number): string {
  return new Date(utc).toISOString().slice(0, 10);
}
// Segunda-feira da semana ISO que contém a data.
function mondayOf(y: number, m: number, d: number): number {
  const t = Date.UTC(y, m - 1, d);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // segunda = 0
  return t - dow * DAY_MS;
}

export interface RecordBucket {
  key: string; // chave estável do grupo
  label: string; // rótulo PT-BR exibido
  sort: number; // ordenação cronológica/semântica
}

/**
 * Agrupa a data crua de um registro conforme o transform escolhido. Usado no
 * widget de registros individuais (agregação por período, só na exibição).
 */
export function bucketRecordDate(
  rawIso: unknown,
  transform: Transform,
  weekMode: WeekMode = "restricted"
): RecordBucket {
  const p = parseYmd(rawIso);
  if (!p) return { key: "—", label: "—", sort: Number.POSITIVE_INFINITY };
  const { y, m, d } = p;
  const yy = String(y).slice(-2);

  switch (transform) {
    case "weekday": {
      const isodow = ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
      return {
        key: `w${isodow}`,
        label: WEEKDAY_NAMES_PT[isodow - 1],
        sort: isodow,
      };
    }
    case "month_name":
      // Agrupa por mês em TODO o período (todas as Janeiros → "Janeiro").
      return { key: `m${m}`, label: MONTH_NAMES_PT[m - 1], sort: m };
    case "month_year":
      return {
        key: `${y}-${m}`,
        label: `${MONTH_NAMES_PT[m - 1]}/${yy}`,
        sort: y * 12 + m,
      };
    case "year":
      return { key: `y${y}`, label: String(y), sort: y };
    case "quarter": {
      const q = Math.floor((m - 1) / 3) + 1;
      return { key: `${y}-Q${q}`, label: `T${q}/${yy}`, sort: y * 4 + q };
    }
    case "week_year": {
      const mon = mondayOf(y, m, d);
      return {
        key: isoDate(mon),
        label: `${ordinal(isoWeekOfYear(mon))} semana`,
        sort: mon,
      };
    }
    case "week_month": {
      const mon = mondayOf(y, m, d);
      const monthStart = Date.UTC(y, m - 1, 1);
      const bucket = weekMode === "full" ? mon : Math.max(mon, monthStart);
      return {
        key: isoDate(bucket),
        label: formatBucketLabel("week_month", isoDate(bucket), weekMode),
        sort: bucket,
      };
    }
    default:
      return { key: isoDate(Date.UTC(y, m - 1, d)), label: `${y}-${m}-${d}`, sort: Date.UTC(y, m - 1, d) };
  }
}
