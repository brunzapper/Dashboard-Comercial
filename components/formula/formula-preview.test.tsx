// @vitest-environment jsdom
// Versão: 1.0 | Data: 24/07/2026
// Testes do painel de prévia: debounce de 700ms, gating do manualStart (1º
// cálculo por clique — custa RPCs como um widget) e a guarda de corrida `seq`
// (resposta antiga chegando DEPOIS é descartada, nunca sobrescreve a nova).
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FormulaPreviewPanel,
  type FormulaPreviewData,
} from "@/components/formula/formula-preview";
import type { Formula } from "@/lib/records/formulas";

const FORMULA_A: Formula = { tokens: [{ kind: "const", value: 1 }] };
const FORMULA_B: Formula = { tokens: [{ kind: "const", value: 2 }] };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("FormulaPreviewPanel", () => {
  it("debounce: só chama o adapter após 700ms de fórmula estável", async () => {
    const run = vi.fn(async (): Promise<FormulaPreviewData> => ({ ok: true, value: "42" }));
    render(
      <FormulaPreviewPanel adapter={{ run }} formula={FORMULA_A} valid />
    );
    await act(() => vi.advanceTimersByTimeAsync(699));
    expect(run).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("manualStart: não computa antes do clique em 'Calcular prévia'", async () => {
    const run = vi.fn(async (): Promise<FormulaPreviewData> => ({ ok: true, value: "7" }));
    render(
      <FormulaPreviewPanel
        adapter={{ run, manualStart: true }}
        formula={FORMULA_A}
        valid
      />
    );
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Calcular prévia" }));
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("guarda de corrida: resposta antiga que chega depois é descartada", async () => {
    const resolvers: ((d: FormulaPreviewData) => void)[] = [];
    const run = vi.fn(
      () =>
        new Promise<FormulaPreviewData>((resolve) => {
          resolvers.push(resolve);
        })
    );
    const { rerender } = render(
      <FormulaPreviewPanel adapter={{ run }} formula={FORMULA_A} valid />
    );
    await act(() => vi.advanceTimersByTimeAsync(700)); // dispara A (pendente)
    rerender(
      <FormulaPreviewPanel adapter={{ run }} formula={FORMULA_B} valid />
    );
    await act(() => vi.advanceTimersByTimeAsync(700)); // dispara B (pendente)
    expect(run).toHaveBeenCalledTimes(2);

    // B resolve primeiro; A (antiga) chega DEPOIS e não pode sobrescrever.
    await act(async () => {
      resolvers[1]({ ok: true, value: "NOVA" });
    });
    await act(async () => {
      resolvers[0]({ ok: true, value: "ANTIGA" });
    });
    expect(screen.getByText("NOVA")).toBeInTheDocument();
    expect(screen.queryByText("ANTIGA")).not.toBeInTheDocument();
  });

  it("fórmula inválida não computa e orienta o usuário", async () => {
    const run = vi.fn(async (): Promise<FormulaPreviewData> => ({ ok: true }));
    render(
      <FormulaPreviewPanel adapter={{ run }} formula={FORMULA_A} valid={false} />
    );
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(run).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Complete a fórmula .* para ver a prévia\./)
    ).toBeInTheDocument();
  });
});
