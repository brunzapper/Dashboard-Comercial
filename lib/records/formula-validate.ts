// Versão: 1.0 | Data: 20/07/2026
// Validação de fórmula POR CONTEXTO — fonte ÚNICA das regras e mensagens que
// antes viviam espalhadas entre campos/actions.ts (servidor) e os saves dos
// editores. Módulo puro (client+server): os editores rodam a MESMA validação
// ao vivo que o servidor roda no submit, com as MESMAS mensagens.
//
// Contextos:
// - "record"    → campo calculado POR-REGISTRO ('calculado'): refs do próprio
//   registro/casado; agregações (agg:*) e SOMASE/CONT.SE/MÉDIASE são rejeitadas
//   com mensagens dedicadas (a fórmula enxerga um registro só).
// - "aggregate" → fórmula sobre AGREGAÇÕES ('calculado_agg' e métricas de
//   widget): validateFormula (estrutura + refs do catálogo) e depois
//   validateCondAggRefs (colocação de SOMASE/…, mensagem dedicada do "today").
//
// `warnings` NÃO bloqueiam o save: apontam operandos que degradariam para "—"
// em runtime (escopo @fonte não abaixável — sub-fonte com filtro inexpressável
// ou agregação sem forma condicional). Hoje o catálogo só oferece variantes
// abaixáveis (fontes raiz + sum/avg/count), então eles cobrem fórmulas
// antigas/futuras — nunca esconda a fórmula por causa de um warning.
import type { SourceDef } from "@/lib/sources";
import {
  parseAggRef,
  sourceScopeConds,
  validateCondAggRefs,
} from "@/lib/widgets/calc-metrics";
import type { OperandRef } from "./date-operands";
import {
  formulaRefs,
  formulaUsesCondAgg,
  validateFormula,
  type Formula,
} from "./formulas";

// Mensagens dedicadas do contexto por-registro (antes inline no servidor —
// campos/actions.ts). Exportadas para quem precisar exibi-las fora do fluxo.
export const COND_AGG_IN_RECORD_MSG =
  'SOMASE/CONT.SE/MÉDIASE só funcionam em campos "Calculado (totais do recorte)" e métricas de widget — a fórmula por registro enxerga um registro só. Para condição por registro, use SE(...).';
export const AGG_IN_RECORD_MSG =
  'Operandos agregados (Σ, Média, Contagem) só funcionam em campos "Calculado (totais do recorte)" — o campo calculado por registro enxerga um registro só. Use os valores do próprio registro, ou crie um campo "Calculado (totais do recorte)".';

export interface FormulaContext {
  kind: "record" | "aggregate";
  // Catálogo COMPLETO do contexto, JÁ sem os operandos proibidos (ciclo) —
  // mesma origem dos editores: perRecordCalcOperands (record) ou
  // buildAggOperandCatalog (aggregate). validateFormula testa pertencimento.
  catalog: OperandRef[];
  // Catálogo de fontes vivo (loadSources/useSources) — habilita os warnings de
  // escopo @fonte. Ausente = sem warnings de escopo.
  sources?: SourceDef[];
}

export interface FormulaContextValidation {
  ok: boolean;
  error?: string;
  warnings: string[];
}

/** Validação completa de uma fórmula no seu contexto: mesmas regras e
 *  mensagens no editor (ao vivo) e no servidor (submit). */
export function validateFormulaForContext(
  formula: Formula,
  ctx: FormulaContext
): FormulaContextValidation {
  const refs = new Set(ctx.catalog.map((o) => o.ref));
  if (ctx.kind === "record") {
    if (formulaUsesCondAgg(formula)) {
      return { ok: false, error: COND_AGG_IN_RECORD_MSG, warnings: [] };
    }
    if (formulaRefs(formula).some((r) => r.startsWith("agg:"))) {
      return { ok: false, error: AGG_IN_RECORD_MSG, warnings: [] };
    }
    const v = validateFormula(formula, refs);
    return v.ok
      ? { ok: true, warnings: [] }
      : { ok: false, error: v.error ?? "Fórmula inválida.", warnings: [] };
  }
  const v = validateFormula(formula, refs);
  if (!v.ok) {
    return { ok: false, error: v.error ?? "Fórmula inválida.", warnings: [] };
  }
  const p = validateCondAggRefs(formula, ctx.catalog);
  if (!p.ok) {
    return { ok: false, error: p.error ?? "Fórmula inválida.", warnings: [] };
  }
  return { ok: true, warnings: scopeWarnings(formula, ctx) };
}

// Operandos `agg:…@<fonte>` que o lowering NÃO consegue abaixar viram operando
// AUSENTE em runtime ("—", nunca a basis sem escopo — lowerSourceScopedOperands
// /basisKeysFor). Desde 20/07/2026 o catálogo oferta também SUB-fontes e os
// predicados aceitam in/is_null/not_null/*_ci — só `ilike`/op desconhecido
// degradam; avisa em vez de calar.
function scopeWarnings(formula: Formula, ctx: FormulaContext): string[] {
  if (!ctx.sources) return [];
  const labelOf = (ref: string) =>
    ctx.catalog.find((o) => o.ref === ref)?.label ?? ref;
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const ref of formulaRefs(formula)) {
    if (!ref.startsWith("agg:") || seen.has(ref)) continue;
    seen.add(ref);
    const { agg, source } = parseAggRef(ref);
    if (!source) continue;
    if (agg !== "sum" && agg !== "count" && agg !== "avg") {
      warnings.push(
        `"${labelOf(ref)}": Mín/Máx não têm forma com escopo de base — o operando ficará ausente ("—"). Use Σ, Média ou Contagem, ou remova a base do operando.`
      );
      continue;
    }
    let conds: unknown;
    try {
      conds = sourceScopeConds(source, ctx.sources);
    } catch {
      conds = null;
    }
    if (conds === null) {
      warnings.push(
        `"${labelOf(ref)}": o filtro dessa sub-base não é expressável dentro da fórmula — o operando ficará ausente ("—"). Ajuste o filtro da sub-base (=, ≠, >, ≥, <, ≤, "está em", vazio/não vazio) ou use a base pai.`
      );
    }
  }
  return warnings;
}
