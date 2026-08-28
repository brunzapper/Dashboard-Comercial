// @vitest-environment jsdom
// Versão: 1.1 | Data: 17/08/2026
// v1.1: mesma regra do presetKey para `detailGrouping` (engrenagem dos blocos
// do detalhamento) — o editor não o edita, mas precisa RE-EMITI-LO no save.
// Versão: 1.0 | Data: 01/08/2026
// Testes do editor de planos — round-trip das CONDIÇÕES DO RECORTE
// (factor.filters, v1.5): o save RE-EMITE os filtros do config (antes o
// rebuild dos fatores os destruía em silêncio no primeiro save) e condição
// com valor vazio é erro amigável ANTES do servidor (savePlan nem dispara).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { CompPlanConfig } from "@/lib/comp/model";

import { PlanEditor } from "./plan-editor";

const savePlan = vi.fn();
vi.mock("@/app/(app)/operacao/remuneracao/actions", () => ({
  savePlan: (...args: unknown[]) => savePlan(...args),
  deletePlan: vi.fn(),
}));
vi.mock("@/app/(app)/dashboards/formula-preview-actions", () => ({
  previewAggregateFormula: vi.fn(),
}));
vi.mock("@/app/(app)/dashboards/actions", () => ({
  listFilterOptionCandidates: vi.fn(async () => []),
}));
const notifyActionError = vi.fn();
vi.mock("@/lib/feedback/notify", () => ({
  notifyActionError: (...args: unknown[]) => notifyActionError(...args),
}));
// O FormulaEditor puxa a árvore inteira do editor de fórmulas — fora do foco
// destes testes (o contrato formula/preview tem cobertura própria).
vi.mock("@/components/formula/formula-editor", () => ({
  FormulaEditor: () => null,
}));

const FILTERS = [
  { field: "stage", op: "eq" as const, value: "Lead Qualificado" },
  { field: "custom:fonte", op: "in" as const, value: ["Inbound", "Outro"] },
];

function makeConfig(over: Partial<CompPlanConfig> = {}): CompPlanConfig {
  return {
    v: 1,
    factors: [
      {
        id: "f_r",
        label: "Reuniões",
        weightPct: 0,
        metricKey: "comp_reunioes",
        money: false,
        formula: { tokens: [{ kind: "field", ref: "agg:count:*" }] },
        sources: [],
        memberField: "custom:sdr_reuniao",
        filters: FILTERS.map((x) => ({ ...x })),
      },
    ],
    ...over,
  };
}

function renderEditor(config: CompPlanConfig) {
  return render(
    <PlanEditor
      plan={{
        id: "p1",
        name: "Plano SDR",
        active: true,
        base_amount_default: 1000,
        config,
        updated_at: "2026-08-01",
      }}
      config={config}
      metrics={[]}
      responsibles={[]}
      available={[]}
      allFields={[]}
      sources={[]}
      operations={[]}
      operationMembersById={{}}
      currencies={[]}
      onSaved={vi.fn()}
      onDeleted={vi.fn()}
    />
  );
}

beforeEach(() => {
  savePlan.mockReset();
  savePlan.mockResolvedValue({ ok: true, planId: "p1" });
  notifyActionError.mockReset();
});

describe("PlanEditor — condições do recorte (factor.filters)", () => {
  it("save RE-EMITE os filtros do config (round-trip sem perda)", async () => {
    renderEditor(makeConfig());
    fireEvent.click(screen.getByRole("button", { name: "Salvar plano" }));
    await waitFor(() => expect(savePlan).toHaveBeenCalledTimes(1));
    const payload = savePlan.mock.calls[0][0] as {
      config: CompPlanConfig;
    };
    expect(payload.config.factors[0].filters).toEqual(FILTERS);
    // O resto do fator segue intacto (memberField incluso).
    expect(payload.config.factors[0].memberField).toBe("custom:sdr_reuniao");
    expect(notifyActionError).not.toHaveBeenCalled();
  });

  it("save RE-EMITE detailGrouping (senão a engrenagem sumiria no 1º save)", async () => {
    const grouping = { byFactor: { f_r: { into: "count:*", folded: ["sum:value"] } } };
    renderEditor(makeConfig({ detailGrouping: grouping }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar plano" }));
    await waitFor(() => expect(savePlan).toHaveBeenCalledTimes(1));
    const payload = savePlan.mock.calls[0][0] as { config: CompPlanConfig };
    expect(payload.config.detailGrouping).toEqual(grouping);
  });

  it("condição com valor vazio é erro amigável e o savePlan nem dispara", async () => {
    const config = makeConfig();
    config.factors[0].filters = [{ field: "stage", op: "eq", value: "" }];
    renderEditor(config);
    fireEvent.click(screen.getByRole("button", { name: "Salvar plano" }));
    await waitFor(() =>
      expect(notifyActionError).toHaveBeenCalledWith(
        "Salvar plano",
        'Condição sem valor no indicador "Reuniões".'
      )
    );
    expect(savePlan).not.toHaveBeenCalled();
  });

  it("as linhas de condição aparecem no card do fator", () => {
    renderEditor(makeConfig());
    expect(screen.getByText("Condições do recorte")).toBeInTheDocument();
    // Dois cards de filtro renderizados (aria-label do Combobox de campo).
    expect(screen.getAllByLabelText("Campo do filtro")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: /Adicionar condição/ })
    ).toBeInTheDocument();
  });
});

describe("PlanEditor — validação amigável por fator no save", () => {
  // Fator novo (Adicionar fator): nome/peso/fórmula vazios morriam no parse
  // fail-closed do servidor com o genérico "Configuração do plano inválida.".
  it("nome, peso e fórmula vazios têm mensagem própria; savePlan nem dispara", async () => {
    renderEditor(makeConfig());
    fireEvent.click(screen.getByRole("button", { name: /Adicionar indicador/ }));
    const saveBtn = screen.getByRole("button", { name: "Salvar plano" });

    // Sem nome.
    fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(notifyActionError).toHaveBeenCalledWith(
        "Salvar plano",
        "Dê um nome ao indicador 2."
      )
    );

    // Com nome, sem peso — a mensagem diz que 0 vale.
    fireEvent.change(screen.getAllByPlaceholderText("Ex.: Vendas")[1], {
      target: { value: "Valor gerado (SDR)" },
    });
    fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(notifyActionError).toHaveBeenCalledWith(
        "Salvar plano",
        'Informe o peso do indicador "Valor gerado (SDR)" — 0 vale (indicador que só define a faixa da comissão).'
      )
    );

    // Com peso 0, sem fórmula (FormulaEditor mockado — tokens seguem []).
    fireEvent.change(screen.getAllByPlaceholderText("Ex.: 60")[1], {
      target: { value: "0" },
    });
    fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(notifyActionError).toHaveBeenCalledWith(
        "Salvar plano",
        'Monte a fórmula do realizado do indicador "Valor gerado (SDR)".'
      )
    );
    expect(savePlan).not.toHaveBeenCalled();
  });
});
