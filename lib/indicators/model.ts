// Versão: 1.2 | Data: 02/10/2026
// v1.2 (02/10/2026): `formatIndicatorValue(…, { unit: false })` — só o número
//   (a unidade fica no rótulo da linha, na tabela de slide) e
//   `indicatorUnitSymbol` (o "R$"/"%" do rótulo).
// v1.1 (01/10/2026): `cleanMonthKeys` — lista de meses fixos (AAAA-MM) de um
//   widget, saneada em silêncio. Dona única da régua usada pela Tree (meses
//   fixos dos nós de indicador) — a Tabela de metas segue avisando pelo
//   sanitizador dela.
// Catálogo de INDICADORES (0149) — módulo PURO e client-safe.
//
// Um indicador é a EXPLICAÇÃO de uma chave de meta (`goals.metric`): o que ela
// mede (unidade), como os meses viram total (rollup), para que lado é melhor
// (direção — CAC: menor), quanto desvio se tolera antes de virar "fora"
// (tolerância, o "desvios >5%" do ritmo de acompanhamento), quem é o dono e
// como se calcula o REALIZADO (fórmula agregada + bases + recorte).
//
// Definido UMA vez e consumido pela Tabela de metas e pelos nós de indicador
// da Tree — a mesma métrica repetida em telas diferentes nunca diverge.
// O realizado é avaliado SÓ por `runCalculatedWidget` (lib/indicators/
// values.ts); aqui moram só o contrato e a aritmética de exibição.
import type { Formula, FormulaToken } from "@/lib/records/formulas";
import type { SourceKey } from "@/lib/sources";
import type { WidgetFilter } from "@/lib/widgets/types";
import { parseUiFilter } from "@/lib/comp/model";

export type IndicatorUnit = "moeda" | "quantidade" | "percentual" | "numero";
export type IndicatorRollup = "soma" | "ultimo" | "media" | "nenhum";
export type IndicatorDirection = "maior_melhor" | "menor_melhor";

export const INDICATOR_UNIT_LABELS: Record<IndicatorUnit, string> = {
  moeda: "Moeda (R$)",
  quantidade: "Quantidade",
  percentual: "Percentual (%)",
  numero: "Número",
};

export const INDICATOR_ROLLUP_LABELS: Record<IndicatorRollup, string> = {
  soma: "Soma dos meses",
  ultimo: "Último mês (saldo)",
  media: "Média dos meses",
  nenhum: "Não totaliza (premissa)",
};

export const INDICATOR_DIRECTION_LABELS: Record<IndicatorDirection, string> = {
  maior_melhor: "Maior é melhor",
  menor_melhor: "Menor é melhor",
};

export const MAX_INDICATOR_FILTERS = 12;
export const MAX_INDICATOR_FORMULA_TOKENS = 200;
export const DEFAULT_TOLERANCE_PCT = 5;

/** Como se calcula o realizado. null no indicador = só meta (premissa). */
export interface IndicatorRealized {
  v: 1;
  formula: Formula;
  /** Texto digitado no editor (round-trip). */
  formulaText?: string;
  /** Universo das linhas (vazio = todas as bases). */
  sources: SourceKey[];
  /** Recorte aplicado à consulta (FILTER_OPS estrito). */
  filters: WidgetFilter[];
}

export interface IndicatorDef {
  id?: string;
  key: string;
  label: string;
  description?: string | null;
  unit: IndicatorUnit;
  rollup: IndicatorRollup;
  direction: IndicatorDirection;
  tolerancePct: number;
  ownerResponsibleId?: string | null;
  realized: IndicatorRealized | null;
  sortOrder: number;
  presetKey?: string | null;
}

const KEY_RE = /^[a-z0-9_]{1,40}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isIndicatorKey(v: unknown): v is string {
  return typeof v === "string" && KEY_RE.test(v);
}

function pick<T extends string>(v: unknown, allowed: Record<T, string>, dflt: T): T {
  return typeof v === "string" && v in allowed ? (v as T) : dflt;
}

