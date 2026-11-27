// @vitest-environment jsdom
// Versão: 1.0 | Data: 27/11/2026
// Painel de conferência — DESMARCAR registros do cálculo: desmarcar é rascunho
// (nada é gravado até "Aplicar e recalcular"), o Aplicar manda a lista COMPLETA
// do fator (inclusive desmarcados fora da tela) e Descartar volta ao gravado.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CompDetailFactor, CompDetailRecordRow } from "@/lib/comp/detail";
import { saveExcludedRecords } from "@/app/(app)/operacao/remuneracao/actions";
import { loadCompFactorDetail } from "@/app/(app)/operacao/remuneracao/detail-actions";

import { CompDetailPanel } from "./comp-detail-panel";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
// Desmarcado gravado que NÃO está na lista (fora da janela).
const FORA = "00000000-0000-4000-8000-00000000000f";

const row = (id: string, title: string, excluded = false): CompDetailRecordRow => ({
  id,
  date: "01/08/2026",
  title,
  sourceLabel: "Negócios",
  responsibleLabel: "Ana",
  stage: "Ganho",
  value: 100,
  valueText: "R$ 100,00",
  contribution: 10,
  parts: [],
  excluded,
});

const detail = (): CompDetailFactor => ({
  factorId: "f_v",
  label: "Vendas",
  money: true,
  realized: 200,
  payoutFormula: null,
  commissions: [],
  listedForCompare: 200,
  excludedIds: [FORA],
  warnings: [],
  operands: [
    {
      label: "Soma de Valor",
      valueLabel: "Valor",
      aggNote: "Soma de Valor · 2 registros no recorte",
      rows: [row(A, "Negócio A"), row(B, "Negócio B")],
      listedSum: 200,
      total: 2,
      truncated: false,
      excludedCount: 0,
      mergedFrom: [],
      sumParts: [],
      warnings: [],
    },
  ],
});

vi.mock("@/app/(app)/operacao/remuneracao/detail-actions", () => ({
  loadCompFactorDetail: vi.fn(),
}));
vi.mock("@/app/(app)/operacao/remuneracao/actions", () => ({
  saveExcludedRecords: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/feedback/notify", () => ({ notifyActionError: vi.fn() }));

const TARGET = {
  planId: "p1",
  memberId: "m1",
  memberLabel: "Ana",
  factorId: "f_v",
};

function renderPanel() {
  return render(
    <CompDetailPanel target={TARGET} year={2026} month={8} onClose={() => {}} />
  );
}

describe("CompDetailPanel — desmarcar registros", () => {
  beforeEach(() => {
    vi.mocked(saveExcludedRecords).mockClear();
    vi.mocked(loadCompFactorDetail).mockReset();
    vi.mocked(loadCompFactorDetail).mockResolvedValue({
      ok: true,
      planName: "Plano A",
      memberLabel: "Ana",
      apuracaoShifted: false,
      detail: detail(),
    });
  });

  it("desmarcar é rascunho; Aplicar manda a lista completa e recarrega", async () => {
    renderPanel();
    const caixa = await screen.findByRole("checkbox", {
      name: "Considerar Negócio B no cálculo",
    });
    expect(caixa).toHaveAttribute("data-state", "checked");
    fireEvent.click(caixa);
    expect(caixa).toHaveAttribute("data-state", "unchecked");
    // Nada gravado ainda.
    expect(saveExcludedRecords).not.toHaveBeenCalled();
    expect(screen.getByText(/1 alteração/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Aplicar e recalcular" }));
    await waitFor(() => expect(saveExcludedRecords).toHaveBeenCalledTimes(1));
    const arg = vi.mocked(saveExcludedRecords).mock.calls[0][0];
    expect(arg).toMatchObject({
      planId: "p1",
      responsibleId: "m1",
      factorId: "f_v",
      year: 2026,
      month: 8,
    });
    // O desmarcado fora da tela SOBREVIVE ao save.
    expect([...arg.recordIds].sort()).toEqual([B, FORA].sort());
    await waitFor(() => expect(loadCompFactorDetail).toHaveBeenCalledTimes(2));
  });

  it("Descartar volta ao gravado sem gravar nada", async () => {
    renderPanel();
    const caixa = await screen.findByRole("checkbox", {
      name: "Considerar Negócio A no cálculo",
    });
    fireEvent.click(caixa);
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(caixa).toHaveAttribute("data-state", "checked");
    expect(screen.queryByText(/alteraç/)).not.toBeInTheDocument();
    expect(saveExcludedRecords).not.toHaveBeenCalled();
  });

  it("a caixa do cabeçalho desmarca o bloco inteiro", async () => {
    renderPanel();
    const todos = await screen.findByRole("checkbox", {
      name: "Considerar todos os registros deste bloco",
    });
    fireEvent.click(todos);
    expect(
      screen.getByRole("checkbox", { name: "Considerar Negócio A no cálculo" })
    ).toHaveAttribute("data-state", "unchecked");
    expect(screen.getByText(/2 alterações/)).toBeInTheDocument();
  });
});
