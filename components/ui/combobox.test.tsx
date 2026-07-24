// @vitest-environment jsdom
// Versão: 1.0 | Data: 24/07/2026
// Testes do Combobox compartilhado (Popover + cmdk) — exercita os stubs de
// jsdom do setup (scrollIntoView/pointer capture/ResizeObserver). Política do
// app: opção com disabledReason fica VISÍVEL, acinzentada e inerte (explicar,
// nunca esconder). Chips filtram a navegação e trocam para o cleanLabel.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Combobox } from "@/components/ui/combobox";

const OPTIONS = [
  { value: "value", label: "Deals · Valor", cleanLabel: "Valor", chips: ["deals"] },
  { value: "custom:origem", label: "Leads · Origem", cleanLabel: "Origem", chips: ["leads"] },
  {
    value: "custom:ciclo",
    label: "Ciclo",
    disabledReason: "Criaria dependência circular.",
  },
];

const CHIPS = [
  { key: "deals", label: "Deals" },
  { key: "leads", label: "Leads" },
];

describe("Combobox", () => {
  it("abre, seleciona e fecha; hidden input segue o value (forms nativos)", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { container } = render(
      <Combobox
        options={OPTIONS}
        value=""
        onValueChange={onValueChange}
        name="campo"
        aria-label="Campo"
      />
    );
    expect(
      container.querySelector('input[name="campo"]')
    ).toHaveValue("");
    await user.click(screen.getByRole("combobox", { name: "Campo" }));
    await user.click(within(document.body).getByText("Deals · Valor"));
    expect(onValueChange).toHaveBeenCalledWith("value");
  });

  it("opção com disabledReason é visível, marcada e NÃO selecionável", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Combobox options={OPTIONS} value="" onValueChange={onValueChange} aria-label="Campo" />);
    await user.click(screen.getByRole("combobox", { name: "Campo" }));
    const item = within(document.body)
      .getByText("Ciclo")
      .closest("[cmdk-item]") as HTMLElement;
    // O cmdk gerencia o próprio aria-disabled; o contrato do app é visual
    // (acinzentada) + inerte no clique, com o motivo no tooltip.
    expect(item.className).toContain("cursor-not-allowed");
    await user.click(item);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("chip ativo filtra a lista e troca para o cleanLabel", async () => {
    const user = userEvent.setup();
    render(
      <Combobox
        options={OPTIONS}
        value=""
        onValueChange={() => {}}
        chips={CHIPS}
        aria-label="Campo"
      />
    );
    await user.click(screen.getByRole("combobox", { name: "Campo" }));
    const body = within(document.body);
    // Visão "Todas": rótulo completo.
    expect(body.getByText("Deals · Valor")).toBeInTheDocument();
    await user.click(body.getByRole("button", { name: "Deals" }));
    // Chip ativo: cleanLabel; opção de outro chip some; sem chips declarados
    // (Ciclo) aparece sempre.
    expect(body.getByText("Valor")).toBeInTheDocument();
    expect(body.queryByText("Leads · Origem")).not.toBeInTheDocument();
    expect(body.getByText("Ciclo")).toBeInTheDocument();
  });
});
