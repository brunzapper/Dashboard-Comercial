// @vitest-environment jsdom
// Versão: 1.0 | Data: 11/10/2026
// v1.0 (11/10/2026): `isPanBlockedTarget` — o pan do slide arma sobre o
//   conteúdo dos widgets, mas nunca sobre controles interativos.
import { describe, expect, it } from "vitest";

import { isPanBlockedTarget } from "./presentation";

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("isPanBlockedTarget", () => {
  it("conteúdo de widget arma o pan", () => {
    const root = mount(
      `<div class="react-grid-item"><div><p id="t">Metas</p></div></div>`
    );
    expect(isPanBlockedTarget(root.querySelector("#t"))).toBe(false);
  });

  it("controles e a saída explícita bloqueiam (inclusive descendentes)", () => {
    const root = mount(`
      <div class="react-grid-item">
        <button><span id="b">x</span></button>
        <a href="/x" id="a">link</a>
        <input id="i" />
        <div data-no-pan><span id="n">tabela</span></div>
        <div role="slider" id="s"></div>
      </div>`);
    for (const id of ["b", "a", "i", "n", "s"]) {
      expect(isPanBlockedTarget(root.querySelector(`#${id}`))).toBe(true);
    }
  });

  it("alvo nulo ou não-elemento não bloqueia", () => {
    expect(isPanBlockedTarget(null)).toBe(false);
    expect(isPanBlockedTarget(window)).toBe(false);
  });
});
