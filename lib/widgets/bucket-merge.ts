// Versão: 1.0 | Data: 23/07/2026
// Merge client-side por BUCKET para dimensão de campo PERSONALIZADO com
// "Formato" de data (transform): o ramo `custom:` da DIMENSÃO nas RPCs
// (0085, run_widget_query/_snapshot) agrupa pelo VALOR CRU de
// `custom_fields->>key` — o transform é aplicado só no rótulo. Valores com
// hora/offset viram um grupo POR REGISTRO (barras/chips duplicados). Este
// módulo funde as linhas do RPC pelo bucket no ENGINE (RPCs INTOCADAS —
// invariante 1 do projeto), no choke point único de computeRows, com a MESMA
// semântica de fusão do Total geral/subtotais (widget-chart
// metricAggCellText): sum/count somam, min/max reduzem, calculadas reavaliam
// a fórmula sobre a basis fundida (foldBasis → evalCalcMoney, exato — a basis
// carrega sum e count), monetárias fundem o __money (foldBreakdowns; o engine
// replota depois — exato inclusive p/ média, o breakdown carrega count).
// ÚNICA aproximação: média SIMPLES não-monetária (a linha do RPC não carrega
// peso) = média das médias — mesma limitação que o Total geral já tem.
// O valor da dimensão fundida vira o CANÔNICO estilo-núcleo (byte-compatível
// com o date_trunc/extract das colunas core), o que também conserta a
// ordenação cronológica, o casamento ordinal da comparação e a regex mensal
// do goalLine. Colunas core/`unified:`/`match:` seguem agrupando no servidor
// — o merge só ativa quando há dim `custom:` com transform.
import type { Dimension, WidgetRow } from "./types";
import type { Transform } from "./types";
import { foldBasis, type BasisValues } from "./calc-metrics";
import { foldBreakdowns, type MoneyBreakdown } from "./currency";
import type { WeekMode } from "./date-buckets";

const DAY_MS = 86_400_000;

// Prefixo ISO YYYY-MM-DD (byte-igual ao parseYmd de date-buckets/RPC 0085 —
// lê o dia LITERAL do texto, sem conversão de fuso).
function ymd(value: unknown): { y: number; m: number; d: number } | null {
  if (value == null) return null;
  const m = String(value)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function iso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function mondayOf(y: number, m: number, d: number): string {
  const utc = Date.UTC(y, m - 1, d);
  const dayNum = (new Date(utc).getUTCDay() + 6) % 7; // segunda = 0
  const mon = new Date(utc - dayNum * DAY_MS);
  return iso(mon.getUTCFullYear(), mon.getUTCMonth() + 1, mon.getUTCDate());
}

/**
 * Valor CANÔNICO do bucket de um valor cru, espelhando o que a RPC produz
 * para colunas core (0085): weekday → isodow 1-7; semanas → segunda ISO
 * (week_month "restricted" recorta na virada do mês — greatest(week, month));
 * mês/"por nome" → 1º dia do mês; trimestre → 1º dia do trimestre; ano →
 * 1º de janeiro. Cru não-parseável → null (o chamador mantém o grupo próprio).
 */
export function bucketCanonicalValue(
  raw: unknown,
  transform: Transform,
  weekMode: WeekMode = "restricted"
): string | number | null {
  const p = ymd(raw);
  if (!p) return null;
  const { y, m, d } = p;
  switch (transform) {
    case "weekday":
      return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
    case "day":
      return iso(y, m, d);
    case "week":
    case "week_year":
      return mondayOf(y, m, d);
    case "week_month": {
      const monday = mondayOf(y, m, d);
      if (weekMode === "full") return monday;
      const monthStart = iso(y, m, 1);
      return monday > monthStart ? monday : monthStart;
    }
    case "month":
    case "month_name":
    case "month_year":
      return iso(y, m, 1);
    case "quarter":
      return iso(y, (Math.ceil(m / 3) - 1) * 3 + 1, 1);
    case "year":
      return iso(y, 1, 1);
    default:
      return null; // "none" (não bucketiza)
  }
}

// A dimensão precisa de bucketização client-side? SÓ `custom:` direto com
// transform — core/`unified:`/`match:` já agrupam no servidor.
export function dimNeedsClientBucket(d: Dimension): boolean {
  return (
    d.field.startsWith("custom:") &&
    d.transform != null &&
    d.transform !== "none"
  );
}

export interface MergeMetricSpec {
  key: string; // "metric_<n>"
  kind: "sum" | "count" | "avg" | "min" | "max" | "calc";
  // kind "calc": reavalia a fórmula sobre a basis FUNDIDA do grupo (o engine
  // injeta o fechamento com a meta de moeda). Ausente = valor null.
  evalBasis?: (basis: BasisValues) => number | null;
}

function finiteOf(rows: WidgetRow[], key: string): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const v = r[key];
    const n = Number(v);
    if (v != null && Number.isFinite(n)) out.push(n);
  }
  return out;
}

