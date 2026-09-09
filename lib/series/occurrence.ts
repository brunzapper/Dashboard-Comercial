// Versão: 1.0 | Data: 09/09/2026
// A OCORRÊNCIA DEVIDA de uma série — o coração da recorrência, e puro.
//
// A decisão de desenho: a ocorrência é DERIVADA, nunca contada. Dado o dia da
// âncora e a cadência, a N-ésima cobrança é `floor(dias / cadência)` — o tick
// calcula qual está devida HOJE e tenta criá-la; repetir esbarra no índice
// único (0132) e é no-op. Não existe "última execução" gravada.
//
// Por que assim: o tick roda a cada minuto e pode pular rodadas (deploy, fila,
// orçamento de tempo). Um contador incremental erraria a conta na primeira
// rodada perdida e ninguém saberia; a derivação sempre reconstrói a mesma
// sequência a partir dos fatos — a mesma filosofia do payload_hash da 0130.
// É também o que faz a Tree conseguir desenhar cobranças passadas que nunca
// chegaram a virar tarefa.
import { addDaysIso, daysSince } from "@/lib/date/days";
import { recordRawValue } from "@/lib/widgets/quick-filters";
import type { AvailableField } from "@/lib/widgets/fields";
import type { RecordRow } from "@/lib/records/types";

import type { SeriesAnchor, SeriesBound, SeriesConfig } from "./types";

export interface OccurrencePlan {
  /** N-ésima cobrança devida hoje (0 = a do próprio dia da âncora). */
  occurrence: number;
  /** Dia previsto dela — vira o prazo da tarefa. */
  dueDate: string;
  /** Dia da âncora, para a Tree explicar de onde a contagem saiu. */
  anchorDate: string;
}

export interface OccurrenceInput {
  anchorDate: string | null;
  /** Cadência JÁ resolvida pela cascata (lib/series/cadence.ts). */
  cadenceDays: number;
  todayIso: string;
  /** Bordas já resolvidas em datas pelo chamador (campo ou data fixa). */
  fromDate?: string | null;
  untilDate?: string | null;
  firstAt: SeriesConfig["firstAt"];
  maxOccurrences?: number;
}

/**
 * Qual cobrança está devida hoje — ou null quando nenhuma está.
 *
 * Null (nunca cria) quando: não há âncora (o campo nunca foi preenchido — e
 * data ausente jamais vira "hoje"), o dia de hoje está fora da janela, a série
 * já passou do teto de cobranças, ou a primeira cobrança ainda não venceu.
 */
export function dueOccurrence(input: OccurrenceInput): OccurrencePlan | null {
  const anchor = input.anchorDate?.slice(0, 10);
  if (!anchor || !/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return null;

  const cadence = Math.floor(input.cadenceDays);
  if (!Number.isFinite(cadence) || cadence < 1) return null;

  const today = input.todayIso.slice(0, 10);
  // Janela: a borda inicial atrasa o começo da cobrança sem mover a ÂNCORA —
  // o relógio continua contado da mudança de etapa.
  if (input.fromDate && today < input.fromDate.slice(0, 10)) return null;
  if (input.untilDate && today > input.untilDate.slice(0, 10)) return null;

  const elapsed = daysSince(anchor, today);
  if (elapsed == null || elapsed < 0) return null;

  const occurrence = Math.floor(elapsed / cadence);
  // "Um ciclo depois" é o padrão: entrou hoje, cobra na virada da quinzena.
  // Cobrar no mesmo dia em que o registro entrou é ruído, não acompanhamento.
  if (input.firstAt === "apos_um_ciclo" && occurrence < 1) return null;
  if (input.maxOccurrences && occurrence > input.maxOccurrences) return null;

  return {
    occurrence,
    dueDate: addDaysIso(anchor, occurrence * cadence),
    anchorDate: anchor,
  };
}

/**
 * Todas as cobranças previstas até hoje — o tronco da Tree, inclusive as que
 * não viraram tarefa (rodada perdida, série ligada depois). É o que permite
 * ler "na 3ª cobrança ele não fez nada" em vez de simplesmente não ver a 3ª.
 */
export function occurrencesUntil(input: OccurrenceInput): OccurrencePlan[] {
  const last = dueOccurrence({ ...input, firstAt: "imediato" });
  if (!last) return [];
  const first = input.firstAt === "apos_um_ciclo" ? 1 : 0;
  const out: OccurrencePlan[] = [];
  for (let n = first; n <= last.occurrence; n += 1) {
    out.push({
      occurrence: n,
      dueDate: addDaysIso(last.anchorDate, n * Math.floor(input.cadenceDays)),
      anchorDate: last.anchorDate,
    });
  }
  return out;
}

/** Os fatos que a âncora pode ler — os MESMOS que a rodada já carrega. */
export interface AnchorFacts {
  record: RecordRow;
  /** records.field_modified_at — o "desde que mudou para esta etapa". */
  fieldModifiedAt: Record<string, string> | null;
  /** records.source_created_at. */
  sourceCreatedAt: string | null;
  available: AvailableField[];
}

/**
 * O dia em que o relógio começa a contar. null = não começou (o campo nunca
 * foi preenchido) — e a série simplesmente não cobra, em vez de cobrar desde
 * uma data inventada.
 */
export function resolveAnchorDate(
  anchor: SeriesAnchor,
  facts: AnchorFacts
): string | null {
  const iso = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.slice(0, 10) : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };
  if (anchor.kind === "created") return iso(facts.sourceCreatedAt);
  if (anchor.kind === "field_changed") {
    return iso(facts.fieldModifiedAt?.[anchor.field]);
  }
  return iso(recordRawValue(anchor.field, facts.record, facts.available));
}

/** Uma borda da janela (campo do registro ou data fixa) virada em data. */
export function resolveBound(
  bound: SeriesBound | undefined,
  facts: AnchorFacts
): string | null {
  if (!bound) return null;
  if (bound.kind === "date") return bound.date;
  // v1.1 (09/09/2026): "para quando esse campo mudar". A data-limite é o DIA da
  // alteração — a cobrança daquele dia ainda vale (o campo mudou depois de ela
  // vencer), as seguintes não. Campo nunca alterado ⇒ null ⇒ não limita, que é
  // a mesma leniência do campo de data vazio logo abaixo.
  const raw =
    bound.kind === "field_changed"
      ? facts.fieldModifiedAt?.[bound.field]
      : recordRawValue(bound.field, facts.record, facts.available);
  const s = typeof raw === "string" ? raw.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
