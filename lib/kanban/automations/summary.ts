// Versão: 1.0 | Data: 08/09/2026
// Resumo de UMA LINHA de uma regra de automação, em português — para listar
// regras fora do editor delas (o Workflow mostra todas as da organização).
//
// PURO e client-safe de propósito: a lista é um componente client, e os
// rótulos de operador/ação já existem no editor. Este módulo não valida nada e
// não decide nada — só descreve. A régua continua sendo `parseAutomationRule`
// (fail-closed) e `decideActions`.
import type { AutomationCondition, AutomationRule } from "./types";

const NUM_OP: Record<string, string> = {
  gte: "pelo menos",
  lte: "no máximo",
  eq: "exatamente",
};

function conditionText(c: AutomationCondition): string {
  if (c.kind === "field") {
    const value = Array.isArray(c.filter.value)
      ? c.filter.value.join(", ")
      : (c.filter.value ?? "");
    return `${c.filter.field} ${c.filter.op} ${value}`.trim();
  }
  if (c.kind === "related_count") {
    return `${NUM_OP[c.op] ?? c.op} ${c.value} conectado(s) em ${c.source}`;
  }
  if (c.kind === "tasks") {
    const what = c.metric === "open" ? "tarefa(s) aberta(s)" : "tarefa(s) atrasada(s)";
    return `${NUM_OP[c.op] ?? c.op} ${c.value} ${what}`;
  }
  // time
  const basis =
    c.basis.type === "field_changed"
      ? `${c.basis.field} sem alteração`
      : c.basis.type === "created"
        ? "criado"
        : "parado na coluna";
  const dir = c.op === "gte" ? "há mais de" : "há menos de";
  return `${basis} ${dir} ${c.days} dia(s)`;
}

/** "Se <condições> então <ação>" — o suficiente para reconhecer a regra. */
export function automationSummary(rule: AutomationRule): string {
  const when = rule.conditions.map(conditionText).join(" e ");
  const then =
    rule.action.type === "move_to_column"
      ? `mover para "${rule.action.targetKey}"`
      : `definir ${rule.action.field} = "${rule.action.value}"`;
  return `Se ${when}, ${then}.`;
}

/** Rótulo curto da ação — para agrupar/filtrar sem ler a frase inteira. */
export function automationActionLabel(rule: AutomationRule): string {
  return rule.action.type === "move_to_column"
    ? "Mover de coluna"
    : "Definir campo";
}