function foldMetric(rows: WidgetRow[], spec: MergeMetricSpec): number | null {
  if (spec.kind === "calc") {
    const folded = foldBasis(
      rows.map(
        (r) =>
          (r.__calcOpsBy?.[spec.key] as BasisValues | undefined) ?? r.__calcOps
      )
    );
    return spec.evalBasis ? spec.evalBasis(folded) : null;
  }
  const nums = finiteOf(rows, spec.key);
  if (nums.length === 0) return spec.kind === "count" ? 0 : null;
  switch (spec.kind) {
    case "sum":
    case "count":
      return nums.reduce((a, b) => a + b, 0);
    case "min":
      return Math.min(...nums);
    case "max":
      return Math.max(...nums);
    case "avg":
      // Aproximação documentada: média das médias (a linha do RPC não traz o
      // peso do grupo cru). Métrica monetária NÃO cai aqui de fato — o engine
      // replota do __money fundido (exato, o breakdown carrega count).
      return nums.reduce((a, b) => a + b, 0) / nums.length;
  }
}

/**
 * Funde as linhas do RPC pelo bucket das dims `custom:`+transform. Sem dim
 * assim, devolve `rows` INALTERADO (mesma referência — caminho atual segue
 * byte-idêntico). A ORDEM dos grupos segue a primeira ocorrência (o engine
 * reordena cronologicamente depois, pelo valor canônico).
 */
export function mergeRowsByBucket(
  rows: WidgetRow[],
  dims: Dimension[],
  metrics: MergeMetricSpec[]
): WidgetRow[] {
  const bucketIdx: number[] = [];
  dims.forEach((d, i) => {
    if (dimNeedsClientBucket(d)) bucketIdx.push(i);
  });
  if (bucketIdx.length === 0 || rows.length === 0) return rows;
  const bucketSet = new Set(bucketIdx);

  const groups = new Map<string, { rows: WidgetRow[]; canon: unknown[] }>();
  const order: string[] = [];
  for (const row of rows) {
    const tuple: unknown[] = [];
    const canon: unknown[] = [];
    dims.forEach((d, i) => {
      const raw = row[`dim_${i + 1}`] ?? null;
      if (bucketSet.has(i)) {
        const c = bucketCanonicalValue(raw, d.transform!, d.weekMode);
        // Cru não-parseável fica num grupo próprio (chave prefixada — nunca
        // colide com um canônico) e mantém o valor original na exibição.
        tuple.push(c == null ? `raw:${String(raw)}` : c);
        canon.push(c == null ? raw : c);
      } else {
        tuple.push(raw);
        canon.push(raw);
      }
    });
    const key = JSON.stringify(tuple);
    const g = groups.get(key);
    if (g) g.rows.push(row);
    else {
      groups.set(key, { rows: [row], canon });
      order.push(key);
    }
  }
  if (groups.size === rows.length) {
    // Nenhuma fusão real — ainda assim canoniza as dims (ordenação/labels).
  }

  const out: WidgetRow[] = [];
  for (const key of order) {
    const g = groups.get(key)!;
    const merged: WidgetRow = { ...g.rows[0] };
    dims.forEach((_, i) => {
      merged[`dim_${i + 1}`] = g.canon[i] ?? null;
    });
    for (const spec of metrics) {
      merged[spec.key] = foldMetric(g.rows, spec);
    }
    // __money: fusão exata por métrica (o engine replota metric_<n> depois).
    const moneyKeys = new Set<string>();
    for (const r of g.rows) {
      for (const k of Object.keys(r.__money ?? {})) moneyKeys.add(k);
    }
    if (moneyKeys.size > 0) {
      const money: Record<string, MoneyBreakdown> = {};
      for (const k of moneyKeys) {
        money[k] = foldBreakdowns(g.rows.map((r) => r.__money?.[k]));
      }
      merged.__money = money;
    }
    // Basis das calculadas: fundidas para os subtotais/Total geral a jusante
    // continuarem exatos (fold de fold = fold).
    if (g.rows.some((r) => r.__calcOps)) {
      merged.__calcOps = foldBasis(g.rows.map((r) => r.__calcOps));
    }
    const byKeys = new Set<string>();
    for (const r of g.rows) {
      for (const k of Object.keys(r.__calcOpsBy ?? {})) byKeys.add(k);
    }
    if (byKeys.size > 0) {
      const by: NonNullable<WidgetRow["__calcOpsBy"]> = {};
      for (const k of byKeys) {
        by[k] = foldBasis(
          g.rows.map((r) => r.__calcOpsBy?.[k] as BasisValues | undefined)
        );
      }
      merged.__calcOpsBy = by;
    }
    out.push(merged);
  }
  return out;
}