/**
 * Fórmula persistida: só o contrato ESTRUTURAL (tokens-objeto). A validação
 * semântica (refs/colocação) é do `validateFormulaForContext` no save.
 */
function parseFormulaShape(raw: unknown): Formula | null {
  if (!isRecord(raw) || !Array.isArray(raw.tokens)) return null;
  if (raw.tokens.length === 0 || raw.tokens.length > MAX_INDICATOR_FORMULA_TOKENS)
    return null;
  for (const t of raw.tokens) {
    if (!isRecord(t) || typeof t.kind !== "string") return null;
  }
  const out: Formula = { tokens: raw.tokens as FormulaToken[] };
  if (typeof raw.source === "string") out.source = raw.source;
  return out;
}

/**
 * Realizado: FAIL-CLOSED. jsonb adulterado vira null (indicador degrada para
 * "só meta" — exibe "—", nunca um número inventado).
 */
export function parseIndicatorRealized(raw: unknown): IndicatorRealized | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  const formula = parseFormulaShape(raw.formula);
  if (!formula) return null;
  const sources = Array.isArray(raw.sources)
    ? raw.sources.filter((s): s is string => typeof s === "string" && s !== "")
    : [];
  if (Array.isArray(raw.sources) && sources.length !== raw.sources.length)
    return null;
  const filtersRaw = Array.isArray(raw.filters) ? raw.filters : [];
  if (filtersRaw.length > MAX_INDICATOR_FILTERS) return null;
  const filters: WidgetFilter[] = [];
  for (const f of filtersRaw) {
    const parsed = parseUiFilter(f);
    if (!parsed) return null;
    filters.push(parsed);
  }
  const out: IndicatorRealized = { v: 1, formula, sources, filters };
  if (typeof raw.formulaText === "string" && raw.formulaText.trim() !== "")
    out.formulaText = raw.formulaText;
  return out;
}

/** Linha do banco → definição. Chave/rótulo inválidos ⇒ null (linha some). */
export function parseIndicatorRow(row: Record<string, unknown>): IndicatorDef | null {
  if (!isIndicatorKey(row.key)) return null;
  const label = typeof row.label === "string" ? row.label.trim() : "";
  if (!label) return null;
  const tol = Number(row.tolerance_pct);
  return {
    id: typeof row.id === "string" ? row.id : undefined,
    key: row.key,
    label,
    description: typeof row.description === "string" ? row.description : null,
    unit: pick(row.unit, INDICATOR_UNIT_LABELS, "quantidade"),
    rollup: pick(row.rollup, INDICATOR_ROLLUP_LABELS, "soma"),
    direction: pick(row.direction, INDICATOR_DIRECTION_LABELS, "maior_melhor"),
    tolerancePct:
      Number.isFinite(tol) && tol >= 0 && tol <= 100 ? tol : DEFAULT_TOLERANCE_PCT,
    ownerResponsibleId:
      typeof row.owner_responsible_id === "string" ? row.owner_responsible_id : null,
    realized: parseIndicatorRealized(row.realized),
    sortOrder: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0,
    presetKey: typeof row.preset_key === "string" ? row.preset_key : null,
  };
}

/** Colunas lidas pelos loaders (uma lista só). */
export const INDICATOR_COLUMNS =
  "id, key, label, description, unit, rollup, direction, tolerance_pct, owner_responsible_id, realized, sort_order, preset_key";

// ---------------------------------------------------------------- formatação

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const INT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const DEC = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const PCT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/**
 * Valor exibível. Percentual é guardado como o NÚMERO do percentual (23 ⇒
 * "23%"), igual à convenção das fórmulas de conversão dos presets (× 100).
 */
export function formatIndicatorValue(
  value: number | null | undefined,
  unit: IndicatorUnit,
  opts?: { unit?: boolean }
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const withUnit = opts?.unit !== false;
  switch (unit) {
    case "moeda":
      return withUnit ? BRL.format(value) : INT.format(Math.round(value));
    case "percentual":
      return withUnit ? `${PCT.format(value)}%` : PCT.format(value);
    case "quantidade":
      return Math.abs(value - Math.round(value)) < 1e-9
        ? INT.format(value)
        : DEC.format(value);
    default:
      return DEC.format(value);
  }
}

