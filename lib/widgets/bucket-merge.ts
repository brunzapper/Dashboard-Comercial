// Versão: 1.4 | Data: 07/08/2026
// v1.4 (07/08/2026): dimensão CONDICIONAL (Dimension.caseFormula) — dim com
// expressão SE sobre o PRÓPRIO campo funde valor→rótulo aqui (caseIdx, via
// caseDimValue de lib/widgets/case-dim.ts), pela MESMA mecânica dos buckets;
// expressão multi-campo NÃO passa por aqui (expansão/contração no engine).
// v1.3 (03/08/2026): "Semana Fechada" sáb–sex — dimNeedsClientBucket também
// ativa p/ dim core/`unified:`/`match:` com closedWeek "sab_sex" (as linhas
// chegam como 'day' do servidor — rpcDimForClosedWeek) e bucketCanonicalValue
// ganha a âncora weekStart (segunda | sábado). A aproximação documentada da
// média SIMPLES não-monetária passa a valer também nesse caso.
// v1.2 (26/07/2026): mergeRowsByBucket ganha canonicalização OPCIONAL da
// dimensão responsible_id (agrupamento de responsáveis, 0101) — linhas de um
// apelido fundem com as do principal pela MESMA mecânica dos buckets; sem o
// mapa (ou sem apelidos), byte-idêntico ao v1.1.
// v1.1 (24/07/2026): foldRowGroup extraído do laço de mergeRowsByBucket
// (byte-compatível) — reusado pelo merge "total" das pernas de sub-base
// (lib/widgets/engine.ts).
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
import type { WeekMode, WeekStart } from "./date-buckets";
import {
  dimWeekStart,
  effectiveWeekMode,
  isClosedWeekTransform,
} from "./closed-week";
import {
  caseDimValue,
  dimNeedsCaseFold,
  type CaseExpansion,
} from "./case-dim";

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

function weekStartOf(
  y: number,
  m: number,
  d: number,
  weekStart: WeekStart
): string {
  const utc = Date.UTC(y, m - 1, d);
  const dow = new Date(utc).getUTCDay(); // 0=domingo … 6=sábado
  // Dias desde o início da semana: segunda (histórico) ou sábado ("Semana
  // Fechada" sáb–sex — lib/widgets/closed-week.ts).
  const since = weekStart === "saturday" ? (dow + 1) % 7 : (dow + 6) % 7;
  const ws = new Date(utc - since * DAY_MS);
  return iso(ws.getUTCFullYear(), ws.getUTCMonth() + 1, ws.getUTCDate());
}

/**
 * Valor CANÔNICO do bucket de um valor cru, espelhando o que a RPC produz
 * para colunas core (0085): weekday → isodow 1-7; semanas → início da semana
 * (segunda por default; sábado p/ "Semana Fechada" sáb–sex, cujo bucket é
 * 100% client-side — week_month "restricted" recorta na virada do mês —
 * greatest(week, month)); mês/"por nome" → 1º dia do mês; trimestre → 1º dia
 * do trimestre; ano → 1º de janeiro. Cru não-parseável → null (o chamador
 * mantém o grupo próprio).
 */
