// @vitest-environment jsdom
// Versão: 1.0 | Data: 10/09/2026
// O dono da seleção múltipla. As duas invariantes que os testes pinam não são
// detalhe de implementação — são o que impede uma ação em massa de mirar o que
// ninguém está vendo:
//   - a PODA contra os ids vivos (item que saiu da tela sai da seleção);
//   - "selecionar todas" opera sobre o universo FILTRADO, nunca sobre o banco.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useBulkSelection } from "./use-bulk-selection";

describe("useBulkSelection", () => {
  it("começa vazia e alterna item a item", () => {
    const { result } = renderHook(() => useBulkSelection(["a", "b", "c"]));
    expect(result.current.count).toBe(0);

    act(() => result.current.toggle("b"));
    expect(result.current.selectedIds).toEqual(["b"]);

    act(() => result.current.toggle("b"));
    expect(result.current.count).toBe(0);
  });

  // A ordem é a da TELA, não a de clique: a barra e o resultado por item ficam
  // legíveis de cima para baixo.
  it("devolve na ordem do universo, não na de clique", () => {
    const { result } = renderHook(() => useBulkSelection(["a", "b", "c"]));
    act(() => result.current.toggle("c"));
    act(() => result.current.toggle("a"));
    expect(result.current.selectedIds).toEqual(["a", "c"]);
  });

  // O caso que motiva a poda: o RSC devolve a página sem o item, ou um filtro
  // estreita a lista. Sem isto, "excluir 3" apagaria algo fora da tela.
  it("o item que sai da tela sai da seleção", () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useBulkSelection(ids),
      { initialProps: { ids: ["a", "b", "c"] } }
    );
    act(() => result.current.toggle("a"));
    act(() => result.current.toggle("c"));
    expect(result.current.count).toBe(2);

    rerender({ ids: ["a", "b"] });
    expect(result.current.selectedIds).toEqual(["a"]);
  });

  // Mas a seleção não é DESTRUÍDA por um sumiço temporário: se o item volta ao
  // universo, ele volta selecionado (a poda é de leitura, não de escrita).
  it("item que volta ao universo volta selecionado", () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useBulkSelection(ids),
      { initialProps: { ids: ["a", "b"] } }
    );
    act(() => result.current.toggle("b"));
    rerender({ ids: ["a"] });
    expect(result.current.count).toBe(0);
    rerender({ ids: ["a", "b"] });
    expect(result.current.selectedIds).toEqual(["b"]);
  });

  it("setMany marca e desmarca em lote (a cascata da Tree)", () => {
    const { result } = renderHook(() => useBulkSelection(["a", "b", "c"]));
    act(() => result.current.setMany(["a", "b", "c"], true));
    expect(result.current.count).toBe(3);
    act(() => result.current.setMany(["b"], false));
    expect(result.current.selectedIds).toEqual(["a", "c"]);
  });

  describe("selecionar todas", () => {
    it("tri-estado: vazio → parcial → cheio", () => {
      const { result } = renderHook(() => useBulkSelection(["a", "b"]));
      expect(result.current.allState).toBe(false);
      act(() => result.current.toggle("a"));
      expect(result.current.allState).toBe("indeterminate");
      act(() => result.current.toggle("b"));
      expect(result.current.allState).toBe(true);
    });

    // O universo é o que está na tela. Marcar "todas" numa lista filtrada não
    // pode alcançar o que o filtro escondeu.
    it("alcança só o universo FILTRADO", () => {
      const { result, rerender } = renderHook(
        ({ ids }: { ids: string[] }) => useBulkSelection(ids),
        { initialProps: { ids: ["a", "b", "c"] } }
      );
      rerender({ ids: ["a", "b"] }); // um filtro estreitou a lista
      act(() => result.current.toggleAll(true));
      expect(result.current.selectedIds).toEqual(["a", "b"]);

      rerender({ ids: ["a", "b", "c"] }); // filtro removido
      expect(result.current.selectedIds).toEqual(["a", "b"]);
      expect(result.current.allState).toBe("indeterminate");
    });

    it("lista vazia não fica 'todas marcadas'", () => {
      const { result } = renderHook(() => useBulkSelection([]));
      expect(result.current.allState).toBe(false);
    });
  });

  describe("Esc", () => {
    it("limpa a seleção", () => {
      const { result } = renderHook(() => useBulkSelection(["a", "b"]));
      act(() => result.current.toggle("a"));
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      expect(result.current.count).toBe(0);
    });

    it("pode ser desligado por quem já usa Esc para outra coisa", () => {
      const { result } = renderHook(() =>
        useBulkSelection(["a"], { escClears: false })
      );
      act(() => result.current.toggle("a"));
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      expect(result.current.count).toBe(1);
    });
  });
});
