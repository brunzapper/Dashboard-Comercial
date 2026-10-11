// @vitest-environment jsdom
// Versão: 1.0 | Data: 11/10/2026
// v1.0 (11/10/2026): `FitNumber` mostra a 1ª forma do número que cabe na
//   célula; com "Ajustar o cartão" a célula não aperta e o número sai inteiro.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FitNumber, TreeCardProvider } from "./tree-typography";

const CANDIDATES = ["125.430", "125,4k", "125k"];

function renderIn(width: number, overflow: "cartao" | "cortar") {
  // A largura disponível é a da CÉLULA (o número mede contra ela).
  vi.spyOn(HTMLTableCellElement.prototype, "clientWidth", "get").mockReturnValue(width);
  return render(
    <TreeCardProvider widget={{ fit: { overflow } }} node={null}>
      <table>
        <tbody>
          <tr>
            <td>
              <FitNumber candidates={CANDIDATES} />
            </td>
          </tr>
        </tbody>
      </table>
    </TreeCardProvider>
  );
}

describe("FitNumber", () => {
  beforeEach(() => {
    // Observa e já avisa (como o navegador faz ao começar a observar).
    vi.stubGlobal(
      "ResizeObserver",
      class {
        cb: () => void;
        constructor(cb: () => void) {
          this.cb = cb;
        }
        observe() {
          this.cb();
        }
        disconnect() {}
      }
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("abrevia quando o completo não cabe", () => {
    // Estimativa sem canvas: 11px × 0,62 por caractere → "125.430" ≈ 48px.
    renderIn(42, "cortar");
    expect(screen.getByText("125,4k")).toBeTruthy();
  });

  it("perde a casa decimal se ainda não couber", () => {
    renderIn(30, "cortar");
    expect(screen.getByText("125k")).toBeTruthy();
  });

  it("cartão que cresce mostra o número inteiro", () => {
    renderIn(10, "cartao");
    expect(screen.getByText("125.430")).toBeTruthy();
  });
});
