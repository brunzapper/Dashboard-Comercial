// Versão: 1.4 | Data: 10/09/2026
// A OCORRÊNCIA DEVIDA de uma série — o coração da recorrência, e puro.
//
// v1.4 (10/09/2026): `occurrencesToOpen` — a janela de futuras passa a ser
// reposta por CONCLUSÃO, não pela virada do ciclo. `occurrencesAhead` fica
// para quem só quer a janela de tempo (e para a compatibilidade dos testes).
//
// v1.3 (10/09/2026): só vocabulário — o substantivo da ocorrência saiu do
// código e virou dado (`SeriesConfig.noun`, lib/series/types.ts v1.4).
//
// A decisão de desenho: a ocorrência é DERIVADA, nunca contada. Dado o dia da
// âncora e a cadência, a N-ésima ocorrência é `floor(dias / cadência)` — o tick
// calcula qual está devida HOJE e tenta criá-la; repetir esbarra no índice
// único (0132) e é no-op. Não existe "última execução" gravada.
//
// Por que assim: o tick roda a cada minuto e pode pular rodadas (deploy, fila,
// orçamento de tempo). Um contador incremental erraria a conta na primeira
// rodada perdida e ninguém saberia; a derivação sempre reconstrói a mesma
// sequência a partir dos fatos — a mesma filosofia do payload_hash da 0130.
// É também o que faz a Tree conseguir desenhar ocorrências passadas que nunca
// chegaram a virar tarefa.
import { addDaysIso, daysSince } from "@/lib/date/days";
import { recordRawValue } from "@/lib/widgets/quick-filters";
import type { AvailableField } from "@/lib/widgets/fields";
import type { RecordRow } from "@/lib/records/types";

import type {
  SeriesAnchor,
  SeriesAnchorFallback,
  SeriesBound,
  SeriesConfig,
} from "./types";

