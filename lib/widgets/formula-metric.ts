// Versão: 1.0 | Data: 10/07/2026
// Fase 3: métrica calculada no nível do DASHBOARD. O avaliador de fórmula
// (evaluateFormula) é agnóstico de contexto — aqui montamos um `ctx` ref→número
// resolvendo dois tipos novos de referência:
//   - table:<widgetId>:col:<colKey>:(sum|avg) | :row:<rowKey>:(sum|avg)
//     | :cell:<rowKey>:<colKey>   → valores de uma Tabela editável (matriz).
//   - agg:<sum|avg|count>:<field> → agregação dos registros via run_widget_query
//     (field pode ser 'value'|'mrr'|'custom:<k>'|'*'; '*' com count = contagem).
// Depois chamamos evaluateFormula(formula, ctx) sem tocar no avaliador.
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  evaluateFormula,
  formulaRefs,
  type Formula,
} from "@/lib/records/formulas";
import type { SourceKey } from "@/lib/sources";
import { aggregate, resolveFilters, sourceFilters } from "./engine";
import { cellKey } from "./matrix";
import { applyPeriodToFilters, type DashboardPeriod } from "./period";
import type { Aggregation, MatrixAxis, WidgetFilter } from "./types";

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Estrutura + valores de um widget de Tabela editável para resolver refs table:*. */
export interface MatrixWidgetInfo {
  rows: MatrixAxis[];
  cols: MatrixAxis[];
  cells: Record<string, unknown>; // 'rowKey:colKey' → value
}

function sum(vals: number[]): number | null {
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}
function avg(vals: number[]): number | null {
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// table:<wid>:col:<colKey>:<agg> | :row:<rowKey>:<agg> | :cell:<rowKey>:<colKey>
function resolveTableRef(
  ref: string,
  matrices: Record<string, MatrixWidgetInfo>
): number | null {
  const p = ref.split(":");
  const wid = p[1];
  const kind = p[2];
  const m = matrices[wid];
  if (!m) return null;
  if (kind === "cell") {
    return toNum(m.cells[cellKey(p[3], p[4])]);
  }
  if (kind === "col") {
    const colKey = p[3];
    const agg = p[4];
    const vals = m.rows
      .map((r) => toNum(m.cells[cellKey(r.key, colKey)]))
      .filter((n): n is number => n != null);
    return agg === "avg" ? avg(vals) : sum(vals);
  }
  if (kind === "row") {
    const rowKey = p[3];
    const agg = p[4];
    const vals = m.cols
      .map((c) => toNum(m.cells[cellKey(rowKey, c.key)]))
      .filter((n): n is number => n != null);
    return agg === "avg" ? avg(vals) : sum(vals);
  }
  return null;
}

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
  matrices: Record<string, MatrixWidgetInfo>;
}

/**
 * Avalia a fórmula de uma métrica calculada com o contexto do dashboard.
 * Retorna número | null (null se algum operando faltar / divisão por zero).
 */
export async function runCalculatedWidget(
  supabase: SupabaseClient,
  input: CalcInput
): Promise<number | null> {
  const { formula, matrices } = input;
  if (!formula || formula.tokens.length === 0) return null;

  const refs = new Set(formulaRefs(formula));
  const ctx: Record<string, number | null> = {};

  // Refs de tabela (síncrono, em memória).
  for (const ref of refs) {
    if (ref.startsWith("table:")) ctx[ref] = resolveTableRef(ref, matrices);
  }

  // Refs de agregação de registros (via RPC).
  const aggRefs = [...refs].filter((r) => r.startsWith("agg:"));
  if (aggRefs.length > 0) {
    let filters = resolveFilters(input.filters ?? []);
    if (input.period) filters = applyPeriodToFilters(filters, input.period);
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

  return evaluateFormula(formula, ctx);
}
