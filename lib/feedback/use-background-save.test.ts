// @vitest-environment jsdom
// Versão: 1.0 | Data: 07/08/2026
// Testes do useBackgroundSave: sucesso silencioso agenda o refresh debounced,
// ok:false/rejeição toastam e revertem SEM refresh, refcount por key mantém
// pendingKeys/hasPending corretos com saves concorrentes, e reconcile:false
// suprime o refresh.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

const refreshMock = vi.fn();
vi.mock("@/lib/use-debounced-refresh", () => ({
  useDebouncedRefresh: () => refreshMock,
}));

import { toast } from "sonner";
import { useBackgroundSave } from "@/lib/feedback/use-background-save";

const toastError = vi.mocked(toast.error);

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  toastError.mockClear();
  refreshMock.mockClear();
});

describe("useBackgroundSave", () => {
  it("sucesso: silêncio, sem revert, refresh agendado; pending vai e volta", async () => {
    const { result } = renderHook(() => useBackgroundSave());
    const d = deferred<{ ok: boolean }>();
    const revert = vi.fn();
    act(() => {
      result.current.save({
        key: "a",
        context: "Não foi possível salvar",
        action: () => d.promise,
        revert,
      });
    });
    expect(result.current.pendingKeys.has("a")).toBe(true);
    expect(result.current.hasPending).toBe(true);
    await act(async () => d.resolve({ ok: true }));
    await waitFor(() => expect(result.current.hasPending).toBe(false));
    expect(result.current.pendingKeys.size).toBe(0);
    expect(toastError).not.toHaveBeenCalled();
    expect(revert).not.toHaveBeenCalled();
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("ok:false: toast + revert, sem refresh", async () => {
    const { result } = renderHook(() => useBackgroundSave());
    const revert = vi.fn();
    act(() => {
      result.current.save({
        key: "a",
        context: "Não foi possível salvar",
        action: () => Promise.resolve({ ok: false, message: "RLS negou." }),
        revert,
      });
    });
    await waitFor(() => expect(result.current.hasPending).toBe(false));
    expect(toastError).toHaveBeenCalledWith("Não foi possível salvar", {
      description: "RLS negou.",
    });
    expect(revert).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("rejeição (rede): toast + revert, sem refresh", async () => {
    const { result } = renderHook(() => useBackgroundSave());
    const revert = vi.fn();
    act(() => {
      result.current.save({
        key: "a",
        context: "Não foi possível salvar",
        action: () => Promise.reject(new Error("network")),
        revert,
      });
    });
    await waitFor(() => expect(result.current.hasPending).toBe(false));
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(revert).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("refcount: 2 saves em voo da MESMA key = 1 pending até o último resolver", async () => {
    const { result } = renderHook(() => useBackgroundSave());
    const d1 = deferred<{ ok: boolean }>();
    const d2 = deferred<{ ok: boolean }>();
    act(() => {
      result.current.save({ key: "a", context: "c", action: () => d1.promise });
      result.current.save({ key: "a", context: "c", action: () => d2.promise });
    });
    expect(result.current.pendingKeys.has("a")).toBe(true);
    await act(async () => d1.resolve({ ok: true }));
    // O primeiro resolveu, mas o segundo segue em voo — a key não pode sumir.
    expect(result.current.pendingKeys.has("a")).toBe(true);
    await act(async () => d2.resolve({ ok: true }));
    await waitFor(() => expect(result.current.hasPending).toBe(false));
  });

  it("keys distintas são independentes", async () => {
    const { result } = renderHook(() => useBackgroundSave());
    const d1 = deferred<{ ok: boolean }>();
    act(() => {
      result.current.save({ key: "a", context: "c", action: () => d1.promise });
      result.current.save({
        key: "b",
        context: "c",
        action: () => Promise.resolve({ ok: true }),
      });
    });
    await waitFor(() => expect(result.current.pendingKeys.has("b")).toBe(false));
    expect(result.current.pendingKeys.has("a")).toBe(true);
    await act(async () => d1.resolve({ ok: true }));
    await waitFor(() => expect(result.current.hasPending).toBe(false));
  });

  it("reconcile:false: sucesso não agenda refresh", async () => {
    const { result } = renderHook(() => useBackgroundSave());
    act(() => {
      result.current.save({
        key: "a",
        context: "c",
        action: () => Promise.resolve({ ok: true }),
        reconcile: false,
      });
    });
    await waitFor(() => expect(result.current.hasPending).toBe(false));
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
