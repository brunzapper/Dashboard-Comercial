// Versão: 1.0 | Data: 09/09/2026
// A guarda contra a SEGUNDA RÉGUA: o painel do quadro e a tela de construção
// do Workflow têm de renderizar o MESMO editor de regra.
//
// Não é preciso montar React para proteger isso — o que importa é que existe
// UM módulo dono do editor e que os dois hosts o importam de lá. Uma segunda
// cópia divergiria no primeiro campo novo (foi assim que a prévia da IA
// esqueceu de uma ação, na 0129).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editor = "components/kanban/automation-rule-editor";

describe("editor de regra: um dono só", () => {
  it("o painel do quadro importa o editor em vez de ter o próprio", () => {
    const sheet = readFileSync("components/kanban/automations-sheet.tsx", "utf8");
    expect(sheet).toContain('from "./automation-rule-editor"');
    expect(sheet).toContain("<AutomationRuleEditor");
  });

  it("a tela de construção do Workflow importa o MESMO módulo", () => {
    const screen = readFileSync(
      "components/operacao/workflow-rule-screen.tsx",
      "utf8"
    );
    expect(screen).toContain(`from "@/${editor}"`);
    expect(screen).toContain("<AutomationRuleEditor");
  });

  it("o editor não sabe onde está: o host decide salvar e cancelar", () => {
    // Se o editor voltar a chamar a action direto, ele deixa de servir aos
    // dois hosts (o sheet volta para a lista; a tela navega).
    const src = readFileSync(`${editor}.tsx`, "utf8");
    expect(src).toContain("onSave");
    expect(src).toContain("onCancel");
    expect(src).not.toContain("saveAutomation(");
  });

  it("a lista do Workflow leva à tela de construção de QUALQUER automação", () => {
    // Inclusive a de Base, que não tem quadro para abrir — o furo desta rodada.
    const manager = readFileSync(
      "components/operacao/workflow-schemas-manager.tsx",
      "utf8"
    );
    expect(manager).toContain("/operacao/workflow/rule:${row.id}");
  });
});
