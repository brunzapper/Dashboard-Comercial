// @vitest-environment jsdom
// Versão: 1.0 | Data: 24/07/2026
// Testes da view visual (chips + cursor): navegação por teclado, remoção e o
// chip "⚠ Campo indisponível" para ref fora do catálogo (a ref bruta fica SÓ
// no tooltip — nunca string crua no meio da fórmula).
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FormulaChips } from "@/components/formula/formula-chips";
import type { RefOption } from "@/lib/records/date-operands";
import type { FormulaToken } from "@/lib/records/formulas";

const CATALOG: RefOption[] = [{ ref: "value", label: "Valor" }];
const TOKENS: FormulaToken[] = [
  { kind: "field", ref: "value" },
  { kind: "op", op: "/" },
  { kind: "const", value: 2 },
];

function setup(over?: Partial<Parameters<typeof FormulaChips>[0]>) {
  const props = {
    tokens: TOKENS,
    caret: TOKENS.length,
    catalog: CATALOG,
    onCaret: vi.fn(),
    onRemove: vi.fn(),
    onBackspace: vi.fn(),
    ...over,
  };
  render(<FormulaChips {...props} />);
  return props;
}

describe("FormulaChips", () => {
  it("teclado: setas movem o cursor (com clamp), Backspace/Delete removem", () => {
    const p = setup({ caret: 1 });
    const box = screen.getByRole("listbox");
    fireEvent.keyDown(box, { key: "ArrowLeft" });
    expect(p.onCaret).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(box, { key: "ArrowRight" });
    expect(p.onCaret).toHaveBeenLastCalledWith(2);
    fireEvent.keyDown(box, { key: "Home" });
    expect(p.onCaret).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(box, { key: "End" });
    expect(p.onCaret).toHaveBeenLastCalledWith(3);
    fireEvent.keyDown(box, { key: "Backspace" });
    expect(p.onBackspace).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(box, { key: "Delete" });
    expect(p.onRemove).toHaveBeenCalledWith(1); // remove o token sob o cursor
  });

  it("botão × remove o chip; clique no chip posiciona o cursor depois dele", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: "Remover Valor" }));
    expect(p.onRemove).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByText("Valor"));
    expect(p.onCaret).toHaveBeenCalledWith(1);
  });

  it("ref fora do catálogo vira chip de indisponível com a ref SÓ no tooltip", () => {
    setup({ tokens: [{ kind: "field", ref: "custom:sumido" }], caret: 1 });
    const chip = screen.getByText("⚠ Campo indisponível");
    expect(chip.closest("span[title]")?.getAttribute("title")).toContain(
      "custom:sumido"
    );
    expect(screen.queryByText("custom:sumido")).not.toBeInTheDocument();
  });

  it("rótulos de exibição: sourceHint prefixa e pontuação usa glifos", () => {
    setup({
      tokens: [
        { kind: "field", ref: "value" },
        { kind: "op", op: "*" },
        { kind: "cmp", op: "<>" },
      ],
      catalog: [{ ref: "value", label: "Valor", sourceHint: "Deals" }],
      caret: 0,
    });
    expect(screen.getByText("Deals · Valor")).toBeInTheDocument();
    expect(screen.getByText("×")).toBeInTheDocument();
    expect(screen.getByText("≠")).toBeInTheDocument();
  });
});
