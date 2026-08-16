// @vitest-environment jsdom
// Versão: 1.2 | Data: 16/08/2026
// v1.2: o export p/ Google Planilhas SAIU desta tela (exclusivo da Visão geral
// do admin) — o teste pina a AUSÊNCIA do botão; CSV e PDF seguem cobertos.
// Versão: 1.1 | Data: 02/08/2026
// v1.1: botão "Google Planilhas" (0115) — some sem config (vendedor não é
// admin); configurado, o clique chama a action com scope "minha". Actions de
// sheets mockadas (importam server-only).
// Versão: 1.0 | Data: 02/08/2026
// Testes da visão do vendedor: botões Exportar CSV/PDF do próprio
// demonstrativo — CSV dispara o download (blob) e PDF monta o portal
// [data-print-root], chama window.print e desmonta no afterprint (mesma
// mecânica da Visão geral; jsdom sem print/createObjectURL — stubs).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CompPlanConfig } from "@/lib/comp/model";

import { MyCompView, type MyCompViewProps } from "./my-comp-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/operacao/remuneracao",
}));
vi.mock("@/components/dashboards/pending-context", () => ({
  useNavPending: () => ({ pending: false, run: (fn: () => void) => fn() }),
}));
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
  }
  window.print = vi.fn();
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
});

const config: CompPlanConfig = {
  v: 1,
  factors: [
    {
      id: "vendas",
      label: "Vendas",
      weightPct: 100,
      metricKey: "m_v",
      money: true,
      formula: { tokens: [{ kind: "field", ref: "agg:sum:value" }] },
      sources: [],
    },
  ],
};

function renderView(over: Partial<MyCompViewProps> = {}) {
  return render(
    <MyCompView
      plans={[
        {
          id: "pB",
          name: "Plano B",
          active: true,
          base_amount_default: 1000,
          config,
          updated_at: "2026-08-01T00:00:00Z",
        },
      ]}
      entries={[
        {
          id: "e1",
          plan_id: "pB",
          responsible_id: "r_me",
          base_amount: null,
          inputs: {},
          computed: {
            v: 1,
            at: "2026-08-01T10:00:00Z",
            realized: { vendas: 50000 },
          },
          total: null,
          mirror_record_id: null,
          published_at: null,
          updated_at: "2026-08-01T10:00:00Z",
        },
      ]}
      targetsByPlan={{ pB: { vendas: 100000 } }}
      targetRatesByPlan={{}}
      year={2026}
      month={8}
      linked
      {...over}
    />
  );
}

describe("MyCompView export", () => {
  it("Exportar CSV baixa o demonstrativo (blob)", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("Exportar PDF monta o portal, imprime e desmonta no afterprint", async () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Exportar PDF" }));
    const root = document.querySelector("[data-print-root]");
    expect(root).not.toBeNull();
    expect(root!.textContent).toContain("Minha remuneração — Agosto de 2026");
    expect(root!.textContent).toContain("Plano B");
    await waitFor(() => expect(window.print).toHaveBeenCalled());
    fireEvent(window, new Event("afterprint"));
    await waitFor(() =>
      expect(document.querySelector("[data-print-root]")).toBeNull()
    );
    expect(document.body.dataset.printing).toBeUndefined();
  });

  it("sem lançamentos no mês não há botões de exportação", () => {
    renderView({ entries: [] });
    expect(
      screen.queryByRole("button", { name: /Exportar/ })
    ).toBeNull();
  });

  it("o export p/ Google Planilhas não existe nesta tela", () => {
    renderView();
    expect(
      screen.queryByRole("button", { name: /Google Planilhas/ })
    ).toBeNull();
  });
});
