// Versão: 1.0 | Data: 08/09/2026
// O resumo é o que faz alguém reconhecer uma regra numa lista sem abrir o
// editor dela. Não valida nada — só descreve; a régua segue em
// parseAutomationRule e decideActions.
import { describe, expect, it } from "vitest";

import { automationActionLabel, automationSummary } from "./summary";
import type { AutomationRule } from "./types";

const base = (over: Partial<AutomationRule>): AutomationRule => ({
  v: 1,
  conditions: [{ kind: "field", filter: { field: "stage", op: "eq", value: "novo" } }],
  action: { type: "set_field", field: "prioridade", value: "alta" },
  ...over,
});

describe("automationSummary", () => {
  it("descreve condição e ação numa frase", () => {
    expect(automationSummary(base({}))).toBe(
      'Se stage eq novo, definir prioridade = "alta".'
    );
  });

  it("junta várias condições com E (é assim que elas combinam)", () => {
    const s = automationSummary(
      base({
        conditions: [
          { kind: "field", filter: { field: "stage", op: "eq", value: "novo" } },
          { kind: "tasks", metric: "open", op: "eq", value: 0 },
        ],
      })
    );
    expect(s).toContain(" e ");
    expect(s).toContain("exatamente 0 tarefa(s) aberta(s)");
  });

  it("condição de tempo diz a base e o sentido", () => {
    const s = automationSummary(
      base({
        conditions: [
          {
            kind: "time",
            basis: { type: "field_changed", field: "stage" },
            op: "gte",
            days: 7,
          },
        ],
      })
    );
    expect(s).toContain("stage sem alteração há mais de 7 dia(s)");
  });

  it("filtro com lista mostra os valores, não [object Object]", () => {
    const s = automationSummary(
      base({
        conditions: [
          {
            kind: "field",
            filter: { field: "stage", op: "in", value: ["novo", "quente"] },
          },
        ],
      })
    );
    expect(s).toContain("novo, quente");
    expect(s).not.toContain("object");
  });

  it("rotula a ação para agrupar sem ler a frase", () => {
    expect(automationActionLabel(base({}))).toBe("Definir campo");
    expect(
      automationActionLabel(
        base({ action: { type: "move_to_column", targetKey: "quente" } })
      )
    ).toBe("Mover de coluna");
  });
});
