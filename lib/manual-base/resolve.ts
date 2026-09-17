// Versão: 1.0 | Data: 17/09/2026
// A costura entre a Base manual e as linhas de um widget. Módulo PURO: recebe
// as linhas já computadas (e já fundidas por bucket) e devolve as linhas com
// os números digitados somados.
//
// Onde isto roda: no FIM de computeRows (lib/widgets/engine.ts), DEPOIS de
// contractCaseRows e mergeRowsByBucket. A ordem não é detalhe — é correção.
// Uma dimensão `custom:` com transform chega do RPC agrupada pelo valor CRU e
// só vira bucket no merge client-side; aplicar a Base manual antes faria duas
// linhas do mesmo mês receberem o mesmo valor manual, e o merge somaria as
// duas. Depois do merge existe uma linha por bucket, e uma só.
//
// Duas coisas acontecem aqui:
//
//  1. INJEÇÃO. Métrica manual recebe o valor do bucket; métrica CALCULADA
//     recebe o valor na basis (chave = o próprio ref) e é reavaliada. É a
//     basis, e não um const abaixado, que faz o subtotal e o Total geral
//     somarem certo — foldBasis é aditivo, que é o que uma quantidade quer.
//
//  2. LINHAS SINTÉTICAS. Um widget de mensageria tem métricas que são TODAS
//     manuais: o RPC não devolve linha nenhuma e não haveria barra para
//     desenhar. As tuplas que só existem na Base manual viram linhas, com as
//     métricas de registro em 0 (contagem) ou null (as demais) — a mesma
//     convenção de "grupo ausente na perna" que as pernas por fonte já usam.
//     É um desvio consciente da regra do Metric.sources, e só liga quando há
//     ref manual: widget existente fica byte-idêntico.
//
// Rotulagem de FK e ordenação acontecem DEPOIS, em runWidget — por isso a
// linha sintética carrega o id cru na dimensão e sai rotulada de graça.
import type { BasisValues } from "@/lib/widgets/calc-metrics";
import type { WidgetRow } from "@/lib/widgets/types";

import {
  manualRowTuple,
  manualTupleKey,
  projectManualEntries,
  type ManualDimPlan,
  type ManualDimValue,
} from "./buckets";
import type { ManualWindow } from "./spread";
import { manualRef, type ManualBaseData } from "./types";

export interface ManualApplyInput {
  rows: WidgetRow[];
  /** Plano de projeção das dimensões; `null` = alguma dim não é projetável e
   *  TODA métrica manual degrada para "—". */
  plans: ManualDimPlan[] | null;
  base: ManualBaseData;
  period: ManualWindow;
  /** Agrupamento de responsáveis (0101) — apelido → principal. */
  canonicalById?: ReadonlyMap<string, string> | null;
  /** Métrica PLANA da Base manual: índice em config.metrics → chave do dado. */
  manualMetricKeys: Map<number, string>;
  /** Métrica CALCULADA que cita a Base manual: índice → chaves citadas. */
  calcManualKeys: Map<number, string[]>;
  /** Reavalia a métrica calculada `idx` sobre a basis já com os valores
   *  manuais injetados. O engine fecha sobre a fórmula e a meta de moeda. */
  evalCalc: (idx: number, basis: BasisValues) => number | null;
  /** Quantas métricas a config tem (para preencher as linhas sintéticas). */
  metricCount: number;
  /** Agregação de cada métrica, para decidir o valor de uma linha sintética:
   *  contagem sem registro é 0; soma/média/min/máx sem registro é "—". */
  metricIsCount: (idx: number) => boolean;
}

/** O widget referencia a Base manual de alguma forma? Gate barato: sem isto,
 *  nada abaixo roda e o caminho segue byte-idêntico ao anterior. */
export function hasManualRefs(input: {
  manualMetricKeys: Map<number, string>;
  calcManualKeys: Map<number, string[]>;
}): boolean {
  if (input.manualMetricKeys.size > 0) return true;
  for (const keys of input.calcManualKeys.values()) {
    if (keys.length > 0) return true;
  }
  return false;
}

