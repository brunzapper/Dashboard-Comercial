// @vitest-environment jsdom
// Versão: 1.1 | Data: 04/09/2026
// Testes da QuickFiltersBar v1.3 (save otimista em background): o chip
// responde ANTES do servidor (sem transition global — run() do dashboard não
// é chamado no branch persistido), a action sai com revalidate:false, erro
// reverte o chip ao último valor confirmado e o eco stale com save em voo é
// consumido sem clobberar o otimista (guard hasPending).
// v1.1 (04/09/2026): cobre a v1.5 do componente — desmontar antes do debounce
// (troca de aba do dashboard) FLUSHA a gravação em vez de descartá-la, e o
// cache de módulo segura o valor otimista na remontagem enquanto as props RSC
// ainda são as antigas. Cada teste usa um widgetId próprio: o cache é de
// MÓDULO (sobrevive ao unmount de propósito), então compartilhar id vazaria
// estado entre casos.
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

function renderBar(
  values: WidgetQuickFilters["values"] = {},
  widgetId = "w1"
) {
  return render(
    <QuickFiltersBar
      dashboardId="d1"
      widgetId={widgetId}
      qf={qf(values)}
      available={[]}
    />
  );
}

// Abre o dropdown do chip e alterna a opção "Ana". Mira a checkbox (e não o
// texto): com "Ana" já selecionada, o rótulo aparece TAMBÉM no gatilho.
async function pickAna() {
  fireEvent.click(screen.getByRole("button", { name: /Responsável/ }));
  const opt = await screen.findByRole("checkbox", { name: "Ana" });
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
    renderBar({}, "w2");
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
    const view = renderBar({}, "w3");
    await pickAna();
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    // Eco stale (outro valor) aterrissa com o save EM VOO: é consumido sem
    // aplicar — o chip segue mostrando a seleção otimista.
    view.rerender(
      <QuickFiltersBar
        dashboardId="d1"
        widgetId="w3"
        qf={qf({ e1: { kind: "options", values: ["r2"] } })}
        available={[]}
      />
    );
    expect(screen.getByRole("button", { name: /Ana/ })).toBeTruthy();
    await act(async () => resolveSave({ ok: true }));
    expect(screen.getByRole("button", { name: /Ana/ })).toBeTruthy();
  });
});

// Bug do dashboard: a troca de aba é client-side e DESMONTA os widgets da aba
// anterior. Antes da v1.5, o cleanup do debounce matava o timer e a gravação
// nunca saía — o usuário tinha de ficar parado na tela antes de trocar de aba.
describe("QuickFiltersBar — troca de aba (desmonte)", () => {
  it("desmontar antes do debounce FLUSHA a gravação em vez de descartá-la", async () => {
    const view = renderBar({}, "w4");
    await pickAna();
    // O debounce de 400ms ainda não disparou.
    expect(saveMock).not.toHaveBeenCalled();
    view.unmount();
    // O flush é síncrono no cleanup: a action já saiu com o valor escolhido.
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith(
      "d1",
      "w4",
      "e1",
      { kind: "options", values: ["r1"] },
      { revalidate: false }
    );
  });

  it("limpar o filtro e desmontar também grava (valor nulo apaga a célula)", async () => {
    const view = renderBar({ e1: { kind: "options", values: ["r1"] } }, "w5");
    // Desmarca "Ana": seleção vazia = "todos" (valor nulo).
    await pickAna();
    view.unmount();
    expect(saveMock).toHaveBeenCalledWith("d1", "w5", "e1", null, {
      revalidate: false,
    });
  });

  it("remontar com props RSC antigas mantém o otimista; o eco novo assume", async () => {
    const view = renderBar({}, "w6");
    await pickAna();
    view.unmount();
    expect(saveMock).toHaveBeenCalledTimes(1);
    // Volta à aba ANTES de o refresh de reconciliação aterrissar: as props ainda
    // trazem o valor antigo (vazio), mas o chip não pode piscar "todos".
    const back = renderBar({}, "w6");
    expect(screen.getByRole("button", { name: /Ana/ })).toBeTruthy();
    // Refresh chegou: o servidor confirma a seleção e o cache é descartado.
    back.rerender(
      <QuickFiltersBar
        dashboardId="d1"
        widgetId="w6"
        qf={qf({ e1: { kind: "options", values: ["r1"] } })}
        available={[]}
      />
    );
    expect(screen.getByRole("button", { name: /Ana/ })).toBeTruthy();
  });

  it("intervalo personalizado: commit tardio do filho grava mesmo já desmontado", async () => {
    const periodQf: WidgetQuickFilters = {
      entries: [{ id: "p1", field: "closed_at", label: "Fechamento" }],
      values: {},
      options: {},
    };
    const view = render(
      <QuickFiltersBar
        dashboardId="d1"
        widgetId="w8"
        qf={periodQf}
        available={[
          {
            field: "closed_at",
            label: "Fechamento",
            isNumeric: false,
            isDate: true,
          },
        ]}
      />
    );
    // Abre o rascunho "Personalizado" e digita o intervalo COMPLETO.
    fireEvent.click(screen.getByRole("combobox", { name: /Período/ }));
    fireEvent.click(await screen.findByText("Personalizado"));
    const inputs = document.querySelectorAll('input[type="date"]');
    fireEvent.change(inputs[0], { target: { value: "2026-01-01" } });
    fireEvent.change(inputs[1], { target: { value: "2026-01-31" } });
    // Trocar de aba antes dos 500ms do auto-commit: o filho flusha o commit e o
    // pai, já drenado, grava na hora em vez de armar um timer órfão.
    expect(saveMock).not.toHaveBeenCalled();
    view.unmount();
    expect(saveMock).toHaveBeenCalledWith(
      "d1",
      "w8",
      "p1",
      { kind: "period", preset: "", de: "2026-01-01", ate: "2026-01-31" },
      { revalidate: false }
    );
  });

  it("props que divergem do baseline descartam o cache (outro usuário mudou)", async () => {
    const view = renderBar({}, "w7");
    await pickAna();
    view.unmount();
    // Remonta com um valor de OUTRO usuário: o cache não pode pinar o nosso.
    renderBar({ e1: { kind: "options", values: ["r2"] } }, "w7");
    expect(screen.getByRole("button", { name: /Bruno/ })).toBeTruthy();
  });
});
