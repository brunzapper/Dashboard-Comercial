// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { previewIsReady } from "./readiness";
import { schedulePreviewTask } from "./queue";

it("ignora carregamento fora do recorte, mas não publica widgets visíveis incompletos", () => {
  document.body.innerHTML = '<main><div aria-busy="true"></div></main>';
  const main = document.querySelector("main")!;
  const widget = main.firstElementChild!;
  main.getBoundingClientRect = () => ({top:0,left:0,bottom:900,right:1440,width:1440,height:900}) as DOMRect;
  widget.getBoundingClientRect = () => ({top:1000,left:0,bottom:1100,right:100,width:100,height:100}) as DOMRect;
  expect(previewIsReady(main)).toBe(true);
  widget.getBoundingClientRect = () => ({top:0,left:0,bottom:100,right:100,width:100,height:100}) as DOMRect;
  expect(previewIsReady(main)).toBe(false);
  widget.removeAttribute("aria-busy");
  expect(previewIsReady(main)).toBe(true);
  widget.scrollTop = 10;
  expect(previewIsReady(main)).toBe(false);
});
it("executa sem aguardar idle e permite cancelar a tarefa antes de começar", async () => {
  const idle = vi.fn();
  vi.stubGlobal("requestIdleCallback", idle);
  try {
    const canceled = vi.fn();
    schedulePreviewTask(canceled)();
    await new Promise<void>(resolve => schedulePreviewTask(resolve));
    expect(canceled).not.toHaveBeenCalled();
    expect(idle).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
