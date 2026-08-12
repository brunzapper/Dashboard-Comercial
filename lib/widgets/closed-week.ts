// Versão: 1.1 | Data: 12/08/2026
// v1.1 (12/08/2026): regra do snap trocada da MAIORIA (4+ dias) pela
//   EXPANSÃO — ver abaixo. O RÓTULO/dono de mês do bucket (date-buckets:
//   mês do 4º dia) NÃO mudou: snap e rótulo seguem convenções distintas.
// "Semana Fechada" (Dimension.closedWeek): widgets semanais exibem semanas
// COMPLETAS mesmo quando o período filtrado corta as bordas (ex.: "Este mês").
// Módulo PURO (sem I/O), consumido pelo engine — os RPCs de widget seguem
// intocados (invariante 1): a expansão acontece no período da RODADA e a
// bucketização sáb–sex é client-side (bucket-merge).
//
// Regra da EXPANSÃO: o período cobre TODA semana que ele toca, inteira — o
// `from` abre p/ trás até o início da semana e o `to` p/ frente até o fim
// dela. Consequência: semanas de borda aparecem nos períodos dos DOIS meses
// vizinhos (agosto/26 seg–dom exibe de 27/07–02/08 até 31/08–06/09; julho/26
// termina na MESMA semana 27/07–02/08 — dupla contagem consciente em
// comparações mês a mês). O snap é IDEMPOTENTE e nunca produz `from > to`
// (período curto vira a semana inteira que o contém).
import type { Dimension, Transform } from "./types";
import type { DashboardPeriod } from "./period";
import type { WeekMode, WeekStart } from "./date-buckets";

export type ClosedWeek = "seg_dom" | "sab_sex";

// "week" é transform legado (fora de DATE_TRANSFORMS da UI) mas ainda aceito
// pelo RPC — coberto por completude.
const CLOSED_WEEK_TRANSFORMS = new Set<Transform>([
  "week",
  "week_year",
  "week_month",
]);

export function isClosedWeekTransform(t: Transform | undefined): boolean {
  return t != null && CLOSED_WEEK_TRANSFORMS.has(t);
}

export function isClosedWeek(v: unknown): v is ClosedWeek {
  return v === "seg_dom" || v === "sab_sex";
}

/**
 * Modo de semana fechada da RODADA: a 1ª dimensão semanal com `closedWeek`
 * define o snap do período (dims adicionais mantêm a própria bucketização).
 * Dim com dateAgg nunca chega aqui (o caminho "Agrupar período" retorna antes).
 */
export function closedWeekOf(dims: Dimension[]): ClosedWeek | null {
  for (const d of dims) {
    if (isClosedWeek(d.closedWeek) && isClosedWeekTransform(d.transform))
      return d.closedWeek;
  }
  return null;
}

const DAY_MS = 86_400_000;

// Prefixo ISO YYYY-MM-DD (byte-igual ao parseYmd de date-buckets — lê o dia
// LITERAL, sem conversão de fuso).
function ymdUtc(value: string): number | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function isoOf(utc: number): string {
  const d = new Date(utc);
  const y = String(d.getUTCFullYear()).padStart(4, "0");
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function weekStartUtc(utc: number, mode: ClosedWeek): number {
  const dow = new Date(utc).getUTCDay(); // 0=domingo … 6=sábado
  // Dias desde o início da semana: segunda p/ seg_dom, sábado p/ sab_sex.
  const since = mode === "sab_sex" ? (dow + 1) % 7 : (dow + 6) % 7;
  return utc - since * DAY_MS;
}

/** Início (segunda ou sábado) da semana que contém a data. */
export function weekStartIso(iso: string, mode: ClosedWeek): string {
  const utc = ymdUtc(iso);
  return utc == null ? iso : isoOf(weekStartUtc(utc, mode));
}

/**
 * Snap das bordas pela regra da expansão: cada bound presente abre até a
 * fronteira da semana que o contém (`from` p/ trás, `to` p/ frente) — toda
 * semana tocada entra inteira. Bound null segue null; token não-ISO
 * (`@today` etc.) é passthrough. Nunca produz from > to.
 */
export function snapRangeToClosedWeek(
  from: string | null | undefined,
  to: string | null | undefined,
  mode: ClosedWeek
): { from: string | null; to: string | null } {
  let outFrom = from ?? null;
  let outTo = to ?? null;
  if (outFrom != null) {
    const utc = ymdUtc(outFrom);
    if (utc != null) outFrom = isoOf(weekStartUtc(utc, mode));
  }
  if (outTo != null) {
    const utc = ymdUtc(outTo);
    if (utc != null) outTo = isoOf(weekStartUtc(utc, mode) + 6 * DAY_MS);
  }
  return { from: outFrom, to: outTo };
}

/**
 * Período da RODADA com as bordas snapadas (field/fieldBySource/preset
 * preservados). Null/sem bounds ("todo o período") = passthrough. Idempotente
 * — pernas de sub-fonte que recursam runWidget re-snapam sem efeito.
 */
export function snapPeriodToClosedWeek(
  period: DashboardPeriod | null | undefined,
  mode: ClosedWeek
): DashboardPeriod | null | undefined {
  if (!period || (period.from == null && period.to == null)) return period;
  return { ...period, ...snapRangeToClosedWeek(period.from, period.to, mode) };
}

/**
 * Dimensão ENVIADA ao RPC quando a semana fechada está ativa — a dim ORIGINAL
 * segue mandando no merge/labels/ordenação:
 *  - `custom:` → inalterada (o RPC agrupa pelo valor CRU; o bucket-merge já
 *    funde client-side com o weekMode efetivo);
 *  - seg_dom + week_month → weekMode "full" (mata o recorte `greatest`);
 *  - seg_dom + week/week_year → inalterada (segunda ISO já é o default);
 *  - sab_sex (core/`unified:`/`match:`) → transform 'day' (legal em todos os
 *    ramos da RPC) e o engine funde os dias em semanas de sábado.
 */
export function rpcDimForClosedWeek(d: Dimension): Dimension {
  if (!isClosedWeek(d.closedWeek) || !isClosedWeekTransform(d.transform))
    return d;
  if (d.field.startsWith("custom:")) return d;
  if (d.closedWeek === "sab_sex")
    return { ...d, transform: "day", weekMode: undefined };
  return d.transform === "week_month" ? { ...d, weekMode: "full" } : d;
}

/** weekMode EFETIVO p/ merge/rótulo: semana fechada força "full". */
export function effectiveWeekMode(d: Dimension): WeekMode | undefined {
  if (isClosedWeek(d.closedWeek) && isClosedWeekTransform(d.transform))
    return "full";
  return d.weekMode;
}

/** Âncora de semana da dim p/ bucket/rótulo (default segunda). */
export function dimWeekStart(d: Dimension): WeekStart {
  return d.closedWeek === "sab_sex" && isClosedWeekTransform(d.transform)
    ? "saturday"
    : "monday";
}
