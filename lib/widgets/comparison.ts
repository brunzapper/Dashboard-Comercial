// Versão: 1.1 | Data: 20/07/2026
// Comparação com período anterior (Frente "variação"): matemática PURA de
// ranges e alinhamento de linhas — sem I/O. O engine (runWidget) usa
// `comparisonSpec` para montar a segunda consulta (mesmos filtros, datas
// deslocadas) e `alignComparisonRows` para anexar `__cmp` às linhas.
// v1.1 (20/07/2026): base previous_period_bd — período anterior recortado no
//   mesmo dia útil. O módulo segue puro: o contexto de feriados/hoje chega por
//   parâmetro opcional (o engine o carrega); sem contexto, degrada para
//   previous_period.
//
// Bases:
//  - previous_period: período imediatamente anterior; presets deslocam
//    SEMANTICAMENTE (este_mes → mês passado cheio), custom desloca pela duração.
//  - previous_period_bd: mesmo range de previous_period, com o `to` clampado
//    no N-ésimo dia útil do último mês do range (N = dia útil corrente do
//    período atual). N além do total de dias úteis do mês = range cheio.
//  - previous_year: mesmo intervalo um ano antes (29/02 → 28/02).
//  - window_avg / window_median: média/mediana "por bucket equivalente ao
//    período atual" sobre uma janela anterior maior (trimestre/semestre/ano até
//    agora/últimos 12 meses). A granularidade do bucket sai da DURAÇÃO do
//    período atual (dia/semana/mês/trimestre). A média dispensa bucketização
//    (total da janela ÷ nº de buckets — buckets vazios contam 0); a mediana
//    exige a dimensão extra de bucket na consulta e colapso no cliente.
import {
  businessDayIndexInMonth,
  businessDaysInMonth,
  nthBusinessDayOfMonth,
} from "@/lib/date/business-days";

import type { DashboardPeriod } from "./period";
import type {
  ComparisonBase,
  ComparisonSettings,
  ComparisonWindow,
  Dimension,
  Transform,
  WidgetRow,
} from "./types";

// Contexto p/ a base previous_period_bd (o engine carrega feriados + hoje;
// o módulo continua sem I/O).
export interface BusinessDayContext {
  holidays: Set<string>;
  todayIso: string; // "YYYY-MM-DD" em Brasília
}

export type ComparisonBucket = "day" | "week" | "month" | "quarter";

export interface ComparisonSpec {
  base: ComparisonBase;
  from: string;
  to: string;
  // Só nas bases window_*:
  bucket?: ComparisonBucket; // granularidade equivalente ao período atual
  // Divisor da média (pode ser fracionário p/ semana/dia) e padding inteiro da
  // mediana (nº de buckets de calendário que intersectam a janela).
  bucketCount?: number;
}

// ---------- datas (locais, sem fuso — mesmo espírito de date-buckets.ts) ----

