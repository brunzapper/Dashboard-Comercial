// @vitest-environment jsdom
import { expect, it } from "vitest";
import { snapshotMain } from "./capture";

it("copia só o main, inline CSS e SVG; exclui scripts, portals e widgets fora da janela", async () => {
  document.head.innerHTML = '<style>.card{color:red}</style>';
  document.body.innerHTML = '<aside>SEGREDO SIDEBAR</aside><main data-app-main onclick="alert(1)"><svg><text>Receita</text></svg><div class="react-grid-item">Visível</div><div class="react-grid-item">Fora da janela</div><script>fetch("/action")</script><iframe src="/other"></iframe></main><div role="dialog">SEGREDO PORTAL</div>';
  const main = document.querySelector("main")!;
  main.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 900, right: 1440 }) as DOMRect;
  const widgets = main.querySelectorAll(".react-grid-item");
  widgets[0].getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 100, right: 100 }) as DOMRect;
  widgets[1].getBoundingClientRect = () => ({ top: 1000, left: 0, bottom: 1100, right: 100 }) as DOMRect;
  const html = await snapshotMain(main, new AbortController().signal);
  for (const value of ["Receita", "Visível", "color: red", "inert"]) expect(html).toContain(value);
  for (const value of ["Fora da janela", "<script", "onclick", "<iframe", "SEGREDO"]) expect(html).not.toContain(value);
});
it("cede a thread durante a cópia e obedece cancelamento", async () => {
  const main = document.createElement("main");
  main.innerHTML = "<p>Conteúdo</p>".repeat(500);
  const controller = new AbortController();
  const promise = snapshotMain(main, controller.signal);
  setTimeout(() => controller.abort(), 0);
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
});
