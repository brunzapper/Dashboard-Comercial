// Versão: 1.0 | Data: 17/09/2026
// A regra de negócio INTEIRA da Base manual, em módulo PURO e sem I/O: quanto
// de um lançamento cai dentro de uma janela.
//
// "Janela" é sempre a mesma coisa em dois papéis: o período do dashboard e o
// bucket de uma dimensão de data. Por isso existe UMA função — o engine a
// chama com o período na consulta sem dimensão (KPI/card/total) e com cada
// bucket quando há dimensão cronológica. Duas contas separadas divergiriam no
// primeiro caso de borda.
//
// Datas são strings `YYYY-MM-DD` de Brasília em todo o caminho (invariante 11 —
// o read side é prefix-based). `Date` aparece só como aritmética de dias sobre
// `Date.UTC`, que é bijetiva e independente do fuso do processo; NUNCA para
// interpretar um instante.
import {
  DEFAULT_MANUAL_SPREAD,
  type ManualEntry,
  type ManualSpread,
} from "./types";

const DAY_MS = 86_400_000;

/** Prefixo ISO → dia UTC. Byte-igual ao `parseYmd`/`ymd` de date-buckets e
 *  bucket-merge (lê o dia LITERAL, sem conversão de fuso). */
export function dayNum(value: unknown): number | null {
  if (value == null) return null;
  const m = String(value)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t / DAY_MS : null;
}

/** Dia UTC → `YYYY-MM-DD`. */
export function dayIso(n: number): string {
  const d = new Date(n * DAY_MS);
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(
    d.getUTCMonth() + 1
  ).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Uma janela fechada nos dois lados. `null` = sem limite (todo período). */
export interface ManualWindow {
  from: string | null;
  to: string | null;
}

/** Dias inclusivos entre dois dias UTC (a <= b ⇒ >= 1). */
function inclusiveDays(a: number, b: number): number {
  return b - a + 1;
}

/**
 * Quanto do lançamento cai na janela, segundo o modo DELE.
 *
 * Contrato: sempre um número finito (0 quando não entra) — nunca null. Um
 * lançamento que não entra é zero contribuído, não operando ausente; quem
 * decide "—" é a ausência de lançamento nenhum, lá em cima.
 *
 * Lançamento com datas ilegíveis contribui 0: preferir o silêncio a inventar
 * um dia. `period_end < period_start` não acontece (CHECK no banco), mas se
 * acontecer é tratado como um único dia.
 */
export function manualValueForWindow(
  entry: Pick<ManualEntry, "period_start" | "period_end" | "value" | "spread">,
  window: ManualWindow
): number {
  const start = dayNum(entry.period_start);
  const endRaw = dayNum(entry.period_end);
  if (start == null) return 0;
  const end = endRaw == null || endRaw < start ? start : endRaw;

  const value = Number(entry.value);
  if (!Number.isFinite(value)) return 0;

  const from = dayNum(window.from);
  const to = dayNum(window.to);
  const spread: ManualSpread = entry.spread ?? DEFAULT_MANUAL_SPREAD;

  const afterFrom = (d: number) => from == null || d >= from;
  const beforeTo = (d: number) => to == null || d <= to;

  switch (spread) {
    case "ancora":
      return afterFrom(start) && beforeTo(start) ? value : 0;

    case "intersecao":
      // Toca a janela em pelo menos um dia.
      return beforeTo(start) && afterFrom(end) ? value : 0;

    case "contido":
      return afterFrom(start) && beforeTo(end) ? value : 0;

    case "diario": {
      const lo = from == null ? start : Math.max(start, from);
      const hi = to == null ? end : Math.min(end, to);
      if (hi < lo) return 0;
      const total = inclusiveDays(start, end);
      if (total <= 0) return 0;
      return (value / total) * inclusiveDays(lo, hi);
    }
  }
}

/** Soma dos lançamentos de uma janela. O choke point do caminho ESCALAR
 *  (runCalculatedWidget, KPI/card, Total geral sem dimensão cronológica). */
export function sumManualEntries(
  entries: readonly ManualEntry[],
  window: ManualWindow
): number {
  let out = 0;
  for (const e of entries) out += manualValueForWindow(e, window);
  return out;
}

/** O lançamento encosta na janela? Pré-filtro barato antes de projetar em
 *  buckets — vale para os 4 modos (nenhum contribui fora do próprio
 *  intervalo). */
export function manualEntryTouches(
  entry: Pick<ManualEntry, "period_start" | "period_end">,
  window: ManualWindow
): boolean {
  const start = dayNum(entry.period_start);
  if (start == null) return false;
  const endRaw = dayNum(entry.period_end);
  const end = endRaw == null || endRaw < start ? start : endRaw;
  const from = dayNum(window.from);
  const to = dayNum(window.to);
  return (to == null || start <= to) && (from == null || end >= from);
}
