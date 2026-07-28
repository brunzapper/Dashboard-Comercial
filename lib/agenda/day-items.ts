// Versão: 1.0 | Data: 28/07/2026
// Helpers PUROS de ordenação/merge dos itens da agenda (sem I/O — testáveis e
// compartilhados entre server (runAgenda/fetchWorkspaceAgenda) e client
// (AgendaView)). Regras:
//  * extractTimeHHMM: prefixo NAIVE do valor bruto (invariante 11 — datas são
//    strings no relógio de Brasília; NUNCA converter fuso aqui). Meia-noite
//    ("00:00") conta como "só data" — timestamptz zerado quase sempre significa
//    ausência de hora.
//  * sortDayItems: com hora primeiro (HH:MM asc), depois sem hora; desempate
//    nota → tarefa → registro (anotação lê como contexto do dia, tarefa é
//    acionável, registro é informacional), título pt-BR e id (estável entre
//    renders/superfícies).
//  * mergeAgendaItems (Workspace): o mesmo registro pode chegar por dois
//    widgets de agenda com o mesmo campo de data — dedupe por `${id}|${date}`.
import type { AgendaItem } from "./types";

const TIME_PREFIX_RE = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/;

/**
 * "HH:MM" de um valor bruto de data/hora; null para só-data, meia-noite ou
 * valor inválido. Prefix-based, sem conversão de fuso.
 */
export function extractTimeHHMM(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = TIME_PREFIX_RE.exec(raw);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  const time = `${m[1]}:${m[2]}`;
  return time === "00:00" ? null : time;
}

const KIND_RANK: Record<AgendaItem["kind"], number> = {
  note: 0,
  task: 1,
  record: 2,
};

/** Ordena os itens de UM dia (ver regra no topo). Não muta a entrada. */
export function sortDayItems(items: AgendaItem[]): AgendaItem[] {
  return [...items].sort((a, b) => {
    const ta = a.time ?? null;
    const tb = b.time ?? null;
    if (ta !== tb) {
      if (ta === null) return 1; // sem hora depois
      if (tb === null) return -1;
      if (ta !== tb) return ta < tb ? -1 : 1;
    }
    const ka = KIND_RANK[a.kind];
    const kb = KIND_RANK[b.kind];
    if (ka !== kb) return ka - kb;
    const tt = a.title.localeCompare(b.title, "pt-BR");
    if (tt !== 0) return tt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Agrupa por dia, cada dia já ordenado por sortDayItems. */
export function groupItemsByDay(items: AgendaItem[]): Map<string, AgendaItem[]> {
  const byDay = new Map<string, AgendaItem[]>();
  for (const item of items) {
    const list = byDay.get(item.date);
    if (list) list.push(item);
    else byDay.set(item.date, [item]);
  }
  for (const [day, list] of byDay) byDay.set(day, sortDayItems(list));
  return byDay;
}

/**
 * Funde as pernas do Workspace num só array: registros deduplicados por
 * `${id}|${date}` (primeira ocorrência vence); tarefas/anotações passam
 * intactas (cada perna as consulta no máximo uma vez).
 */
export function mergeAgendaItems(legs: AgendaItem[][]): AgendaItem[] {
  const out: AgendaItem[] = [];
  const seenRecords = new Set<string>();
  for (const leg of legs) {
    for (const item of leg) {
      if (item.kind === "record") {
        const key = `${item.id}|${item.date}`;
        if (seenRecords.has(key)) continue;
        seenRecords.add(key);
      }
      out.push(item);
    }
  }
  return out;
}
