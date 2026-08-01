// @vitest-environment jsdom
// Versão: 1.0 | Data: 01/08/2026
// Testes da Visão geral da Remuneração: agrupamento por plano (default) e por
// pessoa, memória de cálculo visível nos cards, membro sem lançamento com
// nota, somente leitura (sem Recalcular/Publicar) e preferência de
// agrupamento em localStorage (`comp-overview:group`).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { fmtMoneyBRL } from "@/lib/comp/commission-label";
import type { CompPlanConfig } from "@/lib/comp/model";

import { CompOverview } from "./comp-overview";
import type {
  CompEntryClientRow,
  CompPlanClientRow,
} from "./remuneracao-manager";

// Radix (tooltips dos cards) exige ResizeObserver, ausente no jsdom.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
  }
  window.localStorage.clear();
});

// Plano A: 100% comissão (fator peso 0 + per_unit) — memória "44 × R$ 12,50".
const configA: CompPlanConfig = {
  v: 1,
  factors: [
    {
      id: "reunioes",
      label: "Reuniões",
      weightPct: 0,
      metricKey: "m_r",
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

// Plano B: clássico (peso 100%).
const configB: CompPlanConfig = {
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

const plans: CompPlanClientRow[] = [
  {
    id: "pA",
    name: "Plano A",
    active: true,
    base_amount_default: null,
    config: configA,
    updated_at: "2026-08-01T00:00:00Z",
  },
  {
    id: "pB",
    name: "Plano B",
    active: true,
    base_amount_default: 1000,
    config: configB,
    updated_at: "2026-08-01T00:00:00Z",
  },
];

function entry(
  id: string,
  planId: string,
  respId: string,
  realized: Record<string, number>
): CompEntryClientRow & { plan_id: string } {
  return {
    id,
    plan_id: planId,
    responsible_id: respId,
    base_amount: null,
    inputs: {},
    computed: { v: 1, at: "2026-08-01T10:00:00Z", realized },
    total: null,
    mirror_record_id: null,
    published_at: null,
    updated_at: "2026-08-01T10:00:00Z",
  };
}

function renderOverview() {
  return render(
    <CompOverview
      plans={plans}
      entries={[
        // Ana lançada no A (44 reuniões ⇒ R$ 550); Bruno lançado no B
        // (50k/100k ⇒ 1000×100%×50% = R$ 500). Cruzados ficam SEM lançamento.
        entry("e1", "pA", "r_ana", { reunioes: 44 }),
        entry("e2", "pB", "r_bruno", { vendas: 50000 }),
      ]}
      targetsByPlan={{ pB: { r_bruno: { vendas: 100000 } } }}
      targetRatesByPlan={{}}
      responsibles={[
        { id: "r_ana", label: "Ana" },
        { id: "r_bruno", label: "Bruno" },
      ]}
      operationMembersById={{}}
      year={2026}
      month={8}
    />
  );
}

// NBSP do Intl pt-BR normalizado dos DOIS lados da comparação.
const norm = (s: string) => s.replace(/ /g, " ");
const bodyText = () => norm(document.body.textContent ?? "");
const money = (v: number) => norm(fmtMoneyBRL(v));
const firstHeading = () =>
  screen.getAllByRole("heading", { level: 2 })[0]?.textContent ?? "";

describe("CompOverview", () => {
  it("default por plano: seções por plano, cards pelo nome do membro, totais", () => {
    renderOverview();
    // 1ª seção = Plano A (agrupamento por plano).
    expect(firstHeading()).toContain("Plano A");
    // Memória visível nos cards.
    expect(bodyText()).toContain("44 (Reuniões) × R$ 12,50 = R$ 550,00");
    // Membro sem lançamento no plano (Bruno no A e Ana no B).
    expect(bodyText()).toContain("sem lançamento no mês");
    // Totais derivados do computeEntry: A = 550; B = 500; geral = 1050.
    expect(bodyText()).toContain(`Total do mês: ${money(1050)}`);
    expect(bodyText()).toContain(money(550));
    expect(bodyText()).toContain(money(500));
  });

  it("toggle por pessoa reagrupa (seções por responsável)", () => {
    renderOverview();
    fireEvent.click(screen.getByRole("button", { name: "Por pessoa" }));
    expect(firstHeading()).toContain("Ana");
  });

  it("é somente leitura: sem Recalcular/Publicar", () => {
    renderOverview();
    expect(
      screen.queryByRole("button", { name: /Recalcular|Publicar/ })
    ).toBeNull();
  });

  it("preferência salva abre por pessoa; 'Usar como padrão' grava a chave", async () => {
    window.localStorage.setItem("comp-overview:group", "por-pessoa");
    renderOverview();
    // A preferência entra pós-mount (effect).
    await waitFor(() => expect(firstHeading()).toContain("Ana"));
    // Volta para por plano e fixa como padrão.
    fireEvent.click(screen.getByRole("button", { name: "Por plano" }));
    fireEvent.click(screen.getByRole("button", { name: "Usar como padrão" }));
    expect(window.localStorage.getItem("comp-overview:group")).toBe(
      "por-plano"
    );
    // Botão vira "Padrão" (desabilitado) quando atual === salvo.
    expect(screen.getByRole("button", { name: "Padrão" })).toBeTruthy();
  });
});
