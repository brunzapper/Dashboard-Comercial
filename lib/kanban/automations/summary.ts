// Versão: 1.2 | Data: 09/09/2026
// v1.2 (09/09/2026): a frase da série periódica. Ela diz a CADÊNCIA PADRÃO e
//   avisa que há exceções — o número que vale para um registro específico só a
//   cascata sabe, e prometer o contrário na lista seria mentira.
// v1.1 (09/09/2026): a frase da ação `run_schema`. O rótulo do esquema não vem
//   do módulo (ele é puro e não consulta nada) — quem tem a lista carregada
//   passa `labels`; sem ela a frase usa a chave, que é o que a regra guarda.
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
export function automationSummary(
  rule: AutomationRule,
  labels?: Record<string, string>
): string {
  const when = rule.conditions.map(conditionText).join(" e ");
  const a = rule.action;
  const then =
    a.type === "move_to_column"
      ? `mover para "${a.targetKey}"`
      : a.type === "set_field"
        ? `definir ${a.field} = "${a.value}"`
        : a.type === "run_schema"
          ? `executar o esquema "${labels?.[a.schemaKey] ?? a.schemaKey}"${
              a.simulate ? " (apenas simulação)" : ""
            }`
          : a.type === "create_task_series"
            ? // A cadência dita é a PADRÃO: o número que vale para um registro
              // específico só a cascata sabe, e prometer o contrário aqui
              // seria mentira na lista de regras.
              `abrir a cobrança "${a.series.title}" a cada ${a.series.cadence.defaultDays} dia(s)${
                a.series.cadence.overrideScopes.length > 0
                  ? " (com exceções por escopo)"
                  : ""
              }`
            : `abrir a tarefa "${a.title}"${
                a.dueInDays != null ? ` com prazo de ${a.dueInDays} dia(s)` : ""
              }`;
  return `Se ${when}, ${then}.`;
}

/** Rótulo curto da ação — para agrupar/filtrar sem ler a frase inteira. */
export function automationActionLabel(rule: AutomationRule): string {
  if (rule.action.type === "move_to_column") return "Mover de coluna";
  if (rule.action.type === "set_field") return "Definir campo";
  if (rule.action.type === "run_schema") return "Executar esquema";
  if (rule.action.type === "create_task_series") return "Série de tarefas";
  return "Abrir tarefa";
}