export interface OccurrencePlan {
  /** N-ésima ocorrência devida hoje (0 = a do próprio dia da âncora). */
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
 * Qual ocorrência está devida hoje — ou null quando nenhuma está.
 *
 * Null (nunca cria) quando: não há âncora (o campo nunca foi preenchido — e
 * data ausente jamais vira "hoje"), o dia de hoje está fora da janela, a série
 * já passou do teto de ocorrências, ou a primeira ainda não venceu.
 */
export function dueOccurrence(input: OccurrenceInput): OccurrencePlan | null {
  const anchor = input.anchorDate?.slice(0, 10);
  if (!anchor || !/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return null;

  const cadence = Math.floor(input.cadenceDays);
  if (!Number.isFinite(cadence) || cadence < 1) return null;

  const today = input.todayIso.slice(0, 10);
  // Janela: a borda inicial atrasa o começo da série sem mover a ÂNCORA —
  // o relógio continua contado da mudança de etapa.
  if (input.fromDate && today < input.fromDate.slice(0, 10)) return null;
  if (input.untilDate && today > input.untilDate.slice(0, 10)) return null;

  const elapsed = daysSince(anchor, today);
  if (elapsed == null || elapsed < 0) return null;

  const occurrence = Math.floor(elapsed / cadence);
  // "Um ciclo depois" é o padrão: entrou hoje, a primeira sai na virada da
  // quinzena. Abrir no mesmo dia em que o registro entrou é ruído.
  if (input.firstAt === "apos_um_ciclo" && occurrence < 1) return null;
  if (input.maxOccurrences && occurrence > input.maxOccurrences) return null;

  return {
    occurrence,
    dueDate: addDaysIso(anchor, occurrence * cadence),
    anchorDate: anchor,
  };
}

/**
 * Todas as ocorrências previstas até hoje — o tronco da Tree, inclusive as que
 * não viraram tarefa (rodada perdida, série ligada depois). É o que permite
 * ler "na 3ª ele não fez nada" em vez de simplesmente não ver a 3ª.
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

/**
 * As ocorrências a MANTER ABERTAS hoje: a devida agora e as `count` seguintes.
 *
 * v1.2 (09/09/2026): é o que faz a série deixar de ser invisível. Antes só
 * existia a ocorrência do dia, então num ciclo quinzenal o vendedor passava 15
 * dias sem ver nada — e não tinha como remarcar o que ainda ia vencer.
 *
 * NUNCA emite ocorrência já vencida que não seja a devida agora: criar as
 * atrasadas de uma vez abriria dezenas de tarefas vencidas no nome de gente
 * que nunca foi avisada de que a série existia. A Tree continua desenhando as
 * passadas (occurrencesUntil), que é onde a falta de acompanhamento deve
 * aparecer — como galho vazio, não como tarefa fabricada hoje.
 *
 * Criar adiantado é seguro: a trava da 0132 é por (regra, registro,
 * ocorrência), então repetir esbarra no índice e é no-op.
 */
export function occurrencesAhead(
  input: OccurrenceInput,
  count: number
): OccurrencePlan[] {
  const ahead = Math.max(0, Math.floor(count));
  const cadence = Math.floor(input.cadenceDays);
  if (!Number.isFinite(cadence) || cadence < 1) return [];

  // A devida hoje ancora a janela. Sem ela (antes da primeira, ou fora da
  // janela) não há de onde partir — e adiantar seria começar cedo demais.
  const due = dueOccurrence(input);
  if (!due) return [];

  const out: OccurrencePlan[] = [];
  for (let n = due.occurrence; n <= due.occurrence + ahead; n += 1) {
    if (input.maxOccurrences && n > input.maxOccurrences) break;
    const dueDate = addDaysIso(due.anchorDate, n * cadence);
    // A borda final vale para as futuras também: não se agenda tarefa
    // depois do fim declarado da série.
    if (input.untilDate && dueDate > input.untilDate.slice(0, 10)) break;
    out.push({ occurrence: n, dueDate, anchorDate: due.anchorDate });
  }
  return out;
}

/** Uma ocorrência que já existe como tarefa, e se ela ainda está aberta. */
export interface KnownOccurrence {
  occurrence: number;
  /** `completed_at is null` — é o que decide se a janela precisa repor. */
  open: boolean;
}

/**
 * As ocorrências a CRIAR agora para manter `keepAhead` futuras ABERTAS.
 *
 * v1.4 (10/09/2026): substitui `occurrencesAhead` no caminho do tick. A
 * diferença é o gatilho da reposição, e ela importa na prática:
 *
 *   `occurrencesAhead` andava pelo TEMPO — emitia `due … due+N` a partir da
 *   ocorrência devida hoje. Concluir uma não repunha nada; num ciclo quinzenal
 *   o vendedor concluía a próxima e ficava com uma a menos na tela por 15 dias,
 *   até a janela andar sozinha.
 *
 *   Aqui a reposição é por CONCLUSÃO: o estoque de futuras abertas é constante.
 *   Concluiu uma, a seguinte do calendário entra no lugar — o vendedor sempre
 *   vê as mesmas `keepAhead` à frente, enquanto a série valer.
 *
 * O que NÃO muda, e é deliberado:
 *   - as datas continuam saindo do calendário (âncora + n × cadência).
 *     Concluir três seguidas não antecipa nada, só revela o que vem depois;
 *   - NUNCA anda para trás. Ocorrência vencida que ninguém abriu não vira
 *     tarefa retroativa hoje — ela segue como galho vazio da Tree, que é onde
 *     a falta de acompanhamento deve aparecer;
 *   - `until`/`maxOccurrences` cortam as futuras também: não se agenda tarefa
 *     depois do fim declarado da série.
 */
export function occurrencesToOpen(
  input: OccurrenceInput,
  opts: { keepAhead: number; known: KnownOccurrence[] }
): OccurrencePlan[] {
  const keepAhead = Math.max(0, Math.floor(opts.keepAhead));
  const cadence = Math.floor(input.cadenceDays);
  if (!Number.isFinite(cadence) || cadence < 1) return [];

  // Sem a devida hoje não há de onde partir (antes da primeira, fora da janela,
  // sem âncora). Adiantar daí seria começar a série cedo demais.
  const due = dueOccurrence(input);
  if (!due) return [];

  const knownByN = new Map<number, boolean>();
  for (const k of opts.known) knownByN.set(k.occurrence, k.open);

  const until = input.untilDate ? input.untilDate.slice(0, 10) : null;
  const out: OccurrencePlan[] = [];
  const plan = (n: number): OccurrencePlan | null => {
    if (input.maxOccurrences && n > input.maxOccurrences) return null;
    const dueDate = addDaysIso(due.anchorDate, n * cadence);
    if (until && dueDate > until) return null;
    return { occurrence: n, dueDate, anchorDate: due.anchorDate };
  };

  // A devida hoje, se ainda não existe. Ela não conta como "futura".
  if (!knownByN.has(due.occurrence)) {
    const p = plan(due.occurrence);
    if (!p) return out;
    out.push(p);
  }

  // Quantas futuras já estão abertas hoje.
  let openAhead = 0;
  for (const [n, open] of knownByN) {
    if (open && n > due.occurrence) openAhead += 1;
  }

  // Anda para frente pulando o que já existe (aberto OU concluído: a ocorrência
  // aconteceu uma vez na vida — trava da 0132) até completar o estoque.
  let n = due.occurrence + 1;
  const ceiling = due.occurrence + keepAhead + knownByN.size + 1;
  while (openAhead < keepAhead && n <= ceiling) {
    if (!knownByN.has(n)) {
      const p = plan(n);
      // Bateu no fim da série: não há mais o que repor.
      if (!p) break;
      out.push(p);
      openAhead += 1;
    }
    n += 1;
  }

  return out;
}

/** Os fatos que a âncora pode ler — os MESMOS que a rodada já carrega. */
export interface AnchorFacts {
  record: RecordRow;
  /**
   * Última alteração de cada campo, do HISTÓRICO (audit_log + edição local),
   * já resolvida para este registro pelo loader batelado.
   *
   * v1.1 (09/09/2026): era `fieldModifiedAt` (records.field_modified_at) — e
   * aquilo NÃO é histórico de alteração, é o marcador de "editado localmente,
   * proteja do sync". Para campo vindo do Bitrix ficava sempre vazio, então a
   * âncora `field_changed` nunca resolvia e a série jamais gerava nada. Ver
   * lib/records/field-history.ts.
   */
  changedAt: Map<string, string> | null;
  /** records.source_created_at. */
  sourceCreatedAt: string | null;
  available: AvailableField[];
}

/**
 * O dia em que o relógio começa a contar. null = não começou (o campo nunca
 * foi preenchido) — e a série simplesmente não gera nada, em vez de contar desde
 * uma data inventada.
 */
export function resolveAnchorDate(
  anchor: SeriesAnchor,
  facts: AnchorFacts,
  fallback: SeriesAnchorFallback = "nenhum"
): string | null {
  const iso = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.slice(0, 10) : "";
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };
  const direct =
    anchor.kind === "created"
      ? iso(facts.sourceCreatedAt)
      : anchor.kind === "field_changed"
        ? // v1.1: do histórico, não do marcador de proteção do sync.
          iso(facts.changedAt?.get(anchor.field))
        : iso(recordRawValue(anchor.field, facts.record, facts.available));
  if (direct) return direct;
  // v1.2: o registro que já estava na etapa antes de a série existir não tem
  // histórico. "criacao" o traz para dentro por uma data REAL; "nenhum" (o
  // padrão) prefere não gerar nada a gerar por uma data inventada.
  return fallback === "criacao" ? iso(facts.sourceCreatedAt) : null;
}

/** Uma borda da janela (campo do registro ou data fixa) virada em data. */
export function resolveBound(
  bound: SeriesBound | undefined,
  facts: AnchorFacts
): string | null {
  if (!bound) return null;
  if (bound.kind === "date") return bound.date;
  // v1.1 (09/09/2026): "para quando esse campo mudar". A data-limite é o DIA da
  // alteração — a ocorrência daquele dia ainda vale (o campo mudou depois de ela
  // vencer), as seguintes não. Campo nunca alterado ⇒ null ⇒ não limita, que é
  // a mesma leniência do campo de data vazio logo abaixo.
  const raw =
    bound.kind === "field_changed"
      ? facts.changedAt?.get(bound.field) // v1.1: mesma correção da âncora.
      : recordRawValue(bound.field, facts.record, facts.available);
  const s = typeof raw === "string" ? raw.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
