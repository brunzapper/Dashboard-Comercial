// @vitest-environment jsdom
// Versão: 1.0 | Data: 08/08/2026
// Testes do MappingsManager v1.2 (save otimista em background, §4.10): o
// "Mapear" nunca trava a tela (linha some na hora; as demais seguem
// editáveis com o save em voo), a fila COALESCEDORA junta saves em sequência
// numa chamada saveMappings encadeada (revalidate:false), erro reverte a
// linha (reaparece com o rascunho) + toast, e o botão "Mapear preenchidos
// (N)" salva todas as pendências preenchidas numa ÚNICA chamada.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DomainOverview } from "@/lib/mappings/overview";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));
vi.mock("@/app/(app)/operacao/mapeamentos/actions", () => ({
  saveMappings: vi.fn(async () => ({ ok: true, message: "salvo" })),
  deleteMapping: vi.fn(async () => ({ ok: true })),
  applyAllMappings: vi.fn(async () => ({ ok: true })),
}));
// O sheet de IA puxa actions próprias — fora do escopo destes testes.
vi.mock("@/components/operacao/mappings-ai-sheet", () => ({
  MappingsAiSheet: () => null,
}));

import { toast } from "sonner";

import { saveMappings } from "@/app/(app)/operacao/mapeamentos/actions";

import { MappingsManager } from "./mappings-manager";

const saveMock = vi.mocked(saveMappings);

function domainFixture(over: Partial<DomainOverview> = {}): DomainOverview {
  return {
    key: "cargo",
    label: "Cargos",
    rawFieldLabel: "Cargo",
    targets: [{ fieldKey: "custom:cargo_area", label: "Área" }],
    optionsByTarget: { "custom:cargo_area": ["Comercial", "Financeiro"] },
    mappings: [],
    unmapped: [
      { value: "Diretor", count: 3 },
      { value: "Gerente", count: 2 },
      { value: "Analista", count: 1 },
    ],
    recordsWithValue: 6,
    system: true,
    ...over,
  };
}

function renderManager() {
  return render(
    <MappingsManager overview={[domainFixture()]} ai={null} />
  );
}

/** Linha da pendência `value` (célula com title = valor cru). */
function pendRow(value: string) {
  const cell = screen.getByText(value);
  const row = cell.closest("tr");
  if (!row) throw new Error(`linha de ${value} não encontrada`);
  return row;
}

function fillPend(value: string, area: string) {
  const row = pendRow(value);
  fireEvent.change(within(row).getByLabelText("Área para o valor"), {
    target: { value: area },
  });
  return row;
}

beforeEach(() => {
  saveMock.mockClear();
  saveMock.mockImplementation(async () => ({ ok: true, message: "salvo" }));
  vi.mocked(toast.error).mockClear();
});

describe("MappingsManager — save otimista em background", () => {
  it("Mapear não trava a tela: linha some na hora, as demais seguem editáveis e o próximo save coalesce no lote seguinte", async () => {
    let resolveFirst!: (v: { ok: boolean; message?: string }) => void;
    saveMock.mockImplementationOnce(
      () => new Promise((r) => (resolveFirst = r))
    );
    renderManager();

    const rowA = fillPend("Diretor", "Comercial");
    fireEvent.click(within(rowA).getByRole("button", { name: "Mapear" }));

    // Otimista imediato: a linha sai da lista de pendências (contagem cai).
    await waitFor(() => expect(screen.queryByText("Diretor")).toBeNull());
    expect(
      screen.getByText(/Pendentes de classificação \(2\)/)
    ).toBeInTheDocument();

    // O flush saiu com a entrada única e revalidate:false (padrão §4.10).
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(saveMock.mock.calls[0]).toEqual([
      "cargo",
      [{ rawValue: "Diretor", outputs: { "custom:cargo_area": "Comercial" } }],
      { revalidate: false },
    ]);

    // Com o save A em voo, a linha B está LIVRE (nada de transition global).
    const rowB = pendRow("Gerente");
    const inputB = within(rowB).getByLabelText("Área para o valor");
    expect(inputB).not.toBeDisabled();
    fireEvent.change(inputB, { target: { value: "Financeiro" } });
    fireEvent.click(within(rowB).getByRole("button", { name: "Mapear" }));
    await waitFor(() => expect(screen.queryByText("Gerente")).toBeNull());

    // A entrada B ficou no lote seguinte, aguardando o flush A (encadeado —
    // nunca duas reaplicações do mesmo domínio em paralelo).
    expect(saveMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFirst({ ok: true, message: "1 salvo" });
    });
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(2));
    expect(saveMock.mock.calls[1][1]).toEqual([
      { rawValue: "Gerente", outputs: { "custom:cargo_area": "Financeiro" } },
    ]);
  });

  it("falha reverte a linha: pendência reaparece com o rascunho e toast de erro dispara", async () => {
    saveMock.mockResolvedValueOnce({ ok: false, message: "sem permissão" });
    renderManager();

    const row = fillPend("Diretor", "Comercial");
    fireEvent.click(within(row).getByRole("button", { name: "Mapear" }));

    // Revert: a linha volta e o rascunho digitado é restaurado.
    await waitFor(() => expect(screen.getByText("Diretor")).toBeInTheDocument());
    expect(
      within(pendRow("Diretor")).getByLabelText("Área para o valor")
    ).toHaveValue("Comercial");
    expect(vi.mocked(toast.error)).toHaveBeenCalled();
  });

  it("Mapear preenchidos (N) salva todas as pendências preenchidas numa única chamada", async () => {
    renderManager();

    // Sem rascunho válido o botão fica desabilitado com contagem 0.
    expect(
      screen.getByRole("button", { name: /Mapear preenchidos \(0\)/ })
    ).toBeDisabled();

    fillPend("Diretor", "Comercial");
    fillPend("Gerente", "Financeiro"); // "Analista" fica sem rascunho

    const bulk = screen.getByRole("button", {
      name: /Mapear preenchidos \(2\)/,
    });
    expect(bulk).not.toBeDisabled();
    fireEvent.click(bulk);

    // UMA chamada com as duas entradas (coalescidas no mesmo lote) e as
    // linhas somem otimisticamente; a não preenchida permanece.
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(saveMock.mock.calls[0][1]).toEqual([
      { rawValue: "Diretor", outputs: { "custom:cargo_area": "Comercial" } },
      { rawValue: "Gerente", outputs: { "custom:cargo_area": "Financeiro" } },
    ]);
    expect(screen.queryByText("Diretor")).toBeNull();
    expect(screen.queryByText("Gerente")).toBeNull();
    expect(screen.getByText("Analista")).toBeInTheDocument();
  });
});
