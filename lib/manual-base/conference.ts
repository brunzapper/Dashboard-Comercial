// Versão: 1.0 | Data: 18/09/2026
// v1.0 (18/09/2026): a CONFERÊNCIA dos níveis (0143).
//
// Para que serve: níveis não somam entre si, então nada obriga a repartição a
// fechar com o total. No exemplo que motivou a feature o cruzamento Canal ×
// Responsável soma 500 de 1000 — porque quem lançou só preencheu parte dele.
// O engine NÃO inventa o resto (rateio inventado é pior que dizer "não sei"),
// então o gráfico mostra 500 e ninguém descobre por quê. Esta é a tela que
// conta: o total de cada nível, lado a lado, e o que falta.
//
// Mora em `lib/` e não em `components/` porque a prévia do assistente também vai
// querer mostrar isso.
//
// A REGRA que não pode ser quebrada: a aritmética de janela sai de `spread.ts`
// (`sumManualEntries` → `manualValueForWindow`). Reimplementá-la aqui faria a
// conferência discordar do gráfico no primeiro lançamento `intersecao` — que é
// justamente o modo que repete o valor em cada bucket tocado.
//
// Módulo PURO.

import {
  entryLevel,
  familyLabelOfKey,
  manualLevelKey,
  type ManualFamily,
} from "./families";
import { manualLevels } from "./levels";
import { sumManualEntries, type ManualWindow } from "./spread";
import type { ManualBaseData, ManualEntry } from "./types";

export interface ManualLevelTotal {
  /** As famílias do nível, em ordem determinística. `[]` é o total. */
  level: string[];
  /** Rótulo legível ("Total", "Canal", "Canal × Vendedor"). */
  label: string;
  total: number;
  /** Quantos lançamentos compõem este nível na janela. */
  count: number;
  /**
   * `total − referência`, ou null quando não há referência com que comparar.
   * NEGATIVO significa que a repartição não fecha: falta lançar.
   */
  delta: number | null;
}

export interface ManualConference {
  levels: ManualLevelTotal[];
  /** O nível de REFERÊNCIA (o mais grosso presente) e o total dele. */
  referenceTotal: number | null;
  /**
   * No nível ∅ convivem lançamentos COM responsável/operação e lançamentos SEM?
   *
   * Isto é uma armadilha PRÉ-EXISTENTE (vale na 0142 também) que vai reaparecer
   * com cara de bug novo: "total 1000" sem responsável mais "Paulo 200" com
   * responsável estão os DOIS no nível ∅ e portanto SOMAM — dá 1200. Para uma
   * ser subdivisão da outra, é preciso declarar a família.
   */
  mixedAttributionAtRoot: boolean;
}

/** Rótulo de um nível. `[]` é o total do dado. */
export function manualLevelLabel(
  level: readonly string[],
  families: readonly ManualFamily[]
): string {
  if (level.length === 0) return "Total";
  return level.map((k) => familyLabelOfKey(k, families)).join(" × ");
}

/**
 * A conferência de UM dado numa janela.
 *
 * A REFERÊNCIA é o nível mais grosso presente — o ∅ quando o total foi lançado
 * à mão, senão a família de menos eixos. É a MESMA preferência de
 * `resolveManualLevel`, de propósito: a conferência tem de comparar com o
 * número que o card sem dimensão realmente mostra.
 */
export function manualConference(
  base: ManualBaseData,
  o: { seriesId: string; window: ManualWindow }
): ManualConference {
  const entries = base.entries.filter((e) => e.series_id === o.seriesId);
  const levels = manualLevels(entries); // já vem ordenado por (tamanho, chave)
  const totalOf = (level: readonly string[]): { total: number; count: number } => {
    const key = manualLevelKey(level);
    const rows = entries.filter(
      (e) => manualLevelKey(entryLevel(e.coords)) === key
    );
    // A janela é aplicada pelo MESMO somador do engine — nunca uma conta local.
    const inWindow = rows.filter(
      (e) => sumManualEntries([e], o.window) !== 0
    ).length;
    return { total: sumManualEntries(rows, o.window), count: inWindow };
  };

  const computed = levels.map((level) => ({ level, ...totalOf(level) }));
  const reference = computed[0] ?? null;
  const referenceTotal = reference ? reference.total : null;

  const rootKey = manualLevelKey([]);
  const rootRows = entries.filter(
    (e) => manualLevelKey(entryLevel(e.coords)) === rootKey
  );
  const attributed = rootRows.some(
    (e) => e.responsible_id != null || e.operation_id != null
  );
  const unattributed = rootRows.some(
    (e) => e.responsible_id == null && e.operation_id == null
  );

  return {
    levels: computed.map((c, i) => ({
      level: c.level,
      label: manualLevelLabel(c.level, base.families),
      total: c.total,
      count: c.count,
      // O próprio nível de referência não se compara consigo mesmo.
      delta: i === 0 || referenceTotal == null ? null : c.total - referenceTotal,
    })),
    referenceTotal,
    mixedAttributionAtRoot: attributed && unattributed,
  };
}

/** Os lançamentos de um nível — para a grade destacar o que compõe cada um. */
export function entriesOfLevel(
  entries: readonly ManualEntry[],
  level: readonly string[]
): ManualEntry[] {
  const key = manualLevelKey(level);
  return entries.filter((e) => manualLevelKey(entryLevel(e.coords)) === key);
}
