// Versão: 1.2 | Data: 02/10/2026
// v1.2 (02/10/2026): splitValueText (símbolo · número · unidade de um valor já
//   formatado) e compactNumber (escala pt-BR: mil/mi/bi) para o número-herói
//   dos cards.
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

// ---------------------------------------------------------------------------
// v1.2 (02/10/2026): NÚMERO-HERÓI — partes de um valor já formatado e escala.

export interface ValueParts {
  /** Símbolo de moeda à esquerda ("R$", "US$", "€"…) ou "". */
  prefix: string;
  /** O número, com sinal e separadores pt-BR. */
  number: string;
  /** Unidade à direita ("%", "mi", "mil", "bi", "pp"…) ou "". */
  suffix: string;
}

const PREFIX_RE = /^(-?)\s*((?:[A-Z]{1,3})?\$|€|£|¥)\s*/;
const NUMBER_RE = /^[-+]?\d[\d.\s]*(?:,\d+)?/;

/**
 * Separa um valor JÁ FORMATADO em símbolo, número e unidade — para desenhar o
 * número grande com a unidade pequena e cinza ao lado ("R$ 4,2 mi"). Texto que
 * não segue o formato volta inteiro em `number` (nunca quebra o card).
 */
export function splitValueText(text: string): ValueParts {
  const raw = (text ?? "").replace(/ /g, " ").trim();
  let rest = raw;
  let prefix = "";
  let sign = "";
  const pm = PREFIX_RE.exec(rest);
  if (pm) {
    sign = pm[1];
    prefix = pm[2];
    rest = rest.slice(pm[0].length);
  }
  const nm = NUMBER_RE.exec(rest);
  if (!nm) return { prefix: "", number: raw, suffix: "" };
  const number = (sign + nm[0]).trim();
  const suffix = rest.slice(nm[0].length).trim();
  if (suffix.length > 6) return { prefix: "", number: raw, suffix: "" };
  return { prefix, number, suffix };
}

/**
 * Número em ESCALA pt-BR: 4.200.000 → { number: "4,2", suffix: "mi" };
 * 830.000 → "830 mil"; abaixo de mil, o número inteiro. Uma casa decimal, sem
 * zero à direita ("4 mi", nunca "4,0 mi").
 */
export function compactNumber(value: number): { number: string; suffix: string } {
  if (!Number.isFinite(value)) return { number: "—", suffix: "" };
  const abs = Math.abs(value);
  const steps: [number, string][] = [
    [1e9, "bi"],
    [1e6, "mi"],
    [1e3, "mil"],
  ];
  for (const [div, suffix] of steps) {
    if (abs >= div) {
      const n = value / div;
      return {
        number: n.toLocaleString("pt-BR", {
          maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 1,
        }),
        suffix,
      };
    }
  }
  return {
    number: value.toLocaleString("pt-BR", { maximumFractionDigits: 0 }),
    suffix: "",
  };
}