export function bucketCanonicalValue(
  raw: unknown,
  transform: Transform,
  weekMode: WeekMode = "restricted",
  weekStart: WeekStart = "monday"
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
      return weekStartOf(y, m, d, weekStart);
    case "week_month": {
      const ws = weekStartOf(y, m, d, weekStart);
      if (weekMode === "full") return ws;
      const monthStart = iso(y, m, 1);
      return ws > monthStart ? ws : monthStart;
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

// A dimensão precisa de bucketização client-side? `custom:` direto com
// transform (core/`unified:`/`match:` agrupam no servidor) — e, desde
// 03/08/2026, QUALQUER ref com "Semana Fechada" sáb–sex: o RPC não produz
// semana de sábado, então a dim desce como 'day' (rpcDimForClosedWeek) e as
// linhas diárias fundem aqui.
export function dimNeedsClientBucket(d: Dimension): boolean {
  return (
    (d.field.startsWith("custom:") &&
      d.transform != null &&
      d.transform !== "none") ||
    (d.closedWeek === "sab_sex" && isClosedWeekTransform(d.transform))
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
 * Funde as linhas do RPC pelo bucket das dims `custom:`+transform e — quando
 * `respCanon` (apelido → principal, agrupamento 0101) vem preenchido — pela
 * dimensão `responsible_id` canonicalizada. Sem dim assim, devolve `rows`
 * INALTERADO (mesma referência — caminho atual segue byte-idêntico). A ORDEM
 * dos grupos segue a primeira ocorrência (o engine reordena cronologicamente
 * depois, pelo valor canônico).
 */
export function mergeRowsByBucket(
  rows: WidgetRow[],
  dims: Dimension[],
  metrics: MergeMetricSpec[],
  respCanon?: Map<string, string>
): WidgetRow[] {
  const bucketIdx: number[] = [];
  const respIdx: number[] = [];
  const caseIdx: number[] = [];
  dims.forEach((d, i) => {
    // Expressão condicional de campo ÚNICO tem precedência (sem transform por
    // definição — caseDimActive — então nunca disputa com o bucket de data).
    if (dimNeedsCaseFold(d)) caseIdx.push(i);
    else if (dimNeedsClientBucket(d)) bucketIdx.push(i);
    else if (
      d.field === "responsible_id" &&
      respCanon != null &&
      respCanon.size > 0
    )
      respIdx.push(i);
  });
  if (
    (bucketIdx.length === 0 && respIdx.length === 0 && caseIdx.length === 0) ||
    rows.length === 0
  )
    return rows;
  const bucketSet = new Set(bucketIdx);
  const respSet = new Set(respIdx);
  const caseSet = new Set(caseIdx);

  const groups = new Map<string, { rows: WidgetRow[]; canon: unknown[] }>();
  const order: string[] = [];
  for (const row of rows) {
    const tuple: unknown[] = [];
    const canon: unknown[] = [];
    dims.forEach((d, i) => {
      const raw = row[`dim_${i + 1}`] ?? null;
      if (caseSet.has(i)) {
        // Valor cru → rótulo da expressão (SE sem "senão" preserva o cru).
        const label = caseDimValue(d.caseFormula!, d, { [d.field]: raw });
        tuple.push(label);
        canon.push(label);
      } else if (bucketSet.has(i)) {
        // weekMode/âncora EFETIVOS: semana fechada força "full" e sáb–sex
        // ancora a semana no sábado (lib/widgets/closed-week.ts).
        const c = bucketCanonicalValue(
          raw,
          d.transform!,
          effectiveWeekMode(d),
          dimWeekStart(d)
        );
        // Cru não-parseável fica num grupo próprio (chave prefixada — nunca
        // colide com um canônico) e mantém o valor original na exibição.
        tuple.push(c == null ? `raw:${String(raw)}` : c);
        canon.push(c == null ? raw : c);
      } else if (respSet.has(i) && raw != null) {
        // Apelido → principal: linhas do apelido caem no grupo do principal
        // (o rótulo id→nome sai depois, já canônico, em fetchFkLabels).
        const c = respCanon!.get(String(raw)) ?? raw;
        tuple.push(c);
        canon.push(c);
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
    const merged = foldRowGroup(g.rows, metrics);
    dims.forEach((_, i) => {
      merged[`dim_${i + 1}`] = g.canon[i] ?? null;
    });
    out.push(merged);
  }
  return out;
}

/**
 * CONTRAÇÃO do mecanismo robusto da dimensão condicional (expressão
 * multi-campo): as linhas do RPC chegam com as dims EXPANDIDAS
 * (planCaseExpansion — o campo da dim + as refs extras como colunas cruas);
 * aqui cada dim expandida vira o RÓTULO avaliado da expressão (tupla de refs
 * → caseDimValue), as demais são re-endereçadas às posições da CONFIG e os
 * grupos que caíram no mesmo rótulo fundem por foldRowGroup (métricas/
 * `__money`/basis — o engine replota as monetárias depois). Colunas
 * excedentes são removidas — a jusante (comparação, rotulagem, charts) o
 * shape é o da config, como em qualquer rodada.
 */
export function contractCaseRows(
  rows: WidgetRow[],
  dims: Dimension[],
  expansion: CaseExpansion,
  metrics: MergeMetricSpec[]
): WidgetRow[] {
  if (rows.length === 0) return rows;
  const groups = new Map<string, { rows: WidgetRow[]; values: unknown[] }>();
  const order: string[] = [];
  for (const row of rows) {
    const values: unknown[] = [];
    dims.forEach((d, i) => {
      const cols = expansion.colsOfDim[i];
      const refs = expansion.refsOfDim[i];
      if (!refs) {
        values.push(row[`dim_${cols[0] + 1}`] ?? null);
        return;
      }
      const rawByRef: Record<string, unknown> = {};
      refs.forEach((ref, k) => {
        rawByRef[ref] = row[`dim_${cols[k] + 1}`] ?? null;
      });
      values.push(caseDimValue(d.caseFormula!, d, rawByRef));
    });
    const key = JSON.stringify(values);
    const g = groups.get(key);
    if (g) g.rows.push(row);
    else {
      groups.set(key, { rows: [row], values });
      order.push(key);
    }
  }
  const expandedCount = expansion.rpcDims.length;
  const out: WidgetRow[] = [];
  for (const key of order) {
    const g = groups.get(key)!;
    const merged = foldRowGroup(g.rows, metrics);
    for (let i = 0; i < expandedCount; i++) delete merged[`dim_${i + 1}`];
    dims.forEach((_, i) => {
      merged[`dim_${i + 1}`] = g.values[i] ?? null;
    });
    out.push(merged);
  }
  return out;
}

/**
 * Funde UM grupo de linhas (mesmo bucket/tupla) numa linha só: métricas pelo
 * spec (foldMetric), `__money` por foldBreakdowns e as basis das calculadas
 * por foldBasis (fold de fold = fold — subtotais a jusante seguem exatos).
 * Demais chaves (dims, __cmp, __goal…) vêm da 1ª linha — o chamador ajusta.
 * Extraído de mergeRowsByBucket (byte-compatível); reusado pelo merge "total"
 * das pernas de sub-base (lib/widgets/engine.ts, 24/07/2026).
 */
export function foldRowGroup(
  rows: WidgetRow[],
  metrics: MergeMetricSpec[]
): WidgetRow {
  const merged: WidgetRow = { ...rows[0] };
  for (const spec of metrics) {
    merged[spec.key] = foldMetric(rows, spec);
  }
  // __money: fusão exata por métrica (o engine replota metric_<n> depois).
  const moneyKeys = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r.__money ?? {})) moneyKeys.add(k);
  }
  if (moneyKeys.size > 0) {
    const money: Record<string, MoneyBreakdown> = {};
    for (const k of moneyKeys) {
      money[k] = foldBreakdowns(rows.map((r) => r.__money?.[k]));
    }
    merged.__money = money;
  }
  // Basis das calculadas: fundidas para os subtotais/Total geral a jusante
  // continuarem exatos (fold de fold = fold).
  if (rows.some((r) => r.__calcOps)) {
    merged.__calcOps = foldBasis(rows.map((r) => r.__calcOps));
  }
  const byKeys = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r.__calcOpsBy ?? {})) byKeys.add(k);
  }
  if (byKeys.size > 0) {
    const by: NonNullable<WidgetRow["__calcOpsBy"]> = {};
    for (const k of byKeys) {
      by[k] = foldBasis(
        rows.map((r) => r.__calcOpsBy?.[k] as BasisValues | undefined)
      );
    }
    merged.__calcOpsBy = by;
  }
  return merged;
}
