// Versão: 1.0 | Data: 07/08/2026
// Dimensão CONDICIONAL (Dimension.caseFormula): helpers PUROS compartilhados
// pelo engine, pelo bucket-merge, pela UI do builder e pelo validador de
// import. A expressão (SE/E/OU do avaliador único de lib/records/formulas)
// reclassifica o VALOR da dimensão em rótulos — 100% engine, RPCs intocados:
//   - refs SÓ do próprio campo ⇒ MECANISMO SIMPLES: o RPC agrupa pelo valor
//     cru como hoje e o mergeRowsByBucket funde valor→rótulo (fold);
//   - refs de MAIS campos (E/OU entre campos) ⇒ MECANISMO ROBUSTO: o engine
//     expande as refs em dims EXTRAS na chamada do RPC e contrai as linhas
//     client-side de volta à contagem de dims da config (lib/widgets/
//     engine.ts), avaliando a expressão por tupla.
// SE sem "senão" ⇒ valor cru preservado (o grupo mantém o rótulo original).
// Coerção do cru (texto do RPC): número quando parseável — assim
// Se([X] >= 10; …) funciona sobre "12" (espelho da semântica *_num).
import {
  evaluateFormula,
  formulaRefs,
  type Formula,
} from "@/lib/records/formulas";
import type { Dimension } from "./types";

/** Refs distintas da expressão (ordem de aparição). */
export function caseFormulaRefs(d: Dimension): string[] {
  if (!d.caseFormula || (d.caseFormula.tokens?.length ?? 0) === 0) return [];
  return [...new Set(formulaRefs(d.caseFormula))];
}

/**
 * A expressão está ATIVA nesta dim? (mutuamente exclusiva com transform/
 * dateAgg — com eles presentes a expressão é inerte, nunca meio-aplicada.)
 */
export function caseDimActive(d: Dimension): boolean {
  return (
    (d.caseFormula?.tokens?.length ?? 0) > 0 &&
    (!d.transform || d.transform === "none") &&
    !d.dateAgg
  );
}

/** Mecanismo SIMPLES: expressão ativa referenciando SÓ o próprio campo. */
export function dimNeedsCaseFold(d: Dimension): boolean {
  if (!caseDimActive(d)) return false;
  const refs = caseFormulaRefs(d);
  return refs.length > 0 && refs.every((r) => r === d.field);
}

/** Refs ALÉM do próprio campo (⇒ mecanismo robusto de expansão). */
export function caseDimExtraRefs(d: Dimension): string[] {
  if (!caseDimActive(d)) return [];
  return caseFormulaRefs(d).filter((r) => r !== d.field);
}

export function dimNeedsCaseExpand(d: Dimension): boolean {
  return caseDimExtraRefs(d).length > 0;
}

/** Coerção do valor cru do RPC p/ o contexto da fórmula. */
export function coerceCaseRaw(raw: unknown): unknown {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
}

/**
 * Rótulo da dimensão para um conjunto ref→valor CRU: avalia a expressão com
 * os valores coercidos; resultado null (SE sem "senão", ref ausente,
 * aritmética nula) PRESERVA o valor cru do campo da dim; booleano segue a
 * convenção do avaliador ("VERDADEIRO"/"FALSO"); demais viram string.
 */
export function caseDimValue(
  formula: Formula,
  dim: Dimension,
  rawByRef: Record<string, unknown>
): unknown {
  const ctx: Record<string, unknown> = {};
  for (const [ref, raw] of Object.entries(rawByRef)) {
    ctx[ref] = coerceCaseRaw(raw);
  }
  const res = evaluateFormula(formula, ctx);
  if (res == null) return rawByRef[dim.field] ?? null;
  if (typeof res === "boolean") return res ? "VERDADEIRO" : "FALSO";
  return String(res);
}

/**
 * Plano do MECANISMO ROBUSTO (expressão multi-campo) de uma rodada: cada dim
 * expandida vira N dims CRUAS no payload dos RPCs (o próprio campo + as refs
 * extras, sem transform) e a contração de volta às dims da config acontece
 * client-side (contractCaseRows, lib/widgets/bucket-merge.ts). null = nenhuma
 * dim precisa de expansão (payload segue o caminho atual, byte-idêntico).
 */
export interface CaseExpansion {
  /** Payload de dims p/ TODOS os RPCs da rodada (principal/aux/pernas). */
  rpcDims: Dimension[];
  /** Por dim de config: posições (0-based) das colunas dela no payload. */
  colsOfDim: number[][];
  /** Refs na MESMA ordem das colunas (null = dim sem expansão). */
  refsOfDim: (string[] | null)[];
}

export function planCaseExpansion(
  dims: Dimension[],
  rpcDimOf: (d: Dimension) => Dimension
): CaseExpansion | null {
  if (!dims.some(dimNeedsCaseExpand)) return null;
  const rpcDims: Dimension[] = [];
  const colsOfDim: number[][] = [];
  const refsOfDim: (string[] | null)[] = [];
  for (const d of dims) {
    if (dimNeedsCaseExpand(d)) {
      const refs = [d.field, ...caseDimExtraRefs(d)];
      const cols: number[] = [];
      for (const ref of refs) {
        cols.push(rpcDims.length);
        rpcDims.push({ field: ref });
      }
      colsOfDim.push(cols);
      refsOfDim.push(refs);
    } else {
      colsOfDim.push([rpcDims.length]);
      refsOfDim.push(null);
      rpcDims.push(rpcDimOf(d));
    }
  }
  return { rpcDims, colsOfDim, refsOfDim };
}
