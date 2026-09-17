// Versão: 1.0 | Data: 17/09/2026
// A grade da Base manual em forma de DADO — módulo PURO, sem React.
//
// A tela que o usuário descreveu é uma tabela: uma linha por período ×
// atribuição, uma coluna por dado. Os lançamentos no banco são a forma longa
// disso (um por célula preenchida), e esta é a tradução entre as duas.
//
// A identidade de uma LINHA é a mesma chave natural do índice único da 0142
// (período + responsável + operação). Não é coincidência: é o que faz editar
// uma célula virar um upsert previsível, e o que faz a IA relançar a tabela do
// mês sem duplicar nada.
import {
  DEFAULT_MANUAL_SPREAD,
  type ManualEntry,
  type ManualSeries,
  type ManualSpread,
} from "@/lib/manual-base/types";

export interface ManualGridRow {
  /** Chave natural, estável entre renders (e igual à do banco). */
  key: string;
  periodStart: string;
  periodEnd: string;
  responsibleId: string | null;
  operationId: string | null;
  /** O modo da LINHA. Os lançamentos dela compartilham — é como as pessoas
   *  pensam ("os números de agosto contam assim"), e evita uma coluna de
   *  configuração por célula. */
  spread: ManualSpread;
  /** seriesId → lançamento. Célula vazia = dado sem lançamento nessa linha. */
  bySeries: Map<string, ManualEntry>;
}

export function manualRowKey(
  periodStart: string,
  periodEnd: string,
  responsibleId: string | null,
  operationId: string | null
): string {
  return JSON.stringify([periodStart, periodEnd, responsibleId ?? "", operationId ?? ""]);
}

/** Lançamentos → linhas da grade, em ordem cronológica DECRESCENTE (o mês
 *  corrente, que é o que se está preenchendo, fica no topo). */
export function buildManualGrid(entries: readonly ManualEntry[]): ManualGridRow[] {
  const byKey = new Map<string, ManualGridRow>();
  for (const e of entries) {
    const key = manualRowKey(
      e.period_start,
      e.period_end,
      e.responsible_id,
      e.operation_id
    );
    let row = byKey.get(key);
    if (!row) {
      row = {
        key,
        periodStart: e.period_start,
        periodEnd: e.period_end,
        responsibleId: e.responsible_id,
        operationId: e.operation_id,
        spread: e.spread ?? DEFAULT_MANUAL_SPREAD,
        bySeries: new Map(),
      };
      byKey.set(key, row);
    }
    row.bySeries.set(e.series_id, e);
  }
  return [...byKey.values()].sort(
    (a, b) =>
      b.periodStart.localeCompare(a.periodStart) ||
      a.periodEnd.localeCompare(b.periodEnd) ||
      (a.operationId ?? "").localeCompare(b.operationId ?? "")
  );
}

/** As colunas da grade: os dados escolhidos, na ordem do catálogo. `only`
 *  vazio = todos (o widget pode recortar). */
export function manualColumns(
  series: readonly ManualSeries[],
  only?: readonly string[] | null
): ManualSeries[] {
  if (!only || only.length === 0) return [...series];
  const wanted = new Set(only);
  return series.filter((s) => wanted.has(s.key));
}

// O RÓTULO do período vive em lib/manual-base/label.ts, não aqui: o core do
// assistente (server-only) monta a prévia com a MESMA frase, e duas cópias
// fariam a prévia dizer "01/08/2026 – 31/08/2026" onde a grade diz
// "Agosto/2026" — para a mesma linha.
export {
  manualPeriodLabelOf as manualPeriodLabel,
  monthEndOf as monthEnd,
} from "@/lib/manual-base/label";
