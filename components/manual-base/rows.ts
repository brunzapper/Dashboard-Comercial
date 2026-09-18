// Versão: 1.1 | Data: 18/09/2026
// v1.1 (18/09/2026): a COORDENADA (0143) entra na identidade da linha. Tinha de
//   entrar: o índice único do banco passou a incluir `coords`, e esta chave é a
//   MESMA dele de propósito — sem isso, o total de agosto e a fatia "ligação" de
//   agosto colapsariam na mesma linha da grade e uma sobrescreveria a outra no
//   upsert.
// A grade da Base manual em forma de DADO — módulo PURO, sem React.
//
// A tela que o usuário descreveu é uma tabela: uma linha por período ×
// atribuição, uma coluna por dado. Os lançamentos no banco são a forma longa
// disso (um por célula preenchida), e esta é a tradução entre as duas.
//
// A identidade de uma LINHA é a mesma chave natural do índice único do banco
// (período + responsável + operação + COORDENADA). Não é coincidência: é o que
// faz editar uma célula virar um upsert previsível, e o que faz a IA relançar a
// tabela do mês sem duplicar nada.
import {
  EMPTY_MANUAL_COORDS,
  manualCoordsKey,
  type ManualCoords,
} from "@/lib/manual-base/families";
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
  /** O que esta linha endereça (0143). `{}` é o nível ∅ — o total. */
  coords: ManualCoords;
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
  operationId: string | null,
  coords: ManualCoords = EMPTY_MANUAL_COORDS
): string {
  return JSON.stringify([
    periodStart,
    periodEnd,
    responsibleId ?? "",
    operationId ?? "",
    // Canônica: insensível à ordem de inserção das chaves, como o jsonb do
    // banco. Duas linhas com as mesmas coordenadas em ordem diferente TÊM de
    // dar a mesma chave, senão a grade duplica o que o banco unifica.
    manualCoordsKey(coords),
  ]);
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
      e.operation_id,
      e.coords
    );
    let row = byKey.get(key);
    if (!row) {
      row = {
        key,
        periodStart: e.period_start,
        periodEnd: e.period_end,
        responsibleId: e.responsible_id,
        operationId: e.operation_id,
        coords: e.coords,
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
      // Dentro de um período, o nível mais GROSSO primeiro (o total acima das
      // fatias): sem isso o total e as subdivisões se intercalam e a tela
      // sugere que somam.
      Object.keys(a.coords).length - Object.keys(b.coords).length ||
      manualCoordsKey(a.coords).localeCompare(manualCoordsKey(b.coords)) ||
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
