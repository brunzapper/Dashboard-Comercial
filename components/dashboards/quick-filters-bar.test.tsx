// @vitest-environment jsdom
// Versão: 1.0 | Data: 07/08/2026
// Testes da QuickFiltersBar v1.3 (save otimista em background): o chip
// responde ANTES do servidor (sem transition global — run() do dashboard não
// é chamado no branch persistido), a action sai com revalidate:false, erro
// reverte o chip ao último valor confirmado e o eco stale com save em voo é
// consumido sem clobberar o otimista (guard hasPending).
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WidgetQuickFilters } from "@/lib/widgets/quick-filters";

import { QuickFiltersBar } from "./quick-filters-bar";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboards/d1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));
vi.mock("@/app/(app)/dashboards/actions", () => ({
  saveQuickFilterValue: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/components/snapshots/snapshot-mode", () => ({
  useSnapshotMode: () => ({ snapshot: false }),
}));
const runSpy = vi.fn((fn: () => void) => fn());
vi.mock("@/components/dashboards/pending-context", () => ({
  useNavPending: () => ({ pending: false, run: runSpy }),
}));

import { saveQuickFilterValue } from "@/app/(app)/dashboards/actions";

const saveMock = vi.mocked(saveQuickFilterValue);

function qf(values: WidgetQuickFilters["values"] = {}): WidgetQuickFilters {
  return {
    entries: [{ id: "e1", field: "responsible_id", label: "Responsável" }],
    values,
    options: {
      e1: [
        { value: "r1", label: "Ana" },
        { value: "r2", label: "Bruno" },
      ],
    },
  };
}

function renderBar(values: WidgetQuickFilters["values"] = {}) {
  return render(
    <QuickFiltersBar
      dashboardId="d1"
      widgetId="w1"
      qf={qf(values)}
      available={[]}
    />
  );
}

// Abre o dropdown do chip e marca a opção "Ana".
async function pickAna() {
  fireEvent.click(screen.getByRole("button", { name: /Responsável/ }));
  const opt = await screen.findByText("Ana");
  fireEvent.click(opt);
}

beforeEach(() => {
  saveMock.mockClear();
  saveMock.mockImplementation(async () => ({ ok: true }));
  runSpy.mockClear();
});

describe("QuickFiltersBar — save otimista em background", () => {
  it("chip responde na hora; action sai debounced com revalidate:false; sem transition global", async () => {
    renderBar();
    await pickAna();
    // Otimista imediato: o resumo do chip já mostra a seleção, ANTES do save
    // (o debounce de 400ms nem disparou).
    expect(screen.getByRole("button", { name: /Ana/ })).toBeTruthy();
    expect(saveMock).not.toHaveBeenCalled();
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    expect(saveMock).toHaveBeenCalledWith(
      "d1",
      "w1",
      "e1",
      { kind: "options", values: ["r1"] },
      { revalidate: false }
    );
    // O branch persistido NÃO passa pelo transition global do board.
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("erro no save reverte o chip ao último valor confirmado", async () => {
    saveMock.mockImplementation(async () => ({
      ok: false,
      message: "RLS negou.",
    }));
    renderBar();
    await pickAna();
    expect(screen.getByRole("button", { name: /Ana/ })).toBeTruthy();
    // Debounce (400ms) + save falho → revert para "todos" (valor confirmado
    // era vazio).
    await waitFor(
      () => expect(screen.getByRole("button", { name: /todos/ })).toBeTruthy(),
      { timeout: 2000 }
    );
  });

  it("eco stale com save em voo não clobbera o otimista (guard hasPending)", async () => {
    let resolveSave!: (v: { ok: boolean }) => void;
    saveMock.mockImplementation(
      () => new Promise((r) => (resolveSave = r)) as ReturnType<typeof saveQuickFilterValue>
    );
    const view = renderBar();
    await pickAna();
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    // Eco stale (outro valor) aterrissa com o save EM VOO: é consumido sem
    // aplicar — o chip segue mostrando a seleção otimista.
    view.rerender(
      <QuickFiltersBar
        dashboardId="d1"
        widgetId="w1"
        qf={qf({ e1: { kind: "options", values: ["r2"] } })}
        available={[]}
      />
    );
    expect(screen.getByRole("button", { name: /Ana/ })).toBeTruthy();
    await act(async () => resolveSave({ ok: true }));
    expect(screen.getByRole("button", { name: /Ana/ })).toBeTruthy();
  });
});
