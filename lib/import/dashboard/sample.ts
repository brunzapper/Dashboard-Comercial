// Versão: 1.0 | Data: 22/07/2026
// Seleção PURA da amostra de registros do prompt de import (modo IA): ~20
// linhas com COBERTURA GARANTIDA — toda coluna com dado no banco deve aparecer
// preenchida em pelo menos uma linha da amostra (decisão do produto: as
// primeiras N linhas podem ter colunas 100% vazias, o que faria a IA ignorar a
// coluna). Estratégia gulosa: enquanto houver colunas descobertas, escolhe a
// linha que cobre MAIS colunas descobertas (desempate: mais campos
// preenchidos no total); assentos restantes vão para as linhas mais populadas.
// Colunas que permanecerem descobertas saem em `uncoveredRefs` — o chamador
// busca 1 registro por coluna no banco (query complementar) e roda a seleção
// de novo sobre a união. Sem I/O: testável com linhas sintéticas (npx tsx).

export interface SampleRecordLike {
  id: string;
  custom_fields?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export const SAMPLE_TARGET = 20;

/** Valor cru de um ref ('stage', 'value', 'custom:<key>') numa linha. */
export function sampleRefValue(row: SampleRecordLike, ref: string): unknown {
  if (ref.startsWith("custom:")) {
    return row.custom_fields?.[ref.slice("custom:".length)] ?? null;
  }
  return row[ref] ?? null;
}

/** Preenchido = não nulo, não string vazia, não array vazio. */
export function isSampleValueFilled(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function filledRefs(row: SampleRecordLike, refs: string[]): Set<string> {
  const out = new Set<string>();
  for (const ref of refs) {
    if (isSampleValueFilled(sampleRefValue(row, ref))) out.add(ref);
  }
  return out;
}

export interface CoverageSample<T extends SampleRecordLike> {
  rows: T[];
  // Colunas sem NENHUMA linha preenchida dentro de `rows` (candidatas à busca
  // complementar no banco; após a 2ª passada, colunas realmente sem dado).
  uncoveredRefs: string[];
}

/**
 * Seleciona até `target` linhas de `rows` cobrindo o máximo de `refs`.
 * Determinística: preserva a ordem de entrada nos desempates (passe as linhas
 * já ordenadas por recência).
 */
export function selectCoverageSample<T extends SampleRecordLike>(
  rows: T[],
  refs: string[],
  target = SAMPLE_TARGET
): CoverageSample<T> {
  const unique = new Map<string, T>();
  for (const r of rows) if (!unique.has(r.id)) unique.set(r.id, r);
  const pool = [...unique.values()];
  const filledByRow = new Map<string, Set<string>>(
    pool.map((r) => [r.id, filledRefs(r, refs)])
  );

  const selected: T[] = [];
  const covered = new Set<string>();
  const pickedIds = new Set<string>();

  // Fase 1 — cobertura gulosa: enquanto houver coluna descoberta E assento.
  while (selected.length < target) {
    let best: T | null = null;
    let bestGain = 0;
    let bestFill = -1;
    for (const r of pool) {
      if (pickedIds.has(r.id)) continue;
      const filled = filledByRow.get(r.id)!;
      let gain = 0;
      for (const ref of filled) if (!covered.has(ref)) gain += 1;
      if (gain > bestGain || (gain === bestGain && gain > 0 && filled.size > bestFill)) {
        best = r;
        bestGain = gain;
        bestFill = filled.size;
      }
    }
    if (!best || bestGain === 0) break; // nada mais a cobrir
    selected.push(best);
    pickedIds.add(best.id);
    for (const ref of filledByRow.get(best.id)!) covered.add(ref);
  }

  // Fase 2 — preencher os assentos restantes com as linhas mais populadas
  // (desempate pela ordem de entrada = mais recentes primeiro).
  if (selected.length < target) {
    const rest = pool
      .filter((r) => !pickedIds.has(r.id))
      .map((r, i) => ({ r, fill: filledByRow.get(r.id)!.size, i }))
      .sort((a, b) => b.fill - a.fill || a.i - b.i);
    for (const { r } of rest) {
      if (selected.length >= target) break;
      selected.push(r);
      pickedIds.add(r.id);
      for (const ref of filledByRow.get(r.id)!) covered.add(ref);
    }
  }

  return {
    rows: selected,
    uncoveredRefs: refs.filter((ref) => !covered.has(ref)),
  };
}