/** v1.2: símbolo da unidade para o rótulo da linha ("" = sem unidade). */
export function indicatorUnitSymbol(unit: IndicatorUnit): string {
  return unit === "moeda" ? "R$" : unit === "percentual" ? "%" : "";
}

/** Percentual de atingimento exibível ("97%"). */
export function formatAttainment(pct: number | null): string {
  return pct == null || !Number.isFinite(pct) ? "—" : `${PCT.format(pct)}%`;
}

// ---------------------------------------------------------------- aritmética

/** Total dos meses pela regra do indicador. Mês sem valor não conta. */
export function rollupMonths(
  values: (number | null | undefined)[],
  rollup: IndicatorRollup
): number | null {
  const nums = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v)
  );
  if (nums.length === 0 || rollup === "nenhum") return null;
  switch (rollup) {
    case "soma":
      return nums.reduce((a, b) => a + b, 0);
    case "media":
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case "ultimo": {
      // O ÚLTIMO mês COM valor — saldo (MRR final) não soma.
      for (let i = values.length - 1; i >= 0; i--) {
        const v = values[i];
        if (typeof v === "number" && Number.isFinite(v)) return v;
      }
      return null;
    }
  }
}

/**
 * Atingimento em % (100 = na meta). Menor-melhor inverte a razão: CAC de
 * R$ 2.500 contra meta de R$ 2.837 é 113% (melhor que a meta).
 */
export function attainment(
  realized: number | null | undefined,
  target: number | null | undefined,
  direction: IndicatorDirection
): number | null {
  if (realized == null || target == null) return null;
  if (!Number.isFinite(realized) || !Number.isFinite(target)) return null;
  if (direction === "menor_melhor") {
    if (realized === 0) return null;
    return (target / realized) * 100;
  }
  if (target === 0) return null;
  return (realized / target) * 100;
}

export type IndicatorStatus = "ok" | "atencao" | "fora" | "sem_dado";

export const INDICATOR_STATUS_LABELS: Record<IndicatorStatus, string> = {
  ok: "No plano",
  atencao: "Atenção",
  fora: "Fora do plano",
  sem_dado: "Sem dado",
};

export interface StatusContext {
  /** Fração do mês decorrida (0–1) por dia útil; 1 = mês fechado. */
  elapsed: number;
}

/**
 * Status do mês. Mês FECHADO compara o realizado cheio com a meta; mês
 * CORRENTE compara com a meta PRO-RATA pelos dias úteis decorridos (sem isso
 * todo indicador "maior é melhor" estaria "fora" no dia 2). Mês futuro
 * (elapsed 0) é "sem dado".
 *
 * Desvio ≤ tolerância ⇒ ok; até o dobro ⇒ atenção; além ⇒ fora. Menor-melhor
 * (custo) NÃO prorrateia: o custo do mês é comparado inteiro — a meta de CAC
 * não "cresce" com o mês.
 */
export function indicatorStatus(
  realized: number | null | undefined,
  target: number | null | undefined,
  def: Pick<IndicatorDef, "direction" | "tolerancePct" | "unit" | "rollup">,
  ctx: StatusContext
): IndicatorStatus {
  if (realized == null || target == null) return "sem_dado";
  if (!Number.isFinite(realized) || !Number.isFinite(target)) return "sem_dado";
  if (ctx.elapsed <= 0) return "sem_dado";
  const prorate =
    def.direction === "maior_melhor" &&
    def.rollup === "soma" &&
    def.unit !== "percentual" &&
    ctx.elapsed < 1;
  const effTarget = prorate ? target * ctx.elapsed : target;
  const att = attainment(realized, effTarget, def.direction);
  if (att == null) return "sem_dado";
  const shortfall = 100 - att;
  const tol = def.tolerancePct;
  if (shortfall <= tol) return "ok";
  if (shortfall <= tol * 2) return "atencao";
  return "fora";
}

