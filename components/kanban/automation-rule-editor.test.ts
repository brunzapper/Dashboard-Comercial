// Versão: 1.1 | Data: 09/09/2026
// v1.1 (09/09/2026): o ROUND-TRIP da série. Era um bug de perda de dado:
//   editar e salvar uma regra pela UI apagava from/description/maxOccurrences,
//   porque draftFromRule não os lia de volta.
// A guarda contra a SEGUNDA RÉGUA: o painel do quadro e a tela de construção
// do Workflow têm de renderizar o MESMO editor de regra.
//
// Não é preciso montar React para proteger isso — o que importa é que existe
// UM módulo dono do editor e que os dois hosts o importam de lá. Uma segunda
// cópia divergiria no primeiro campo novo (foi assim que a prévia da IA
// esqueceu de uma ação, na 0129).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { draftToRule, ruleToDraft } from "./automation-rule-editor";
import type { AutomationRow } from "@/lib/kanban/automations/types";

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

// ---------------------------------------------------------------------------
// v1.1 — o round-trip não pode perder configuração.
// ---------------------------------------------------------------------------
const SERIE_COMPLETA = {
  v: 1 as const,
  conditions: [
    {
      kind: "field" as const,
      filter: { field: "stage", op: "in" as const, value: ["Nutrição"] },
    },
  ],
  action: {
    type: "create_task_series" as const,
    series: {
      key: "nutricao_deals",
      title: "Acompanhar deal em Nutrição",
      description: "Ligar e registrar o retorno",
      anchor: { kind: "field_changed" as const, field: "stage" },
      anchorFallback: "criacao" as const,
      from: { kind: "date" as const, date: "2026-07-01" },
      until: { kind: "field_changed" as const, field: "assinatura" },
      cadence: {
        defaultDays: 15,
        overrideScopes: [
          { kind: "record" as const },
          { kind: "responsible" as const },
          { kind: "field" as const, field: "stage" },
        ],
      },
      firstAt: "imediato" as const,
      maxOccurrences: 20,
      lookahead: 5,
      grantAttribute: "tree",
    },
  },
};

const row = (): AutomationRow => ({
  id: "rule-1",
  name: "Acompanhamento — Nutrição",
  enabled: true,
  position: 0,
  rule: SERIE_COMPLETA,
  last_run_at: null,
  last_error: null,
  last_moved_count: 0,
});

describe("round-trip da série no editor", () => {
  it("editar e salvar PRESERVA tudo o que estava no jsonb", () => {
    const voltou = draftToRule(ruleToDraft(row(), []));
    expect(voltou).not.toBeNull();
    expect(voltou!.action).toEqual(SERIE_COMPLETA.action);
  });

  it("preserva um a um os campos que a UI apagava em silêncio", () => {
    const voltou = draftToRule(ruleToDraft(row(), []));
    const serie = (voltou!.action as unknown as { series: Record<string, unknown> })
      .series;
    // Os três que draftFromRule não lia de volta...
    expect(serie.from).toEqual({ kind: "date", date: "2026-07-01" });
    expect(serie.description).toBe("Ligar e registrar o retorno");
    expect(serie.maxOccurrences).toBe(20);
    // ...e o que não tinha controle nenhum, sem o qual não há Tree.
    expect(serie.grantAttribute).toBe("tree");
  });

  it("um segundo round-trip é idempotente", () => {
    const uma = draftToRule(ruleToDraft(row(), []))!;
    const duas = draftToRule(ruleToDraft({ ...row(), rule: uma }, []))!;
    expect(duas.action).toEqual(uma.action);
  });
});
