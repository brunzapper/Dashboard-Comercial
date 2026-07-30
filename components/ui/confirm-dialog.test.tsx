// @vitest-environment jsdom
// Versão: 1.0 | Data: 29/07/2026
// Testes do ConfirmDialog (casca controlada sobre o AlertDialog): abre pelo
// estado, Cancelar não confirma, confirmar chama onConfirm, pending desabilita.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

function setup(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title="Excluir item?"
      description="Isso não pode ser desfeito."
      onConfirm={onConfirm}
      {...props}
    />
  );
  return { onConfirm, onOpenChange };
}

describe("ConfirmDialog", () => {
  it("renderiza título, descrição e os dois botões", () => {
    setup();
    expect(screen.getByText("Excluir item?")).toBeInTheDocument();
    expect(screen.getByText("Isso não pode ser desfeito.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excluir" })).toBeInTheDocument();
  });

  it("Cancelar fecha sem chamar onConfirm", async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = setup();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("confirmar chama onConfirm", async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup({ actionLabel: "Remover" });
    await user.click(screen.getByRole("button", { name: "Remover" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("pending desabilita os dois botões", () => {
    setup({ pending: true });
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Excluir" })).toBeDisabled();
  });
});
