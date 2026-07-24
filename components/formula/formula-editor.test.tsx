// @vitest-environment jsdom
// Versão: 1.0 | Data: 24/07/2026
// Testes do FormulaEditor — a superfície ÚNICA de edição de fórmulas
// (AGENTS.md). Invariantes: a troca Visual↔Texto NUNCA é destrutiva (texto com
// erro BLOQUEIA a aba Visual e preserva o digitado), a linha de status usa as
// MESMAS mensagens do servidor (validateFormulaForContext), excludeKeys
// desabilita operando de ciclo SEM escondê-lo do catálogo de exibição, o modo
// formulário emite o contrato formula/formula_text/formula_mode do FieldForm e
// o onChange deduplica por assinatura (regressão v1.1 do loop de re-emissão).
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FormulaEditor } from "@/components/formula/formula-editor";
import type { RefOption } from "@/lib/records/date-operands";
import { COND_AGG_IN_RECORD_MSG } from "@/lib/records/formula-validate";
import type { Formula, FormulaToken } from "@/lib/records/formulas";

const CATALOG: RefOption[] = [
  { ref: "value", label: "Valor" },
  { ref: "custom:licencas", label: "Licenças" },
];

const ref = (r: string): FormulaToken => ({ kind: "field", ref: r });
const hidden = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLInputElement>(`input[name="${name}"]`);

describe("troca de view (nunca destrutiva)", () => {
  it("fórmula com source abre no Texto e faz round-trip sem perder conteúdo", () => {
    const initial: Formula = {
      tokens: [ref("value"), { kind: "op", op: "+" }, { kind: "const", value: 1 }],
      source: "[Valor] + 1",
    };
    const { container } = render(
      <FormulaEditor context="record" catalog={CATALOG} initial={initial} formInputs />
    );
    // Abriu no texto (preserva o autorado) e o hidden reflete o modo.
    expect(screen.getByRole("textbox")).toHaveValue("[Valor] + 1");
    expect(hidden(container, "formula_mode")).toHaveValue("text");

    fireEvent.click(screen.getByRole("button", { name: "Visual" }));
    expect(hidden(container, "formula_mode")).toHaveValue("builder");
    expect(JSON.parse(hidden(container, "formula")!.value).tokens).toEqual(
      initial.tokens
    );

    // Volta ao texto SEM regenerar (nenhuma edição visual): byte-idêntico.
    fireEvent.click(screen.getByRole("button", { name: "Texto" }));
    expect(hidden(container, "formula_text")).toHaveValue("[Valor] + 1");
  });

  it("texto com erro BLOQUEIA a aba Visual e mantém o digitado", () => {
    render(
      <FormulaEditor
        context="record"
        catalog={CATALOG}
        initial={{ tokens: [], source: "[Coluna Sumida] +" }}
      />
    );
    const visualTab = screen.getByRole("button", { name: "Visual" });
    expect(visualTab).toBeDisabled();
    fireEvent.click(visualTab);
    // Continua no texto, com o conteúdo intacto.
    expect(screen.getByDisplayValue("[Coluna Sumida] +")).toBeInTheDocument();
  });
});

describe("linha de status (fiação com validateFormulaForContext)", () => {
  it("SOMASE em contexto por-registro exibe a mensagem dedicada do servidor", () => {
    const initial: Formula = {
      tokens: [
        { kind: "func", name: "SOMASE" },
        { kind: "lparen" },
        ref("value"),
        { kind: "argsep" },
        ref("value"),
        { kind: "cmp", op: ">" },
        { kind: "const", value: 0 },
        { kind: "rparen" },
      ],
    };
    render(
      <FormulaEditor context="record" catalog={CATALOG} initial={initial} />
    );
    expect(screen.getByText(COND_AGG_IN_RECORD_MSG)).toBeInTheDocument();
  });

  it("fórmula válida exibe o status verde", () => {
    render(
      <FormulaEditor
        context="record"
        catalog={CATALOG}
        initial={{ tokens: [ref("value"), { kind: "op", op: "*" }, { kind: "const", value: 2 }] }}
      />
    );
    expect(screen.getByText("Fórmula válida")).toBeInTheDocument();
  });

  it("excludeKeys tira a ref do conjunto de validação (ciclo → coluna inválida)", () => {
    render(
      <FormulaEditor
        context="record"
        catalog={CATALOG}
        initial={{ tokens: [ref("custom:licencas")] }}
        excludeKeys={new Set(["licencas"])}
      />
    );
    expect(
      screen.getByText("Coluna inválida na fórmula: custom:licencas")
    ).toBeInTheDocument();
  });
});

describe("onChange controlado (dedupe por assinatura)", () => {
  it("não reemite quando só a IDENTIDADE do catálogo muda", () => {
    const onChange = vi.fn();
    const initial: Formula = { tokens: [ref("value")] };
    const { rerender } = render(
      <FormulaEditor context="record" catalog={CATALOG} initial={initial} onChange={onChange} />
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    // Novo array com o MESMO conteúdo (host re-renderizou): nada a emitir.
    rerender(
      <FormulaEditor
        context="record"
        catalog={[...CATALOG.map((o) => ({ ...o }))]}
        initial={initial}
        onChange={onChange}
      />
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ tokens: initial.tokens }, { ok: true });
  });

  it("edição real (inserir operador) reemite com o novo conteúdo", () => {
    const onChange = vi.fn();
    render(
      <FormulaEditor
        context="record"
        catalog={CATALOG}
        initial={{ tokens: [ref("value")] }}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "+" }));
    expect(onChange).toHaveBeenCalledTimes(2);
    const [formula, status] = onChange.mock.calls[1];
    expect(formula.tokens).toEqual([ref("value"), { kind: "op", op: "+" }]);
    expect(status.ok).toBe(false); // "[Valor] +" é incompleta
  });
});
