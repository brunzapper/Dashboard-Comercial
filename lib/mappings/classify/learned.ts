// Versão: 1.0 | Data: 07/08/2026
// Motor de classificação APRENDIDO (banco de palavras) — genérico para
// QUALQUER domínio de mapeamento (0117), sem classificador codificado: o
// índice nasce das PRÓPRIAS entradas do de-para (seed + manuais + IA) e se
// RETROALIMENTA a cada correção — a próxima aplicação já sugere com o que o
// admin/IA ensinou. Puro (sem I/O); o compositor de domains.ts usa este motor
// como fallback do classificador específico (V5) e como ÚNICO motor de
// domínios novos.
// Desenho: tokeniza o valor (lower/sem acento, split não-alfanumérico,
// stopwords pt/en mínimas, tokens ≥ 2 chars); por target, cada token vota na
// categoria com peso = PUREZA do token (fração das entradas daquele token que
// apontam à categoria). Sugere SÓ com confiança (thresholds abaixo) — melhor
// deixar pendente do que chutar; match EXATO por norm sempre vence.
import { UNCLASSIFIED } from "./shared";

/** Evidência mínima (nº de entradas votantes) para sugerir por tokens. */
export const MIN_EVIDENCE = 2;
/** Pureza efetiva mínima (votos da vencedora / votos totais do valor). */
export const MIN_PURITY = 0.65;
/** Token único só decide se for 100% puro e visto ao menos N vezes. */
export const MIN_SINGLE_TOKEN_COUNT = 3;

// Stopwords mínimas pt/en — conectivos que só geram ruído no voto.
const STOPWORDS = new Set([
  "a", "as", "o", "os", "e", "em", "de", "do", "da", "dos", "das", "para",
  "por", "com", "sem", "um", "uma", "no", "na", "nos", "nas", "ao", "aos",
  "of", "the", "and", "or", "in", "on", "at", "to", "for", "with", "by",
]);

export function tokenizeValue(raw: unknown): string[] {
  const norm = String(raw ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const tokens = norm.split(/[^a-z0-9]+/g).filter(
    (t) => t.length >= 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t)
  );
  return [...new Set(tokens)];
}

/** token → (categoria → contagem de entradas) — um índice por target. */
interface TargetBank {
  byToken: Map<string, Map<string, number>>;
  /** Total de entradas por token (denominador da pureza). */
  tokenTotals: Map<string, number>;
}

export interface WordBank {
  /** raw_norm → outputs — match exato vence sempre. */
  exact: Map<string, Record<string, string>>;
  targets: Map<string, TargetBank>;
}

export interface BankEntry {
  rawNorm: string;
  outputs: Record<string, unknown>;
}

/**
 * Constrói o banco de palavras do domínio a partir das entradas existentes.
 * Saídas "Não Classificado" não ensinam nada (não viram voto).
 */
export function buildWordBank(
  entries: Iterable<BankEntry>,
  targetFieldKeys: string[]
): WordBank {
  const bank: WordBank = { exact: new Map(), targets: new Map() };
  for (const key of targetFieldKeys) {
    bank.targets.set(key, { byToken: new Map(), tokenTotals: new Map() });
  }
  for (const entry of entries) {
    const outputs: Record<string, string> = {};
    for (const key of targetFieldKeys) {
      const v = entry.outputs?.[key];
      if (typeof v === "string" && v.trim() !== "") outputs[key] = v.trim();
    }
    if (Object.keys(outputs).length > 0) bank.exact.set(entry.rawNorm, outputs);
    const tokens = tokenizeValue(entry.rawNorm);
    if (tokens.length === 0) continue;
    for (const key of targetFieldKeys) {
      const category = outputs[key];
      if (!category || category === UNCLASSIFIED) continue;
      const target = bank.targets.get(key)!;
      for (const token of tokens) {
        const votes = target.byToken.get(token) ?? new Map<string, number>();
        votes.set(category, (votes.get(category) ?? 0) + 1);
        target.byToken.set(token, votes);
        target.tokenTotals.set(token, (target.tokenTotals.get(token) ?? 0) + 1);
      }
    }
  }
  return bank;
}

/**
 * Sugere as saídas de um valor inédito a partir do banco: por target, soma
 * os votos dos tokens ponderados pela PUREZA de cada token; a categoria
 * vencedora só sai com confiança (evidência + pureza efetiva). Devolve null
 * quando nenhum target atinge confiança.
 */
export function suggestFromBank(
  bank: WordBank,
  raw: unknown
): Record<string, string> | null {
  const norm = String(raw ?? "").trim().toLowerCase();
  if (!norm) return null;
  const exact = bank.exact.get(norm);
  if (exact) return { ...exact };

  const tokens = tokenizeValue(norm);
  if (tokens.length === 0) return null;
  const outputs: Record<string, string> = {};

  for (const [fieldKey, target] of bank.targets) {
    const scores = new Map<string, number>();
    const evidence = new Map<string, number>();
    let bestSingle: { category: string; count: number } | null = null;
    for (const token of tokens) {
      const votes = target.byToken.get(token);
      if (!votes) continue;
      const total = target.tokenTotals.get(token) ?? 0;
      if (total === 0) continue;
      for (const [category, count] of votes) {
        const purity = count / total;
        scores.set(category, (scores.get(category) ?? 0) + purity * count);
        evidence.set(category, (evidence.get(category) ?? 0) + count);
        // Token 100% puro e frequente pode decidir sozinho.
        if (purity === 1 && count >= MIN_SINGLE_TOKEN_COUNT) {
          if (!bestSingle || count > bestSingle.count) {
            bestSingle = { category, count };
          }
        }
      }
    }
    if (scores.size === 0) continue;
    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const [winner, winnerScore] = ranked[0];
    const totalScore = ranked.reduce((s, [, v]) => s + v, 0);
    const effectivePurity = totalScore > 0 ? winnerScore / totalScore : 0;
    const winnerEvidence = evidence.get(winner) ?? 0;
    const confident =
      (winnerEvidence >= MIN_EVIDENCE && effectivePurity >= MIN_PURITY) ||
      bestSingle?.category === winner;
    if (confident) outputs[fieldKey] = winner;
  }

  return Object.keys(outputs).length > 0 ? outputs : null;
}