export function applyManualBase(input: ManualApplyInput): WidgetRow[] {
  const {
    rows,
    plans,
    base,
    period,
    canonicalById,
    manualMetricKeys,
    calcManualKeys,
    evalCalc,
    metricCount,
    metricIsCount,
  } = input;

  if (!hasManualRefs(input)) return rows;

  // Dimensão não projetável: a métrica manual não tem como se repartir. Vale
  // "—" explícito, nunca um rateio inventado nem o total repetido em toda
  // linha (que leria como dado verdadeiro).
  if (!plans) {
    for (const row of rows) {
      for (const idx of manualMetricKeys.keys()) row[`metric_${idx + 1}`] = null;
      for (const idx of calcManualKeys.keys()) row[`metric_${idx + 1}`] = null;
    }
    return rows;
  }

  // Só os lançamentos dos dados realmente citados.
  const wanted = new Set<string>([
    ...manualMetricKeys.values(),
    ...[...calcManualKeys.values()].flat(),
  ]);
  const seriesById = new Map(base.series.map((s) => [s.id, s]));
  const idByKey = new Map(base.series.map((s) => [s.key, s.id]));
  const entries = base.entries.filter((e) => {
    const s = seriesById.get(e.series_id);
    return s != null && wanted.has(s.key);
  });

  const { byTuple } = projectManualEntries(entries, {
    plans,
    period,
    canonicalById,
  });

  // Valor de um dado numa tupla. Ausente = 0: um mês sem lançamento é zero
  // mensagem, não "não sei". (Dado inexistente também dá 0 — o ref só chega
  // aqui porque o catálogo o ofertou.)
  const valueOf = (
    slot: { bySeries: Map<string, number> } | undefined,
    key: string
  ): number => {
    const id = idByKey.get(key);
    if (!id || !slot) return 0;
    return slot.bySeries.get(id) ?? 0;
  };

  const injectInto = (basis: BasisValues | undefined, keys: string[], slot: {
    bySeries: Map<string, number>;
  } | undefined) => {
    if (!basis) return;
    for (const key of keys) basis[manualRef(key)] = valueOf(slot, key);
  };

  const seen = new Set<string>();
  for (const row of rows) {
    const tupleKey = manualTupleKey(manualRowTuple(row, plans));
    seen.add(tupleKey);
    const slot = byTuple.get(tupleKey);

    for (const [idx, key] of manualMetricKeys) {
      row[`metric_${idx + 1}`] = valueOf(slot, key);
    }
    for (const [idx, keys] of calcManualKeys) {
      if (keys.length === 0) continue;
      const own = row.__calcOpsBy?.[`metric_${idx + 1}`];
      injectInto(own, keys, slot);
      injectInto(row.__calcOps, keys, slot);
      const basis = own ?? row.__calcOps;
      if (basis) row[`metric_${idx + 1}`] = evalCalc(idx, basis);
    }
  }

  // Tuplas que só existem na Base manual.
  for (const [tupleKey, slot] of byTuple) {
    if (seen.has(tupleKey)) continue;
    const row = syntheticRow(slot.dims, {
      metricCount,
      metricIsCount,
      manualMetricKeys,
      calcManualKeys,
      valueOf: (key) => valueOf(slot, key),
      evalCalc,
    });
    rows.push(row);
  }

  return rows;
}

function syntheticRow(
  dims: ManualDimValue[],
  o: {
    metricCount: number;
    metricIsCount: (idx: number) => boolean;
    manualMetricKeys: Map<number, string>;
    calcManualKeys: Map<number, string[]>;
    valueOf: (key: string) => number;
    evalCalc: (idx: number, basis: BasisValues) => number | null;
  }
): WidgetRow {
  const row: WidgetRow = {};
  dims.forEach((v, i) => {
    row[`dim_${i + 1}`] = v;
  });
  for (let i = 0; i < o.metricCount; i++) {
    row[`metric_${i + 1}`] = o.metricIsCount(i) ? 0 : null;
  }
  for (const [idx, key] of o.manualMetricKeys) {
    row[`metric_${idx + 1}`] = o.valueOf(key);
  }
  if (o.calcManualKeys.size > 0) {
    // Sem registro no grupo: contagens valem 0 e as demais chaves ficam
    // AUSENTES da basis (null no ctx) — é a mesma convenção do "grupo ausente
    // na perna". Quem preenche as chaves de registro é o engine, no fechamento
    // de evalCalc; aqui entram só as manuais.
    const basis: BasisValues = {};
    for (const [idx, keys] of o.calcManualKeys) {
      for (const key of keys) basis[manualRef(key)] = o.valueOf(key);
      row[`metric_${idx + 1}`] = o.evalCalc(idx, basis);
    }
    row.__calcOps = basis;
  }
  return row;
}
