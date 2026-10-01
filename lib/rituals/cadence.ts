// Versão: 1.0 | Data: 01/10/2026
// Cadência de RITUAIS (0149) — módulo PURO e client-safe.
//
// Um ritual é uma rotina de acompanhamento SEM registro ("revisar conversão
// toda sexta", "fechar os N1 no último dia útil", "reunião N0 mensal"). Ele
// vive num nó da Tree (mapa livre) e vira tarefa de duas formas: pelo botão
// "Agendar próxima" (padrão) ou sozinho, pelo tick (opt-in `auto`).
//
// A ocorrência é DERIVADA do calendário, como a da série (0132): a N-ésima
// ocorrência é uma função de (âncora, cadência, N) — nunca um contador nem uma
// "última execução" gravada. É isso que deixa a trava ser o índice único
// `(ritual_node_id, ritual_occurrence)` e que faz tick perdido não
// dessincronizar nada. Nunca anda para trás: ocorrência vencida que ninguém
// abriu não vira tarefa retroativa.
import { isBusinessDay } from "@/lib/date/business-days";

export type RitualCadence = "diario_util" | "semanal" | "mensal" | "dias";

export const RITUAL_CADENCE_LABELS: Record<RitualCadence, string> = {
  diario_util: "Todo dia útil",
  semanal: "Semanal",
  mensal: "Mensal",
  dias: "A cada N dias",
};

export const WEEKDAY_LABELS = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
] as const;

export interface RitualSchedule {
  cadence: RitualCadence;
  /** Semanal: 0 = domingo … 6 = sábado (padrão: segunda). */
  weekday?: number;
  /** Mensal: dia do mês (1–31, cortado no fim do mês) ou o último dia útil. */
  monthDay?: number | "ultimo_util";
  /** "A cada N dias": N (1–365). */
  everyDays?: number;
  /** Primeiro dia possível (YYYY-MM-DD). */
  anchor: string;
  /** Último dia possível (inclusive). Ausente = sem fim. */
  until?: string;
}

