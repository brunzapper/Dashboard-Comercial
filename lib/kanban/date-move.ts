// Versão: 1.0 | Data: 16/07/2026
// Regras de MOVIMENTO em colunas de bucket de data (D9 do plano): funções puras
// que traduzem "soltei o card na coluna X" numa data concreta.
//   - weekday (w1..w7): troca o dia da semana mantendo a semana ISO da data
//     original; card sem data usa a semana de referência (hoje).
//   - month_name (m1..m12): mantém ano e dia, com clamp ao último dia do mês
//     destino (31/jan → 28/fev); sem data, usa o dia 1 do mês no ano de ref.
//   - month_year (YYYY-M): idem com o ano do bucket.
//   - KANBAN_NO_VALUE_KEY: limpa a data (retorna null).
// Valores com hora (timestamptz ISO) preservam o sufixo (T…), trocando só o
// prefixo YYYY-MM-DD — consistente com a bucketização por prefixo do app.
import { KANBAN_NO_VALUE_KEY, type KanbanDateBucket } from "./types";

const DAY_MS = 86_400_000;

function parseYmd(value: unknown): { y: number; m: number; d: number } | null {
  if (value == null) return null;
  const m = String(value)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymdToIso(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

// Último dia do mês (m 1-12).
function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Segunda-feira (UTC ms) da semana ISO que contém a data.
function mondayOf(y: number, m: number, d: number): number {
  const t = Date.UTC(y, m - 1, d);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // segunda = 0
  return t - dow * DAY_MS;
}

// Preserva o sufixo de hora do valor original (ex.: 'T14:30:00Z') no novo dia.
function withOriginalTime(newYmd: string, original: unknown): string {
  const s = original == null ? "" : String(original).trim();
  const suffix = /^\d{4}-\d{2}-\d{2}(.+)$/.exec(s)?.[1] ?? "";
  return `${newYmd}${suffix}`;
}

/**
 * Data resultante de soltar um card na coluna `targetKey` de um kanban
 * bucketizado por `bucket`. `currentIso` é o valor atual do campo de data do
 * card (pode ser null — coluna "Sem data"); `refIso` é a data de referência
 * (hoje, YYYY-MM-DD) usada quando não há data original. Retorna a nova data
 * (mesmo formato do original: só dia, ou dia+hora) ou null p/ limpar.
 */
export function computeDateOnMove(
  currentIso: string | null,
  bucket: KanbanDateBucket,
  targetKey: string,
  refIso: string
): string | null {
  if (targetKey === KANBAN_NO_VALUE_KEY) return null;
  const cur = parseYmd(currentIso);
  const ref = parseYmd(refIso) ?? { y: 2026, m: 1, d: 1 };

  if (bucket === "weekday") {
    const isodow = Number(/^w([1-7])$/.exec(targetKey)?.[1]);
    if (!isodow) return currentIso;
    const base = cur ?? ref;
    const monday = mondayOf(base.y, base.m, base.d);
    const t = new Date(monday + (isodow - 1) * DAY_MS);
    const ymd = ymdToIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    return withOriginalTime(ymd, currentIso);
  }

  if (bucket === "month_name") {
    const month = Number(/^m(\d{1,2})$/.exec(targetKey)?.[1]);
    if (!month || month < 1 || month > 12) return currentIso;
    const y = cur?.y ?? ref.y;
    const d = Math.min(cur?.d ?? 1, lastDayOfMonth(y, month));
    return withOriginalTime(ymdToIso(y, month, d), currentIso);
  }

  // month_year: chave 'YYYY-M' (mesma de bucketRecordDate).
  const m = /^(\d{4})-(\d{1,2})$/.exec(targetKey);
  if (!m) return currentIso;
  const y = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return currentIso;
  const d = Math.min(cur?.d ?? 1, lastDayOfMonth(y, month));
  return withOriginalTime(ymdToIso(y, month, d), currentIso);
}
