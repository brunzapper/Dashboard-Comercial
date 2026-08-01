// @vitest-environment jsdom
// Versão: 1.0 | Data: 01/08/2026
// Testes da tela de Responsáveis (admin) — recolhimento dos apelidos (0101):
// apelido não aparece como linha de topo; o badge "N unificados" expande e
// recolhe as linhas-filho (com os controles de desfazer preservados); apelido
// órfão (principal fora da lista — defensivo) segue como linha de topo.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ResponsiblesManager,
  type ResponsibleRow,
} from "@/components/admin/responsibles-manager";

vi.mock("@/app/(app)/configuracoes/responsaveis/actions", () => ({
  addResponsibleOperation: vi.fn(),
  createResponsible: vi.fn(),
  removeResponsibleOperation: vi.fn(),
  setResponsibleActive: vi.fn(),
  setResponsibleCanonical: vi.fn(),
}));

const row = (over: Partial<ResponsibleRow> & { id: string }): ResponsibleRow => ({
  display_name: over.id,
  bitrix_user_id: null,
  active: true,
  canonical_id: null,
  ops: [],
  ...over,
});

describe("ResponsiblesManager — apelidos recolhidos (0101)", () => {
  it("apelido não aparece por padrão; badge expande e recolhe as linhas-filho", () => {
    render(
      <ResponsiblesManager
        responsibles={[
          row({ id: "p1", display_name: "Paulo Vitor Santos" }),
          row({
            id: "a1",
            display_name: "Paulo",
            canonical_id: "p1",
            active: false,
          }),
        ]}
        operations={[]}
      />
    );
    // Recolhido: só o principal na tabela.
    expect(screen.queryByText("Paulo")).toBeNull();
    const badge = screen.getByRole("button", {
      name: "Mostrar unificados de Paulo Vitor Santos",
    });
    expect(badge).toHaveAttribute("aria-expanded", "false");
    expect(badge).toHaveTextContent("1 unificado");

    // Expande: a linha do apelido aparece com o controle de desfazer.
    fireEvent.click(badge);
    expect(screen.getByText("Paulo")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Nome usado para Paulo")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Recolher unificados de Paulo Vitor Santos",
      })
    ).toHaveAttribute("aria-expanded", "true");

    // Recolhe de novo.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Recolher unificados de Paulo Vitor Santos",
      })
    );
    expect(screen.queryByText("Paulo")).toBeNull();
  });

  it("apelido órfão (principal fora da lista) segue como linha de topo, sem badge", () => {
    render(
      <ResponsiblesManager
        responsibles={[
          row({ id: "o1", display_name: "Órfã", canonical_id: "fantasma" }),
        ]}
        operations={[]}
      />
    );
    expect(screen.getByText("Órfã")).toBeInTheDocument();
    expect(screen.queryByText(/unificado/)).toBeNull();
  });
});
