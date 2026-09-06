// @vitest-environment jsdom
// Versão: 1.0 | Data: 06/09/2026
// Testes da QuickTableWidget v1.4 (cálculo entre células descobrível): régua
// A/B/C fora do "Editar layout", barra de fórmula mostrando o conteúdo CRU da
// célula selecionada (não o resultado), clique na grade inserindo o endereço
// no rascunho e commit pela barra gravando por saveQuickTableCells.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Widget } from "@/lib/widgets/types";

import { QuickTableWidget } from "./quick-table-widget";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboards/d1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/(app)/dashboards/actions", () => ({
  saveQuickTableCells: vi.fn(async () => ({ ok: true })),
  saveWidgetSettings: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/(app)/dashboards/quick-table-actions", () => ({
  runQuickTable: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("@/components/snapshots/snapshot-mode", () => ({
  useSnapshotMode: () => ({ snapshot: false }),
}));

import { saveQuickTableCells } from "@/app/(app)/dashboards/actions";

const saveMock = vi.mocked(saveQuickTableCells);

// Tabela 2×2 de colunas livres, sem coluna de dados (nada de BI/deferred).
const widget = {
  id: "w1",
  visual_type: "tabela_editavel",
  title: "Contas",
  settings: {
    quickTable: {
      columns: [
        { id: "cA", kind: "free" as const, header: "Valor" },
        { id: "cB", kind: "free" as const, header: "Total" },
      ],
      rows: [{ id: "r1" }, { id: "r2" }],
    },
  },
} as unknown as Widget;

function renderTable(
  cells: { row_key: string; col_key: string; value: string }[] = []
) {
  return render(
    <QuickTableWidget
      widget={widget}
      dashboardId="d1"
      cells={cells}
      userRoles={["vendedor"]}
      available={[]}
    />
  );
}

// A célula (linha, coluna) da grade renderizada.
const cellAt = (r: number, c: number) =>
  document.querySelector(`td[data-r="${r}"][data-c="${c}"]`) as HTMLElement;

const bar = () =>
  screen.getByLabelText("Conteúdo da célula (fórmula)") as HTMLInputElement;

beforeEach(() => {
  saveMock.mockClear();
});

describe("QuickTableWidget — endereços das células", () => {
  it("mostra a régua A/B e os números de linha sem o Editar layout", () => {
    renderTable();
    // Letras no cabeçalho e números no gutter (canEdit/editMode ausentes) —
    // convivendo com os rótulos das colunas.
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("B")).toBeTruthy();
    expect(screen.getByText("Valor")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("a barra mostra endereço e FÓRMULA da célula (a grade, o resultado)", () => {
    renderTable([
      { row_key: "r1", col_key: "cA", value: "10" },
      { row_key: "r2", col_key: "cA", value: "5" },
      { row_key: "r1", col_key: "cB", value: "=SOMA(A1:A2)" },
    ]);
    // A célula com fórmula exibe o resultado…
    expect(cellAt(0, 1).textContent).toContain("15");
    // …e a barra, ao selecioná-la, o conteúdo cru.
    fireEvent.pointerDown(cellAt(0, 1), { button: 0 });
    expect(screen.getByLabelText("Célula selecionada").textContent).toBe("B1");
    expect(bar().value).toBe("=SOMA(A1:A2)");
  });

  it("clique na grade insere o endereço no rascunho da fórmula", () => {
    renderTable([{ row_key: "r1", col_key: "cA", value: "10" }]);
    // Digita "=" na célula B1 (atalho de planilha: tecla imprimível edita).
    fireEvent.pointerDown(cellAt(0, 1), { button: 0 });
    fireEvent.keyDown(screen.getByRole("grid"), { key: "=" });
    const input = screen.getByLabelText("Editar célula") as HTMLInputElement;
    expect(input.value).toBe("=");
    input.setSelectionRange(1, 1);
    // Clicar em A1 insere "A1" no cursor (o arrasto que vira "A1:A2" depende
    // de elementFromPoint, sem layout no jsdom).
    fireEvent.pointerDown(cellAt(0, 0), { button: 0 });
    expect(
      (screen.getByLabelText("Editar célula") as HTMLInputElement).value
    ).toBe("=A1");
  });

  it("editar pela barra grava a célula (Enter)", async () => {
    renderTable();
    fireEvent.pointerDown(cellAt(1, 1), { button: 0 });
    fireEvent.change(bar(), { target: { value: "=1+2" } });
    fireEvent.keyDown(bar(), { key: "Enter" });
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(saveMock.mock.calls[0][2]).toEqual([
      { rowKey: "r2", colKey: "cB", value: "=1+2" },
    ]);
  });
});
