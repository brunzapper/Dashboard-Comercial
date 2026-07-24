// Versão: 1.0 | Data: 24/07/2026
// Setup compartilhado do Vitest (roda em TODO ambiente — node e jsdom).
// - Matchers do jest-dom (toBeDisabled, toHaveValue, …) no expect do Vitest.
// - SÓ quando há DOM (arquivos com pragma `// @vitest-environment jsdom`):
//   stubs de APIs que o jsdom não implementa e que Radix/cmdk exigem para
//   abrir Popover/Select/Combobox. Stub novo entra SEMPRE aqui (guardado),
//   nunca dentro de um teste individual.
// - Cleanup do RTL após cada teste (sem `globals: true` o auto-cleanup do
//   Testing Library não se registra sozinho). Import dinâmico: não carrega
//   RTL nos testes de env node.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

if (typeof window !== "undefined") {
  const el = window.Element.prototype as unknown as Record<string, unknown>;
  el.scrollIntoView ??= () => {};
  el.hasPointerCapture ??= () => false;
  el.setPointerCapture ??= () => {};
  el.releasePointerCapture ??= () => {};
  // Radix Popper (floating-ui) observa o trigger com ResizeObserver ao abrir
  // Popover/Select — o jsdom não o implementa.
  (window as unknown as Record<string, unknown>).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  const { cleanup } = await import("@testing-library/react");
  afterEach(cleanup);
}