/** Teto de iterações — uma cadência diária de 10 anos cabe com folga. */
const MAX_STEPS = 4000;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(v: unknown): v is string {
  return typeof v === "string" && ISO_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

function toUtc(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  return fromUtc(toUtc(iso) + n * 86_400_000);
}

function weekdayOf(iso: string): number {
  return new Date(toUtc(iso)).getUTCDay();
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function monthDate(y: number, m: number, day: number | "ultimo_util", holidays: Set<string>): string {
  const total = daysInMonth(y, m);
  if (day === "ultimo_util") {
    for (let d = total; d >= 1; d -= 1) {
      const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (isBusinessDay(iso, holidays)) return iso;
    }
    return `${y}-${String(m).padStart(2, "0")}-${String(total).padStart(2, "0")}`;
  }
  const d = Math.min(Math.max(1, Math.trunc(day)), total);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * As ocorrências, em ordem, a partir da âncora: um gerador PURO. Para no
 * `until` e no teto de passos.
 */
export function* ritualOccurrences(
  s: RitualSchedule,
  holidays: Set<string> = new Set()
): Generator<{ n: number; date: string }> {
  if (!isIsoDay(s.anchor)) return;
  const past = (iso: string) => s.until != null && isIsoDay(s.until) && iso > s.until;
  let n = 0;
  switch (s.cadence) {
    case "diario_util": {
      let d = s.anchor;
      for (let i = 0; i < MAX_STEPS * 2 && n < MAX_STEPS; i += 1) {
        if (past(d)) return;
        if (isBusinessDay(d, holidays)) yield { n: n++, date: d };
        d = addDays(d, 1);
      }
      return;
    }
    case "semanal": {
      const wd = Number.isInteger(s.weekday) ? ((s.weekday! % 7) + 7) % 7 : 1;
      let d = addDays(s.anchor, (wd - weekdayOf(s.anchor) + 7) % 7);
      for (; n < MAX_STEPS; d = addDays(d, 7)) {
        if (past(d)) return;
        yield { n: n++, date: d };
      }
      return;
    }
    case "mensal": {
      const day = s.monthDay ?? 1;
      let y = Number(s.anchor.slice(0, 4));
      let m = Number(s.anchor.slice(5, 7));
      for (let i = 0; i < MAX_STEPS && n < MAX_STEPS; i += 1) {
        const d = monthDate(y, m, day, holidays);
        if (d >= s.anchor) {
          if (past(d)) return;
          yield { n: n++, date: d };
        }
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
      }
      return;
    }
    case "dias": {
      const step = Math.min(365, Math.max(1, Math.trunc(s.everyDays ?? 1)));
      for (let d = s.anchor; n < MAX_STEPS; d = addDays(d, step)) {
        if (past(d)) return;
        yield { n: n++, date: d };
      }
      return;
    }
  }
}

/**
 * A próxima ocorrência a AGENDAR: a primeira de hoje em diante que ainda não
 * tem tarefa (`existing` = ocorrências já criadas, concluídas inclusas — a 3ª
 * revisão aconteceu uma vez na vida). Null = o ritual acabou.
 */
export function nextOpenOccurrence(
  s: RitualSchedule,
  todayIso: string,
  existing: ReadonlySet<number>,
  holidays: Set<string> = new Set()
): { n: number; date: string } | null {
  for (const occ of ritualOccurrences(s, holidays)) {
    if (occ.date < todayIso) continue;
    if (!existing.has(occ.n)) return occ;
  }
  return null;
}

/**
 * Modo automático: as `lookahead` primeiras ocorrências de hoje em diante,
 * menos as que já existem. Nunca retroativa.
 */
export function ritualOccurrencesToOpen(
  s: RitualSchedule,
  todayIso: string,
  existing: ReadonlySet<number>,
  lookahead = 1,
  holidays: Set<string> = new Set()
): { n: number; date: string }[] {
  const out: { n: number; date: string }[] = [];
  let seen = 0;
  const want = Math.min(10, Math.max(1, Math.trunc(lookahead)));
  for (const occ of ritualOccurrences(s, holidays)) {
    if (occ.date < todayIso) continue;
    if (!existing.has(occ.n)) out.push(occ);
    seen += 1;
    if (seen >= want) break;
  }
  return out;
}

/** A cadência por extenso ("Toda sexta", "Último dia útil do mês"…). */
export function describeSchedule(s: RitualSchedule): string {
  switch (s.cadence) {
    case "diario_util":
      return "Todo dia útil";
    case "semanal": {
      const wd = Number.isInteger(s.weekday) ? ((s.weekday! % 7) + 7) % 7 : 1;
      return `Toda ${WEEKDAY_LABELS[wd]}`;
    }
    case "mensal":
      return s.monthDay === "ultimo_util"
        ? "Último dia útil do mês"
        : `Todo dia ${s.monthDay ?? 1} do mês`;
    case "dias":
      return `A cada ${Math.max(1, Math.trunc(s.everyDays ?? 1))} dias`;
  }
}

/** Parse FAIL-CLOSED do agendamento (jsonb do nó). */
export function parseRitualSchedule(raw: unknown): RitualSchedule | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.cadence !== "string" || !(r.cadence in RITUAL_CADENCE_LABELS)) return null;
  if (!isIsoDay(r.anchor)) return null;
  const out: RitualSchedule = { cadence: r.cadence as RitualCadence, anchor: r.anchor };
  if (r.until !== undefined && r.until !== null) {
    if (!isIsoDay(r.until)) return null;
    out.until = r.until;
  }
  if (out.cadence === "semanal") {
    const wd = Number(r.weekday ?? 1);
    if (!Number.isInteger(wd) || wd < 0 || wd > 6) return null;
    out.weekday = wd;
  }
  if (out.cadence === "mensal") {
    if (r.monthDay === "ultimo_util") out.monthDay = "ultimo_util";
    else {
      const d = Number(r.monthDay ?? 1);
      if (!Number.isInteger(d) || d < 1 || d > 31) return null;
      out.monthDay = d;
    }
  }
  if (out.cadence === "dias") {
    const e = Number(r.everyDays);
    if (!Number.isInteger(e) || e < 1 || e > 365) return null;
    out.everyDays = e;
  }
  return out;
}
