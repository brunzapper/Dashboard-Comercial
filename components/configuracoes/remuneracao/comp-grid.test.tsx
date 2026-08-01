// @vitest-environment jsdom
// Versão: 1.0 | Data: 01/08/2026
// Testes da grade de Lançamentos — MEMÓRIA DE CÁLCULO da comissão (v1.5): o
// popover da célula Comissão mostra a multiplicação por bloco (helper único
// commissionMemory) e o Valor de fator com peso 0 sem override vira "—".
// Cenário espelha o plano real "SDR Inbound FC": fator de reuniões peso 0 +
// bloco per_unit por realizado (44 reuniões × R$ 12,50 = R$ 550).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CompPlanConfig } from "@/lib/comp/model";

import { CompGrid } from "./comp-grid";

vi.mock("@/app/(app)/configuracoes/remuneracao/actions", () => ({
  publishMonth: vi.fn(),
  recomputeMonth: vi.fn(),
  saveEntryInputs: vi.fn(async () => ({ ok: true })),
  saveTarget: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/feedback/notify", () => ({
  notifyActionError: vi.fn(),
}));

// Radix popper (floating-ui) exige ResizeObserver, que o jsdom não tem.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
  }
});

const config: CompPlanConfig = {
  v: 1,
  factors: [
    {
      id: "reunioes",
      label: "Reuniões",
      weightPct: 0,
      metricKey: "comp_reunioes",
      money: false,
      formula: { tokens: [{ kind: "field", ref: "agg:count:*" }] },
      sources: [],
    },
  ],
  commissions: [
    {
      id: "premio",
      label: "Prêmio por reunião",
      triggerFactorId: "reunioes",
      basisKind: "factor",
      basisFactorId: "reunioes",
      tierBy: "realized",
      kind: "per_unit",
      tiers: [
        { fromPct: 0, amount: 10 },
        { fromPct: 26, amount: 12.5 },
      ],
    },
  ],
};

function renderGrid() {
  return render(
    <CompGrid
      plan={{
        id: "p1",
        name: "Plano SDR",
        active: true,
        base_amount_default: null,
        config,
        updated_at: "2026-08-01T00:00:00Z",
      }}
      config={config}
      year={2026}
      month={8}
      entries={[
        {
          id: "e1",
          responsible_id: "r1",
          base_amount: null,
          inputs: {},
          computed: {
            v: 1,
            at: "2026-08-01T10:00:00Z",
            realized: { reunioes: 44 },
          },
          total: 550,
          mirror_record_id: null,
          published_at: null,
          updated_at: "2026-08-01T10:00:00Z",
        },
      ]}
      responsibles={[{ id: "r1", label: "Paulo Vitor Santos" }]}
      targets={{}}
      operationMembersById={{}}
      targetRates={{}}
    />
  );
}

// Intl pt-BR emite NBSP entre "R$" e o número — normalizar antes de comparar.
const bodyText = () => (document.body.textContent ?? "").replace(/ /g, " ");

describe("CompGrid — memória de cálculo", () => {
  it("popover da Comissão mostra a multiplicação e a faixa do bloco", async () => {
    renderGrid();
    fireEvent.click(
      screen.getByRole("button", { name: "Memória de cálculo da comissão" })
    );
    await waitFor(() => {
      expect(bodyText()).toContain("44 (Reuniões) × R$ 12,50 = R$ 550,00");
      expect(bodyText()).toContain("faixa a partir de 26 (Reuniões: 44)");
    });
  });

  it("Valor de fator com peso 0 sem override exibe — (display-only)", () => {
    renderGrid();
    const dash = screen.getByTitle(/^Peso 0%/);
    expect(dash.textContent).toBe("—");
  });
});
