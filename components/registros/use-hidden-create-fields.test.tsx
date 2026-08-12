// @vitest-environment jsdom
// Versão: 1.0 | Data: 12/08/2026
// Testes do hook de campos ocultos do form de criação (localStorage por base):
// default vazio, hidratação pós-mount, persistência de hide/show, parse
// defensivo (JSON inválido/shape errado → vazio) e recarga ao trocar de base.
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useHiddenCreateFields } from "@/components/registros/use-hidden-create-fields";

const KEY = (s: string) => `registros:hiddenCreateFields:${s}`;

function Probe({ sourceKey }: { sourceKey: string }) {
  const { isHidden, hideField, showField } = useHiddenCreateFields(sourceKey);
  return (
    <div>
      <div data-testid="hidden">
        {["core__stage", "custom__origem"]
          .filter((k) => isHidden(k))
          .join(",")}
      </div>
      <button onClick={() => hideField("custom__origem")}>hide-origem</button>
      <button onClick={() => showField("custom__origem")}>show-origem</button>
    </div>
  );
}

afterEach(() => {
  window.localStorage.clear();
});

describe("useHiddenCreateFields", () => {
  it("default: nada oculto e nada gravado", () => {
    render(<Probe sourceKey="vendas" />);
    expect(screen.getByTestId("hidden").textContent).toBe("");
    expect(window.localStorage.getItem(KEY("vendas"))).toBeNull();
  });

  it("hidrata do localStorage pós-mount", () => {
    window.localStorage.setItem(
      KEY("vendas"),
      JSON.stringify(["core__stage"])
    );
    render(<Probe sourceKey="vendas" />);
    expect(screen.getByTestId("hidden").textContent).toBe("core__stage");
  });

  it("hideField persiste; showField remove (e limpa a chave vazia)", () => {
    render(<Probe sourceKey="vendas" />);
    fireEvent.click(screen.getByText("hide-origem"));
    expect(screen.getByTestId("hidden").textContent).toBe("custom__origem");
    expect(
      JSON.parse(window.localStorage.getItem(KEY("vendas")) ?? "[]")
    ).toEqual(["custom__origem"]);
    fireEvent.click(screen.getByText("show-origem"));
    expect(screen.getByTestId("hidden").textContent).toBe("");
    expect(window.localStorage.getItem(KEY("vendas"))).toBeNull();
  });

  it("JSON inválido ou shape errado → vazio (sem quebrar)", () => {
    window.localStorage.setItem(KEY("vendas"), "{nope");
    const { unmount } = render(<Probe sourceKey="vendas" />);
    expect(screen.getByTestId("hidden").textContent).toBe("");
    unmount();
    window.localStorage.setItem(KEY("outra"), JSON.stringify({ a: 1 }));
    render(<Probe sourceKey="outra" />);
    expect(screen.getByTestId("hidden").textContent).toBe("");
  });

  it("troca de base recarrega da chave nova", () => {
    window.localStorage.setItem(KEY("a"), JSON.stringify(["core__stage"]));
    window.localStorage.setItem(KEY("b"), JSON.stringify(["custom__origem"]));
    const { rerender } = render(<Probe sourceKey="a" />);
    expect(screen.getByTestId("hidden").textContent).toBe("core__stage");
    rerender(<Probe sourceKey="b" />);
    expect(screen.getByTestId("hidden").textContent).toBe("custom__origem");
  });
});
