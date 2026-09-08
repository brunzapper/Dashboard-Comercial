// @vitest-environment jsdom
// Versão: 1.0 | Data: 08/09/2026
// v1.0 (08/09/2026): pina a regra "a ORIGEM do refetch decide o feedback" —
// 1ª rodada e mudança de escopo são do USUÁRIO (feedback visível); re-rodada
// com o mesmo escopo é o event bus (realtime/sync) e tem de ser SILENCIOSA.
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";

import { useRefetchOrigin } from "./use-refetch-origin";

describe("useRefetchOrigin", () => {
  it("1ª rodada conta como do usuário (carga inicial)", () => {
    const { result } = renderHook(() => useRefetchOrigin("a"));
    expect(result.current()).toBe(true);
  });

  it("re-rodada com o MESMO escopo é do event bus (silenciosa)", () => {
    const { result } = renderHook(() => useRefetchOrigin("a"));
    expect(result.current()).toBe(true);
    // Tick do bus: o efeito re-roda sem que o escopo tenha mudado.
    expect(result.current()).toBe(false);
    expect(result.current()).toBe(false);
  });

  it("mudança de escopo volta a ser do usuário", () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useRefetchOrigin(key),
      { initialProps: { key: "a" } }
    );
    expect(result.current()).toBe(true);
    rerender({ key: "b" });
    expect(result.current()).toBe(true);
  });

  it("sequência bus → escopo → bus", () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useRefetchOrigin(key),
      { initialProps: { key: "a" } }
    );
    expect(result.current()).toBe(true); // carga inicial
    expect(result.current()).toBe(false); // tick do bus
    rerender({ key: "b" });
    expect(result.current()).toBe(true); // usuário trocou o período
    expect(result.current()).toBe(false); // tick do bus de novo
  });

  it("a identidade da função só muda quando o escopo muda", () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useRefetchOrigin(key),
      { initialProps: { key: "a" } }
    );
    const first = result.current;
    rerender({ key: "a" });
    expect(result.current).toBe(first);
    rerender({ key: "b" });
    expect(result.current).not.toBe(first);
  });
});
