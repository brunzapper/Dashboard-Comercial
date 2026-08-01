// @vitest-environment jsdom
// Versão: 1.0 | Data: 01/08/2026
// Testes de navegação do manager — aba "geral" (Visão geral): pill PRIMEIRA e
// selecionada no landing; a aba é expressa pela AUSÊNCIA de ?plano/?aba na
// URL (clicar numa pill de plano vindo da geral emite ?plano SEM aba; clicar
// em Visão geral emite URL sem plano/aba).
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CompPlanConfig } from "@/lib/comp/model";

import {
  RemuneracaoManager,
  type RemuneracaoManagerProps,
} from "./remuneracao-manager";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/configuracoes/remuneracao",
}));
vi.mock("@/components/dashboards/pending-context", () => ({
  useNavPending: () => ({ pending: false, run: (fn: () => void) => fn() }),
}));
// O editor puxa a árvore inteira de fórmulas/actions — fora do foco daqui.
vi.mock("./plan-editor", () => ({ PlanEditor: () => null }));
vi.mock("@/app/(app)/configuracoes/remuneracao/actions", () => ({
  publishMonth: vi.fn(),
  recomputeMonth: vi.fn(),
  saveEntryInputs: vi.fn(),
  saveTarget: vi.fn(),
}));
vi.mock("@/lib/feedback/notify", () => ({ notifyActionError: vi.fn() }));

beforeEach(() => {
  replace.mockClear();
});

const config: CompPlanConfig = {
  v: 1,
  factors: [
    {
      id: "f",
      label: "Vendas",
      weightPct: 100,
      metricKey: "m",
      money: true,
      formula: { tokens: [{ kind: "field", ref: "agg:sum:value" }] },
      sources: [],
    },
  ],
};

function renderManager(over: Partial<RemuneracaoManagerProps> = {}) {
  return render(
    <RemuneracaoManager
      plans={[
        {
          id: "pA",
          name: "Plano A",
          active: true,
          base_amount_default: null,
          config,
          updated_at: "2026-08-01T00:00:00Z",
        },
      ]}
      selectedPlanId="pA"
      aba="geral"
      year={2026}
      month={8}
      entries={[]}
      responsibles={[]}
      targets={{}}
      targetRates={{}}
      editorCatalog={null}
      overview={{ entries: [], targetsByPlan: {}, targetRatesByPlan: {} }}
      operations={[]}
      operationMembersById={{}}
      {...over}
    />
  );
}

describe("RemuneracaoManager — Visão geral", () => {
  it("pill Visão geral é a primeira do tablist e abre selecionada no landing", () => {
    renderManager();
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]?.textContent).toBe("Visão geral");
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    // Sub-abas Lançamentos/Plano não existem na geral.
    expect(screen.queryByText("Lançamentos")).toBeNull();
  });

  it("clicar numa pill de plano sai da geral com ?plano e SEM aba", () => {
    renderManager();
    fireEvent.click(screen.getByRole("tab", { name: /Plano A/ }));
    expect(replace).toHaveBeenCalledTimes(1);
    const url = String(replace.mock.calls[0][0]);
    expect(url).toContain("plano=pA");
    expect(url).not.toContain("aba=");
  });

  it("clicar em Visão geral (vindo da grade) emite URL sem plano/aba", () => {
    renderManager({ aba: "grade" });
    fireEvent.click(screen.getByRole("tab", { name: "Visão geral" }));
    expect(replace).toHaveBeenCalledTimes(1);
    const url = String(replace.mock.calls[0][0]);
    expect(url).not.toContain("plano=");
    expect(url).not.toContain("aba=");
    expect(url).toContain("ano=2026");
    expect(url).toContain("mes=8");
  });
});
