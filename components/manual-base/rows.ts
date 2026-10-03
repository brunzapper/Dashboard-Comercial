// Versão: 1.2 | Data: 03/10/2026
// v1.2 (03/10/2026): navegação por MÊS e colunas de atribuição sob demanda
//   (tela v2): `shiftMonth`, `rowTouchesMonth`, `rowsForMonth` e
//   `attributionColumns`. Puros, para a grade e os testes lerem a mesma regra.
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
  coordDeclares,
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

const YM_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** `YYYY-MM` válido? */
export function isYearMonth(ym: string | null | undefined): ym is string {
  return typeof ym === "string" && YM_RE.test(ym);
}

/** Desloca um `YYYY-MM` por `delta` meses (aritmética de calendário, sem fuso). */
export function shiftMonth(ym: string, delta: number): string {
  const m = ym.match(YM_RE);
  if (!m) return ym;
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  const y = Math.floor(idx / 12);
  const mo = idx - y * 12 + 1;
  return `${y}-${String(mo).padStart(2, "0")}`;
}

/** A linha ENCOSTA no mês? (intervalo do lançamento ∩ mês ≠ ∅.) Comparação
 *  de prefixo `YYYY-MM-DD` — o read side é prefix-based (invariante 11). */
export function rowTouchesMonth(
  row: Pick<ManualGridRow, "periodStart" | "periodEnd">,
  ym: string
): boolean {
  const from = `${ym}-01`;
  const to = monthEnd(ym);
  return row.periodStart <= to && row.periodEnd >= from;
}

/** As linhas exibidas para um mês; `null` = todos os meses. */
export function rowsForMonth<T extends Pick<ManualGridRow, "periodStart" | "periodEnd">>(
  rows: readonly T[],
  ym: string | null
): T[] {
  if (!ym) return [...rows];
  return rows.filter((r) => rowTouchesMonth(r, ym));
}

/**
 * Quais colunas SOLTAS de atribuição (Responsável/Operação) a grade precisa.
 * Quando a linha ENDEREÇA a divisão embutida, a atribuição já aparece como chip
 * da coluna "Recorte" — repetir em coluna própria era a duplicação que
 * confundia. A coluna solta só sobra para o caso legado: linha com a FK
 * preenchida sem endereçar a divisão (a atribuição da 0142, que não reparte
 * nada — e que por isso SOMA com as demais linhas do total).
 */
export function attributionColumns(
  rows: readonly Pick<ManualGridRow, "responsibleId" | "operationId" | "coords">[]
): { responsible: boolean; operation: boolean } {
  return {
    responsible: rows.some(
      (r) => r.responsibleId != null && !coordDeclares(r.coords, "responsavel")
    ),
    operation: rows.some(
      (r) => r.operationId != null && !coordDeclares(r.coords, "operacao")
    ),
  };
}

// O RÓTULO do período vive em lib/manual-base/label.ts, não aqui: o core do
// assistente (server-only) monta a prévia com a MESMA frase, e duas cópias
// fariam a prévia dizer "01/08/2026 – 31/08/2026" onde a grade diz
// "Agosto/2026" — para a mesma linha.
import { monthEndOf as monthEnd } from "@/lib/manual-base/label";
export { monthEnd };
export { manualPeriodLabelOf as manualPeriodLabel } from "@/lib/manual-base/label";
