// Versão: 1.1 | Data: 15/07/2026
// v1.1 (15/07/2026): formatPercent — única casa da matemática ×100 do formato
//   percentual (scale=true) e do sufixo "%" por métrica (scale=false).
// Formatação de datas nas tabelas dos dashboards. As datas chegam do Bitrix em
// ISO (ex.: "2026-03-19T16:34:48+00:00" ou já truncadas em "2026-03-01"). Aqui
// convertemos para os formatos exibíveis escolhidos pelo usuário — padrão global
// por dashboard (DashboardSettings.dateFormat) com override por coluna
// (AppearanceSettings.table.dateFormats[colKey]).

import { fracDigits } from "@/lib/widgets/appearance";

export type DateFormat = "dd/mm/aaaa" | "dd/mm/aa" | "mm/aa";

export const DEFAULT_DATE_FORMAT: DateFormat = "dd/mm/aaaa";

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  "dd/mm/aaaa": "dd/mm/aaaa",
  "dd/mm/aa": "dd/mm/aa",
  "mm/aa": "mm/aa",
};

export const DATE_FORMATS = Object.keys(DATE_FORMAT_LABELS) as DateFormat[];

// Extrai ano/mês/dia da string sem depender de timezone: usamos os dígitos
// YYYY-MM-DD do prefixo ISO (que é como o Postgres/Bitrix entregam). Assim uma
// data "2026-03-19T..." nunca "volta um dia" por conversão de fuso.
function parseYmd(value: unknown): { y: number; m: number; d: number } | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  return { y, m: mo, d: da };
}

/**
 * Formata um valor de data (ISO) no formato escolhido. Se não reconhecer uma
 * data, devolve o texto original (sem quebrar valores não-data).
 */
export function formatDateValue(value: unknown, fmt: DateFormat): string {
  const p = parseYmd(value);
  if (!p) return value == null ? "" : String(value);
  const dd = String(p.d).padStart(2, "0");
  const mm = String(p.m).padStart(2, "0");
  const yyyy = String(p.y).padStart(4, "0");
  const yy = yyyy.slice(-2);
  switch (fmt) {
    case "dd/mm/aa":
      return `${dd}/${mm}/${yy}`;
    case "mm/aa":
      return `${mm}/${yy}`;
    case "dd/mm/aaaa":
    default:
      return `${dd}/${mm}/${yyyy}`;
  }
}

/** true quando a string parece uma data ISO (para decidir se formata a célula). */
export function looksLikeDate(value: unknown): boolean {
  return parseYmd(value) != null;
}

/**
 * Percentual (15/07/2026) — único lugar com a matemática ×100.
 * scale=true: formato de CAMPO percentual (0.35 → "35%").
 * scale=false: toggle "%" por métrica — só sufixa o número (35 → "35%").
 * O guard de string vazia é obrigatório: Number("") === 0.
 * `decimals` (18/07/2026): casas fixas configuradas na aparência; undefined =
 * teto de 2 (comportamento original).
 */
export function formatPercent(
  v: unknown,
  scale: boolean,
  decimals?: number
): string {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${(scale ? n * 100 : n).toLocaleString("pt-BR", fracDigits(decimals))}%`;
}
