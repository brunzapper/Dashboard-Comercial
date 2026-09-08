// @vitest-environment jsdom
// Versão: 1.0 | Data: 04/09/2026
// Testes do useDebouncedRefresh v1.2: o refresh de reconciliação vive num timer
// de MÓDULO e por isso SOBREVIVE ao desmonte de quem o agendou — era esse
// cancelamento que fazia o filtro gravado na troca de aba do dashboard nunca
// reconciliar a página. Cobre também a coalescência global, a guarda de rota
// (só o pathname conta: a troca de aba mexe na query) e o prazo mínimo.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, replace: vi.fn(), push: vi.fn() }),
}));

import {
  useDebouncedRefresh,
  useRefreshOnActionOk,
} from "@/lib/use-debounced-refresh";

beforeEach(() => {
  refreshMock.mockClear();
  window.history.replaceState(null, "", "/dashboards/d1");
  vi.useFakeTimers();
});

afterEach(() => {
  // O timer é de MÓDULO: um agendamento vazando entre casos falsearia o
  // próximo. Drena (mesma rota, disparo inofensivo) antes do relógio real.
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  refreshMock.mockClear();
});

describe("useDebouncedRefresh", () => {
  it("agenda UM refresh após o delay", () => {
    const { result } = renderHook(() => useDebouncedRefresh());
    act(() => result.current());
    act(() => void vi.advanceTimersByTime(799));
    expect(refreshMock).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("SOBREVIVE ao desmonte de quem agendou (regressão da troca de aba)", () => {
    const { result, unmount } = renderHook(() => useDebouncedRefresh());
    act(() => result.current());
    unmount();
    act(() => void vi.advanceTimersByTime(800));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("rajada de controles diferentes coalesce em 1 refresh", () => {
    const a = renderHook(() => useDebouncedRefresh());
    const b = renderHook(() => useDebouncedRefresh());
    const c = renderHook(() => useDebouncedRefresh());
    act(() => {
      a.result.current();
      b.result.current();
      c.result.current();
    });
    act(() => void vi.advanceTimersByTime(800));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("um agendamento LONGO não adia um curto já em voo", () => {
    const curto = renderHook(() => useDebouncedRefresh(300));
    const longo = renderHook(() => useDebouncedRefresh(1500));
    act(() => curto.result.current());
    act(() => longo.result.current());
    act(() => void vi.advanceTimersByTime(300));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("mudar de ROTA descarta o refresh pendente", () => {
    const { result } = renderHook(() => useDebouncedRefresh());
    act(() => result.current());
    window.history.replaceState(null, "", "/registros");
    act(() => void vi.advanceTimersByTime(800));
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("trocar de ABA (só a query muda) NÃO descarta o refresh", () => {
    const { result } = renderHook(() => useDebouncedRefresh());
    act(() => result.current());
    window.history.replaceState(null, "", "/dashboards/d1?tab=b");
    act(() => void vi.advanceTimersByTime(800));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});

describe("useRefreshOnActionOk", () => {
  it("dispara no ok:true novo e ignora ok:false", () => {
    const { rerender } = renderHook(
      ({ state }: { state: { ok?: boolean } }) => useRefreshOnActionOk(state),
      { initialProps: { state: {} as { ok?: boolean } } }
    );
    rerender({ state: { ok: false } });
    act(() => void vi.advanceTimersByTime(300));
    expect(refreshMock).not.toHaveBeenCalled();
    rerender({ state: { ok: true } });
    act(() => void vi.advanceTimersByTime(300));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
