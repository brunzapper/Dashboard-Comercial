// Versão: 1.0 | Data: 20/07/2026
// RECEITAS de fórmula — atalhos orientados a objetivo que geram uma Formula
// NORMAL (tokens comuns), aberta no FormulaEditor já preenchida e 100%
// editável. Nunca substituem o editor livre; só encurtam o caminho até os dois
// resultados mais pedidos e menos descobríveis:
//
// - Ciclo de vendas: dias entre uma data do registro e uma data do registro
//   CASADO de outra fonte ([data fim] − [match:<fonte>:<data início>], campo
//   'calculado' — data − data = dias).
// - Taxa de conversão: contagem de uma fonte ÷ contagem de outra
//   (agg:count:…@<fonte> ÷ agg:count:…@<fonte>, contexto agregado, formato %).
//
// As respostas do wizard são REFS escolhidas nos catálogos vivos (perRecord /
// buildAggOperandCatalog) — nada de lista paralela; a receita só monta tokens.
// Módulo puro (client+server).
import type { Formula } from "./formulas";

export type RecipeId = "sales_cycle" | "conversion_rate";

export interface RecipeResult {
  // Onde a fórmula vive: campo por-registro ou agregado (o host decide como
  // aplicar — tipo do FieldForm, métrica ad-hoc, fórmula do widget).
  target: "calculado" | "calculado_agg";
  formula: Formula;
  // Formato sugerido do resultado (o usuário pode trocar depois).
  format: "number" | "percent";
  suggestedLabel: string;
}

/** Ciclo de vendas: [data fim (do registro)] − [data início (do casado)].
 *  `endRef` = ref de data do próprio registro; `startMatchRef` = ref
 *  `match:<fonte>:<data>` escolhida no catálogo (já embute a fonte). */
export function buildSalesCycle(
  endRef: string,
  startMatchRef: string,
  labels: { end: string; start: string }
): RecipeResult {
  return {
    target: "calculado",
    formula: {
      tokens: [
        { kind: "field", ref: endRef },
        { kind: "op", op: "-" },
        { kind: "field", ref: startMatchRef },
      ],
    },
    format: "number",
    suggestedLabel: `Ciclo de vendas (dias) — ${labels.start} → ${labels.end}`,
  };
}

/** Taxa de conversão: contagem A ÷ contagem B (refs `agg:count:…@<fonte>` já
 *  escolhidas no catálogo — registros da fonte ou registros com um campo
 *  preenchido). Resultado sugerido em percentual (0,35 → 35%). */
export function buildConversionRate(
  numeratorRef: string,
  denominatorRef: string,
  labels: { numerator: string; denominator: string }
): RecipeResult {
  return {
    target: "calculado_agg",
    formula: {
      tokens: [
        { kind: "field", ref: numeratorRef },
        { kind: "op", op: "/" },
        { kind: "field", ref: denominatorRef },
      ],
    },
    format: "percent",
    suggestedLabel: `Taxa de conversão — ${labels.denominator} → ${labels.numerator}`,
  };
}
