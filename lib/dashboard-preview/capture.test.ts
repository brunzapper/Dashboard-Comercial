// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { snapshotMain, thumbnail } from "./capture";

it("copia só o main, inline CSS e SVG; exclui scripts, portals e widgets fora da janela", async () => {
  document.head.innerHTML = '<style>.card{color:red}</style>';
  document.body.innerHTML = '<aside>SEGREDO SIDEBAR</aside><main data-app-main onclick="alert(1)"><svg><text>Receita</text></svg><div class="react-grid-item">Visível</div><div class="react-grid-item">Fora da janela</div><script>fetch("/action")</script><iframe src="/other"></iframe></main><div role="dialog">SEGREDO PORTAL</div>';
  const main = document.querySelector("main")!;
  main.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 900, right: 1440, width: 1440, height: 900 }) as DOMRect;
  const widgets = main.querySelectorAll(".react-grid-item");
  widgets[0].getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 100, right: 100 }) as DOMRect;
  widgets[1].getBoundingClientRect = () => ({ top: 1000, left: 0, bottom: 1100, right: 100 }) as DOMRect;
  const html = await snapshotMain(main, new AbortController().signal);
  for (const value of ["Receita", "Visível", "color: red", "inert"]) expect(html).toContain(value);
  for (const value of ["Fora da janela", "<script", "onclick", "<iframe", "SEGREDO"]) expect(html).not.toContain(value);
});
it("recorta o quadrado superior esquerdo sem reduzir a página inteira", async () => {
  const main = document.createElement("main");
  Object.defineProperties(main, { clientWidth: { value: 1440 }, clientHeight: { value: 6000 } });
  vi.stubGlobal("innerHeight", 900);
  vi.stubGlobal("Image", class { src = ""; async decode() {} });
  const drawImage = vi.fn();
  const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  const encode = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (this: HTMLCanvasElement) {
    expect([this.width, this.height]).toEqual([560, 560]);
    return "data:image/webp;base64,ok";
  });
  try {
    await thumbnail(main, new AbortController().signal);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 900, 900, 0, 0, 560, 560);
  } finally { context.mockRestore(); encode.mockRestore(); vi.unstubAllGlobals(); }
});
it("cede a thread durante a cópia e obedece cancelamento", async () => {
  const main = document.createElement("main");
  main.innerHTML = "<p>Conteúdo</p>".repeat(500);
  const controller = new AbortController();
  const promise = snapshotMain(main, controller.signal);
  setTimeout(() => controller.abort(), 0);
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
});
