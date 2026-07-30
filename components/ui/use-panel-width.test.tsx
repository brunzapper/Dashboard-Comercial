// @vitest-environment jsdom
// Versão: 1.0 | Data: 30/07/2026
// Testes do resize de painel: clamp puro (min → 95vw) e a leitura/gravação da
// largura no localStorage (o arrasto real com pointer capture fica fora — o
// jsdom não o suporta; o clamp cobre a aritmética do movimento).
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  clampPanelWidth,
  usePanelWidth,
} from "@/components/ui/use-panel-width";

function Probe({ storageKey }: { storageKey: string }) {
  const { width } = usePanelWidth(storageKey, 448, { min: 320 });
  return <div data-testid="w">{width}</div>;
}

afterEach(() => {
  window.localStorage.clear();
});

describe("clampPanelWidth", () => {
  it("respeita o mínimo", () => {
    expect(clampPanelWidth(100, 320, 1280)).toBe(320);
  });
  it("teto em 95% da viewport", () => {
    expect(clampPanelWidth(5000, 320, 1000)).toBe(950);
  });
  it("arredonda valores intermediários", () => {
    expect(clampPanelWidth(400.6, 320, 1280)).toBe(401);
  });
});

describe("usePanelWidth", () => {
  it("usa o default sem valor salvo", () => {
    render(<Probe storageKey="panel-w:test-a" />);
    expect(screen.getByTestId("w").textContent).toBe("448");
  });
  it("hidrata do localStorage quando >= min", () => {
    window.localStorage.setItem("panel-w:test-b", "600");
    render(<Probe storageKey="panel-w:test-b" />);
    expect(screen.getByTestId("w").textContent).toBe("600");
  });
  it("ignora valor salvo abaixo do mínimo", () => {
    window.localStorage.setItem("panel-w:test-c", "100");
    render(<Probe storageKey="panel-w:test-c" />);
    expect(screen.getByTestId("w").textContent).toBe("448");
  });
});
