// Versão: 1.0 | Data: 15/07/2026
// Widget Calculadora: helpers das variáveis de campos e da expressão
// compartilhada. As variáveis (CalculatorVariable) são fórmulas agregadas
// computadas no servidor; a expressão digitada é avaliada 100% no cliente
// (tokenizeFormulaText + evaluateFormula) contra os valores das variáveis —
// por isso os refs são `var:<id>` (estáveis a renomear). A expressão corrente
// é compartilhada entre usuários via dashboard_table_cells (row __calc__),
// mesmo mecanismo dos filtros rápidos (__qf__). Puro (sem IO).
import type { OperandRef } from "@/lib/records/date-operands";
import type { CalculatorVariable } from "./types";

// Chaves da expressão compartilhada em dashboard_table_cells.
export const CALC_ROW_KEY = "__calc__";
export const CALC_COL_KEY = "expr";

/** Ref usada nos tokens da expressão para a variável de id dado. */
export const calcVarRef = (id: string) => `var:${id}`;

/** Catálogo de operandos da expressão: uma entrada [Nome] por variável. */
export function calculatorCatalog(
  vars: CalculatorVariable[] | undefined
): OperandRef[] {
  return (vars ?? [])
    .filter((v) => v.name.trim())
    .map((v) => ({ ref: calcVarRef(v.id), label: v.name.trim() }));
}

const randSuffix = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Id estável de uma nova variável da calculadora. */
export function newVarId(): string {
  return `cv_${randSuffix()}`;
}

/** Id de um novo conector (DashboardSettings.connectors). */
export function newConnectorId(): string {
  return `cn_${randSuffix()}`;
}