function parseYmd(s: string): { y: number; m: number; d: number } | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(y: number, m: number, d: number): string {
  // Normaliza via Date local (aceita m/d fora do range, ex.: dia 0 = último do
  // mês anterior) e formata manualmente — nunca toISOString (fuso).
  const dt = new Date(y, m, d);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function shiftDays(s: string, days: number): string {
  const p = parseYmd(s)!;
  return ymd(p.y, p.m, p.d + days);
}

function shiftYears(s: string, years: number): string {
  const p = parseYmd(s)!;
  // Clampa o dia ao último dia do mês de destino (29/02 → 28/02).
  const last = new Date(p.y + years, p.m + 1, 0).getDate();
  return ymd(p.y + years, p.m, Math.min(p.d, last));
}

function daysBetween(from: string, to: string): number {
  const a = parseYmd(from)!;
  const b = parseYmd(to)!;
  const ms =
    new Date(b.y, b.m, b.d).getTime() - new Date(a.y, a.m, a.d).getTime();
  return Math.round(ms / 86_400_000) + 1; // inclusivo
}

function monthsInWindow(from: string, to: string): number {
  const a = parseYmd(from)!;
  const b = parseYmd(to)!;
  return (b.y - a.y) * 12 + (b.m - a.m) + 1; // meses de calendário tocados
}

// ---------- range de comparação --------------------------------------------

const WINDOW_MONTHS: Record<Exclude<ComparisonWindow, "ytd">, number> = {
  quarter: 3,
  semester: 6,
  last_12m: 12,
};

function previousPeriodRange(
  period: DashboardPeriod & { from: string; to: string }
): { from: string; to: string } {
  const { from, to, preset } = period;
  const p = parseYmd(from)!;
  switch (preset) {
    case "hoje":
      return { from: shiftDays(from, -1), to: shiftDays(from, -1) };
    case "esta_semana":
    case "semana_passada":
      return { from: shiftDays(from, -7), to: shiftDays(to, -7) };
    case "este_mes":
    case "mes_passado":
      return { from: ymd(p.y, p.m - 1, 1), to: ymd(p.y, p.m, 0) };
    case "este_trimestre":
      return { from: ymd(p.y, p.m - 3, 1), to: ymd(p.y, p.m, 0) };
    case "este_ano":
    case "ano_passado":
      return { from: ymd(p.y - 1, 0, 1), to: ymd(p.y - 1, 11, 31) };
    default: {
      // ultimos_N e intervalos personalizados: mesma duração, terminando na
      // véspera do início atual.
      const dur = daysBetween(from, to);
      const end = shiftDays(from, -1);
      return { from: shiftDays(end, -(dur - 1)), to: end };
    }
  }
}

/** Granularidade de bucket equivalente à duração do período atual. */
export function bucketForDuration(days: number): ComparisonBucket {
  if (days <= 1) return "day";
  if (days <= 10) return "week";
  if (days <= 45) return "month";
  return "quarter";
}

// Dias médios por bucket — divisor fracionário da média p/ dia/semana (para
// mês/trimestre usamos meses de calendário exatos, ver abaixo).
const BUCKET_DAYS: Record<ComparisonBucket, number> = {
  day: 1,
  week: 7,
  month: 30.4375,
  quarter: 91.3125,
};

function windowRange(
  period: DashboardPeriod & { from: string },
  window: ComparisonWindow
): { from: string; to: string } | null {
  const p = parseYmd(period.from)!;
  // Janela em meses de calendário CHEIOS terminando no mês anterior ao início
  // do período atual — bate com a intuição ("média mensal do semestre") e dá
  // contagem exata de buckets mensais.
  const end = ymd(p.y, p.m, 0); // último dia do mês anterior
  if (window === "ytd") {
    const e = parseYmd(end)!;
    if (e.y !== p.y || p.m === 0) {
      // Janeiro: não há "ano até agora" anterior dentro do mesmo ano.
      return null;
    }
    return { from: ymd(p.y, 0, 1), to: end };
  }
  const months = WINDOW_MONTHS[window];
  return { from: ymd(p.y, p.m - months, 1), to: end };
}

/**
 * Resolve o range (e bucket, p/ janelas) da comparação. null = base
 * indisponível (sem período ativo, datas incompletas ou janela vazia).
 */
export function comparisonSpec(
  period: DashboardPeriod | null | undefined,
  cmp: ComparisonSettings | undefined,
  bdCtx?: BusinessDayContext
): ComparisonSpec | null {
  if (!cmp?.enabled || !period?.from || !period?.to) return null;
  const full = period as DashboardPeriod & { from: string; to: string };
  const base = cmp.base ?? "previous_period";
  if (base === "previous_period") {
    return { base, ...previousPeriodRange(full) };
  }
  if (base === "previous_period_bd") {
    const range = previousPeriodRange(full);
    // Sem contexto (chamador antigo/sem feriados) degrada p/ o range cheio.
    if (!bdCtx) return { base, ...range };
    const ref = bdCtx.todayIso < full.to ? bdCtx.todayIso : full.to;
    const n = businessDayIndexInMonth(ref, bdCtx.holidays);
    // N = 0 (ainda sem dia útil no mês da referência): nada a recortar de
    // forma útil — mantém o range cheio.
    if (n <= 0) return { base, ...range };
    const end = parseYmd(range.to)!;
    // O recorte vale p/ o ÚLTIMO mês do range anterior; N além do total de
    // dias úteis desse mês = mês/range completos (mantém fins de semana do
    // fim do mês — não perde registro datado em dia não útil).
    if (n >= businessDaysInMonth(end.y, end.m + 1, bdCtx.holidays)) {
      return { base, ...range };
    }
    const cut = nthBusinessDayOfMonth(end.y, end.m + 1, n, bdCtx.holidays);
    return {
      base,
      from: range.from,
      to: cut < range.to ? cut : range.to,
    };
  }
  if (base === "previous_year") {
    return {
      base,
      from: shiftYears(full.from, -1),
      to: shiftYears(full.to, -1),
    };
  }
  // Janelas (média/mediana por bucket).
  const range = windowRange(full, cmp.window ?? "last_12m");
  if (!range || range.from > range.to) return null;
  const days = daysBetween(full.from, full.to);
  const bucket = bucketForDuration(days);
  const windowDays = daysBetween(range.from, range.to);
  const months = monthsInWindow(range.from, range.to);
  // Divisor/padding: meses de calendário exatos p/ mês (janela é sempre de
  // meses cheios); trimestres = meses/3; dia/semana pela contagem de dias.
  const bucketCount =
    bucket === "month"
      ? months
      : bucket === "quarter"
        ? Math.max(1, Math.round(months / 3))
        : bucket === "week"
          ? windowDays / BUCKET_DAYS.week
          : windowDays;
  return { base, ...range, bucket, bucketCount };
}

/** Rótulo curto exibido junto da variação ("vs. …"). */
export function comparisonLabel(
  cmp: ComparisonSettings,
  spec?: ComparisonSpec | null
): string {
  const base = cmp.base ?? "previous_period";
  if (base === "previous_period") return "vs. período anterior";
  if (base === "previous_period_bd")
    return "vs. período anterior (mesmo dia útil)";
  if (base === "previous_year") return "vs. mesmo período do ano passado";
  const stat = base === "window_avg" ? "média" : "mediana";
  const gran =
    spec?.bucket === "day"
      ? "diária"
      : spec?.bucket === "week"
        ? "semanal"
        : spec?.bucket === "quarter"
          ? "trimestral"
          : "mensal";
  const win =
    cmp.window === "quarter"
      ? "do último trimestre"
      : cmp.window === "semester"
        ? "do último semestre"
        : cmp.window === "ytd"
          ? "do ano até agora"
          : "dos últimos 12 meses";
  return `vs. ${stat} ${gran} ${win}`;
}

/**
 * A ÚNICA coluna de data efetiva do período, quando existe: fieldBySource
 * ausente/uniforme → o campo; fontes com colunas divergentes → null (a
 * bucketização da mediana não tem uma coluna única p/ o date_trunc).
 */
export function uniquePeriodField(period: DashboardPeriod): string | null {
  const fbs = period.fieldBySource;
  if (!fbs) return period.field;
  const vals = [...new Set(Object.values(fbs).filter(Boolean))];
  if (vals.length === 0) return period.field;
  return vals.length === 1 ? vals[0]! : null;
}

// ---------- alinhamento de linhas -------------------------------------------

// Transforms cronológicos: buckets que NÃO se repetem entre períodos (mês,
// semana, dia…). "weekday" repete (segunda casa com segunda) e casa por valor;
// "none" pode ser qualquer campo (casa por valor; um campo de data cru
// simplesmente não casa entre períodos → variação "—", documentado).
const CHRONO_TRANSFORMS = new Set<Transform>([
  "day",
  "week",
  "month",
  "quarter",
  "year",
  "month_name",
  "month_year",
  "week_year",
  "week_month",
]);

export function isChronoDim(d: Dimension): boolean {
  return d.transform != null && CHRONO_TRANSFORMS.has(d.transform);
}

function metricKeys(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `metric_${i + 1}`);
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Anexa `row.__cmp` às linhas principais casando com as linhas da consulta de
 * comparação. DEVE rodar sobre linhas CRUAS (antes da rotulagem FK/data — a
 * rotulagem muta os dim_*).
 *
 * - `cmpDimIdx`: índices (nas dims principais) presentes na consulta de
 *   comparação, NA ORDEM em que foram enviados (bases window_* removem as dims
 *   cronológicas; previous_* mantém todas).
 * - Dims cronológicas presentes nos dois lados casam por POSIÇÃO ORDINAL
 *   (rank cronológico do bucket cru dentro do grupo das demais dims) — "1º mês
 *   do período casa com 1º mês da comparação". Heurística: buckets faltantes
 *   desalinham a cauda. Suportado p/ UMA dim cronológica (o caso real:
 *   gráfico de linha/barra por tempo); com mais de uma, cai no casamento
 *   exato por valor (variação "—").
 */
export function alignComparisonRows(
  rows: WidgetRow[],
  cmpRows: WidgetRow[],
  dims: Dimension[],
  cmpDimIdx: number[],
  metricCount: number
): void {
  const keys = metricKeys(metricCount);
  const readCmp = (r: WidgetRow): Record<string, number | null> => {
    const out: Record<string, number | null> = {};
    for (const k of keys) out[k] = numOrNull(r[k]);
    return out;
  };
  const emptyCmp = (): Record<string, number | null> => {
    const out: Record<string, number | null> = {};
    for (const k of keys) out[k] = null;
    return out;
  };

  const chronoShared = cmpDimIdx.filter((i) => isChronoDim(dims[i]));
  const ordinalIdx = chronoShared.length === 1 ? chronoShared[0] : null;

  if (ordinalIdx == null) {
    // Casamento exato por tupla das dims compartilhadas.
    const byKey = new Map<string, WidgetRow>();
    for (let c = 0; c < cmpRows.length; c++) {
      const tuple = cmpDimIdx.map((_, pos) => cmpRows[c][`dim_${pos + 1}`] ?? null);
      byKey.set(JSON.stringify(tuple), cmpRows[c]);
    }
    for (const row of rows) {
      const tuple = cmpDimIdx.map((i) => row[`dim_${i + 1}`] ?? null);
      const hit = byKey.get(JSON.stringify(tuple));
      row.__cmp = hit ? readCmp(hit) : emptyCmp();
    }
    return;
  }

  // Ordinal: agrupa pelos demais índices compartilhados e ordena cada lado
  // pelo bucket cru (ISO — ordena lexicograficamente).
  const restIdx = cmpDimIdx.filter((i) => i !== ordinalIdx);
  const ordinalPos = cmpDimIdx.indexOf(ordinalIdx); // posição na consulta cmp
  const restPos = restIdx.map((i) => cmpDimIdx.indexOf(i));
  const groupsCmp = new Map<string, WidgetRow[]>();
  for (const c of cmpRows) {
    const gk = JSON.stringify(restPos.map((pos) => c[`dim_${pos + 1}`] ?? null));
    (groupsCmp.get(gk) ?? groupsCmp.set(gk, []).get(gk)!).push(c);
  }
  for (const arr of groupsCmp.values()) {
    arr.sort((a, b) =>
      String(a[`dim_${ordinalPos + 1}`] ?? "").localeCompare(
        String(b[`dim_${ordinalPos + 1}`] ?? "")
      )
    );
  }
  const groupsMain = new Map<string, WidgetRow[]>();
  for (const row of rows) {
    const gk = JSON.stringify(restIdx.map((i) => row[`dim_${i + 1}`] ?? null));
    (groupsMain.get(gk) ?? groupsMain.set(gk, []).get(gk)!).push(row);
  }
  for (const [gk, mainArr] of groupsMain) {
    const cmpArr = groupsCmp.get(gk) ?? [];
    const sorted = [...mainArr].sort((a, b) =>
      String(a[`dim_${ordinalIdx + 1}`] ?? "").localeCompare(
        String(b[`dim_${ordinalIdx + 1}`] ?? "")
      )
    );
    sorted.forEach((row, k) => {
      row.__cmp = cmpArr[k] ? readCmp(cmpArr[k]) : emptyCmp();
    });
  }
}

/**
 * Colapsa as linhas da consulta de mediana (dims compartilhadas + bucket como
 * ÚLTIMA dimensão) em uma linha por tupla, com a mediana dos valores por
 * bucket em cada métrica. Zero-padding até `bucketCount` só nas métricas
 * EXTENSIVAS (soma/contagem — bucket vazio é 0 de verdade); métricas
 * intensivas (média/min/max/fórmula) usam só os buckets observados.
 */
export function collapseMedianRows(
  cmpRows: WidgetRow[],
  sharedDimCount: number,
  metricCount: number,
  bucketCount: number,
  isExtensive: boolean[]
): WidgetRow[] {
  const groups = new Map<string, { tuple: unknown[]; perMetric: number[][] }>();
  for (const r of cmpRows) {
    const tuple: unknown[] = [];
    for (let i = 1; i <= sharedDimCount; i++) tuple.push(r[`dim_${i}`] ?? null);
    const gk = JSON.stringify(tuple);
    let g = groups.get(gk);
    if (!g) {
      g = { tuple, perMetric: Array.from({ length: metricCount }, () => []) };
      groups.set(gk, g);
    }
    for (let m = 0; m < metricCount; m++) {
      const v = numOrNull(r[`metric_${m + 1}`]);
      if (v != null) g.perMetric[m].push(v);
    }
  }
  const median = (nums: number[]): number | null => {
    if (nums.length === 0) return null;
    const s = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const out: WidgetRow[] = [];
  const pad = Math.max(1, Math.round(bucketCount));
  for (const g of groups.values()) {
    const row: WidgetRow = {};
    g.tuple.forEach((v, i) => {
      row[`dim_${i + 1}`] = v;
    });
    for (let m = 0; m < metricCount; m++) {
      const vals = [...g.perMetric[m]];
      if (isExtensive[m]) {
        while (vals.length < pad) vals.push(0);
      }
      row[`metric_${m + 1}`] = median(vals);
    }
    out.push(row);
  }
  return out;
}