export type ChildrenOp = "×" | "+" | "−" | "÷";

export const CHILDREN_OPS: readonly ChildrenOp[] = ["×", "+", "−", "÷"];

export const CHILDREN_OP_LABELS: Record<ChildrenOp, string> = {
  "×": "Multiplicação (vendas × ticket)",
  "+": "Soma (inbound + outbound)",
  "−": "Subtração",
  "÷": "Divisão (custo ÷ clientes)",
};

/**
 * Combina os valores dos filhos pelo operador do pai — é o PROJETADO de um
 * nó ("31 vendas × R$ 1.000 = R$ 31.000") que a Tree compara com a meta
 * oficial. Qualquer filho sem valor ⇒ null (projeção parcial seria mentira).
 * Percentual entra como fração (23 ⇒ 0,23) quando o operador é ×/÷ — "SQL ×
 * conversão" é 135 × 23% = 31.
 */
export function combineChildren(
  op: ChildrenOp,
  values: { value: number | null | undefined; unit: IndicatorUnit }[]
): number | null {
  if (values.length === 0) return null;
  const nums: number[] = [];
  for (const { value, unit } of values) {
    if (value == null || !Number.isFinite(value)) return null;
    nums.push(unit === "percentual" && (op === "×" || op === "÷") ? value / 100 : value);
  }
  const [first, ...rest] = nums;
  switch (op) {
    case "+":
      return nums.reduce((a, b) => a + b, 0);
    case "−":
      return rest.reduce((a, b) => a - b, first);
    case "×":
      return rest.reduce((a, b) => a * b, first);
    case "÷": {
      let acc = first;
      for (const b of rest) {
        if (b === 0) return null;
        acc /= b;
      }
      return acc;
    }
  }
}

// ---------------------------------------------------------------- meses

/** "YYYY-MM" ⇒ {year, month}; inválido ⇒ null. */
export function parseMonthKey(v: unknown): { year: number; month: number } | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export const MAX_TABLE_MONTHS = 12;

/**
 * v1.1 (01/10/2026): meses fixos de um widget — só `AAAA-MM` válidos, sem
 * repetição, até MAX_TABLE_MONTHS. Lixo some em silêncio (vazio = "use o
 * período do dashboard").
 */
export function cleanMonthKeys(raw: unknown): string[] {
  const out: string[] = [];
  for (const m of Array.isArray(raw) ? raw : []) {
    if (parseMonthKey(m) && !out.includes(m as string)) out.push(m as string);
    if (out.length >= MAX_TABLE_MONTHS) break;
  }
  return out;
}

/**
 * Meses (YYYY-MM) cobertos por um intervalo de datas YYYY-MM-DD, em ordem, até
 * MAX_TABLE_MONTHS. Sem intervalo ⇒ o trimestre de `todayIso`.
 */
export function monthsOfRange(
  from: string | null | undefined,
  to: string | null | undefined,
  todayIso: string
): string[] {
  const start = from?.slice(0, 7) ?? null;
  const end = to?.slice(0, 7) ?? null;
  let a = parseMonthKey(start);
  let b = parseMonthKey(end);
  if (!a && !b) {
    const t = parseMonthKey(todayIso.slice(0, 7));
    if (!t) return [];
    const q0 = Math.floor((t.month - 1) / 3) * 3 + 1;
    a = { year: t.year, month: q0 };
    b = { year: t.year, month: q0 + 2 };
  }
  a = a ?? b!;
  b = b ?? a;
  const out: string[] = [];
  let y = a.year;
  let m = a.month;
  while ((y < b.year || (y === b.year && m <= b.month)) && out.length < MAX_TABLE_MONTHS) {
    out.push(monthKey(y, m));
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** "2026-10" ⇒ "Outubro" (ou "Outubro/26" quando `withYear`). */
export function monthLabel(key: string, withYear = false): string {
  const p = parseMonthKey(key);
  if (!p) return key;
  const name = MONTH_NAMES[p.month - 1];
  return withYear ? `${name}/${String(p.year).slice(2)}` : name;
}
