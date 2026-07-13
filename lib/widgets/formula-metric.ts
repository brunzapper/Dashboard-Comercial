// Versão: 2.0 | Data: 11/07/2026
// Fase 3: métrica calculada no nível do DASHBOARD. O avaliador de fórmula
// (evaluateFormula) é agnóstico de contexto — aqui montamos um `ctx` ref→número
// resolvendo referências de agregação de registros:
//   - agg:<sum|avg|count>:<field> → agregação dos registros via run_widget_query
//     (field pode ser 'value'|'mrr'|'custom:<k>'|'*'; '*' com count = contagem).
// Depois chamamos evaluateFormula(formula, ctx) sem tocar no avaliador.
// v2.0 (11/07/2026): removido o suporte a refs table:* (a "Tabela editável"/matriz
//   foi descontinuada). Refs table:* remanescentes de fórmulas antigas resolvem
//   para null (operando ausente → resultado null).
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  evaluateFormula,
  formulaRefs,
  type Formula,
} from "@/lib/records/formulas";
import type { SourceKey } from "@/lib/sources";
import { aggregate, resolveFilters, sourceFilters } from "./engine";
import { applyPeriodToFilters, type DashboardPeriod } from "./period";
import type { Aggregation, WidgetFilter } from "./types";

// agg:<sum|avg|count>:<field>. field pode conter ':' (ex.: custom:forecast); por
// isso o tipo de agregação vem PRIMEIRO e o field é o resto.
function parseAggRef(ref: string): { agg: Aggregation; field: string } {
  const rest = ref.slice("agg:".length);
  const idx = rest.indexOf(":");
  const agg = (idx === -1 ? rest : rest.slice(0, idx)) as Aggregation;
  const field = idx === -1 ? "*" : rest.slice(idx + 1);
  return { agg, field };
}

export interface CalcInput {
  formula?: Formula | null;
  sources?: SourceKey[];
  filters?: WidgetFilter[];
  period?: DashboardPeriod | null;
  correspondencesMap?: Record<string, string[]>;
}

/**
 * Avalia a fórmula de uma métrica calculada com o contexto do dashboard.
 * Retorna número | null (null se algum operando faltar / divisão por zero).
 */
export async function runCalculatedWidget(
  supabase: SupabaseClient,
  input: CalcInput
): Promise<number | null> {
  const { formula } = input;
  if (!formula || formula.tokens.length === 0) return null;

  const refs = new Set(formulaRefs(formula));
  const ctx: Record<string, number | null> = {};

  // Refs table:* são de tabelas editáveis descontinuadas → operando ausente.
  for (const ref of refs) {
    if (ref.startsWith("table:")) ctx[ref] = null;
  }

  // Refs de agregação de registros (via RPC).
  const aggRefs = [...refs].filter((r) => r.startsWith("agg:"));
  if (aggRefs.length > 0) {
    let filters = resolveFilters(input.filters ?? []);
    if (input.period)
      filters = applyPeriodToFilters(filters, input.period, input.sources);
    filters = [...sourceFilters(input.sources), ...filters];
    await Promise.all(
      aggRefs.map(async (ref) => {
        const { agg, field } = parseAggRef(ref);
        const [v] = await aggregate(
          supabase,
          [{ field, agg }],
          filters,
          input.correspondencesMap ?? {}
        );
        ctx[ref] = Number.isFinite(v) ? v : null;
      })
    );
  }

  // O KPI calculado é numérico: resultado de texto/booleano (ramo de SE) → null.
  const v = evaluateFormula(formula, ctx);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
